#!/bin/bash

# Script to check if mcp.worxstream.io is connected to the deployment

set -e

DOMAIN="mcp.worxstream.io"
DROPLET_IP="157.245.218.43"
BACKEND_PORT="3000"

echo "🔍 Checking domain connection for $DOMAIN..."
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 1. Check DNS Resolution
echo -e "${BLUE}1. Checking DNS resolution...${NC}"
DNS_IP=$(dig +short $DOMAIN | tail -n1 || echo "")
if [ -z "$DNS_IP" ]; then
  echo -e "${RED}❌ DNS not resolving. Domain may not be configured yet.${NC}"
  echo "   Expected IP: $DROPLET_IP"
  echo ""
  echo "   To fix: Add an A record in your DNS:"
  echo "   - Type: A"
  echo "   - Name: mcp"
  echo "   - Value: $DROPLET_IP"
  echo "   - TTL: 3600"
else
  echo -e "${GREEN}✅ DNS resolves to: $DNS_IP${NC}"
  if [ "$DNS_IP" = "$DROPLET_IP" ]; then
    echo -e "${GREEN}   ✓ DNS points to correct droplet IP${NC}"
  else
    echo -e "${YELLOW}   ⚠️  DNS points to $DNS_IP, expected $DROPLET_IP${NC}"
  fi
fi
echo ""

# 2. Check if Nginx is installed
echo -e "${BLUE}2. Checking Nginx installation...${NC}"
if command -v nginx &> /dev/null; then
  echo -e "${GREEN}✅ Nginx is installed${NC}"
  NGINX_VERSION=$(nginx -v 2>&1 | awk '{print $3}')
  echo "   Version: $NGINX_VERSION"
else
  echo -e "${YELLOW}⚠️  Nginx is not installed${NC}"
  echo "   Install with: apt-get install -y nginx certbot python3-certbot-nginx"
fi
echo ""

# 3. Check Nginx configuration
echo -e "${BLUE}3. Checking Nginx configuration...${NC}"
if [ -f "/etc/nginx/sites-available/worxstream-agent" ]; then
  echo -e "${GREEN}✅ Nginx config file exists${NC}"
  if grep -q "$DOMAIN" /etc/nginx/sites-available/worxstream-agent 2>/dev/null; then
    echo -e "${GREEN}   ✓ Domain configured in Nginx${NC}"
  else
    echo -e "${YELLOW}   ⚠️  Domain not found in config${NC}"
  fi
else
  echo -e "${YELLOW}⚠️  Nginx config file not found${NC}"
  echo "   Expected: /etc/nginx/sites-available/worxstream-agent"
fi

if [ -L "/etc/nginx/sites-enabled/worxstream-agent" ]; then
  echo -e "${GREEN}   ✓ Config is enabled${NC}"
else
  echo -e "${YELLOW}   ⚠️  Config is not enabled${NC}"
fi
echo ""

# 4. Check Nginx status
echo -e "${BLUE}4. Checking Nginx service status...${NC}"
if systemctl is-active --quiet nginx; then
  echo -e "${GREEN}✅ Nginx is running${NC}"
else
  echo -e "${RED}❌ Nginx is not running${NC}"
  echo "   Start with: systemctl start nginx"
fi
echo ""

# 5. Check backend container
echo -e "${BLUE}5. Checking backend container...${NC}"
if docker ps | grep -q worxstream-agent; then
  echo -e "${GREEN}✅ Backend container is running${NC}"
  CONTAINER_STATUS=$(docker ps --filter "name=worxstream-agent" --format "{{.Status}}")
  echo "   Status: $CONTAINER_STATUS"
else
  echo -e "${RED}❌ Backend container is not running${NC}"
fi
echo ""

# 6. Test local backend
echo -e "${BLUE}6. Testing local backend connection...${NC}"
if curl -s -f http://localhost:$BACKEND_PORT/health > /dev/null 2>&1; then
  echo -e "${GREEN}✅ Backend is responding on localhost:$BACKEND_PORT${NC}"
  HEALTH_RESPONSE=$(curl -s http://localhost:$BACKEND_PORT/health)
  echo "   Response: $HEALTH_RESPONSE"
else
  echo -e "${RED}❌ Backend is not responding on localhost:$BACKEND_PORT${NC}"
fi
echo ""

# 7. Test domain connection (if DNS is configured)
if [ "$DNS_IP" = "$DROPLET_IP" ] || [ -n "$DNS_IP" ]; then
  echo -e "${BLUE}7. Testing domain connection...${NC}"
  
  # Test HTTP
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://$DOMAIN/health 2>/dev/null || echo "000")
  if [ "$HTTP_STATUS" = "200" ]; then
    echo -e "${GREEN}✅ HTTP connection works (Status: $HTTP_STATUS)${NC}"
  elif [ "$HTTP_STATUS" = "000" ]; then
    echo -e "${YELLOW}⚠️  Cannot connect via HTTP (may need Nginx setup)${NC}"
  else
    echo -e "${YELLOW}⚠️  HTTP returned status: $HTTP_STATUS${NC}"
  fi
  
  # Test HTTPS
  HTTPS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://$DOMAIN/health 2>/dev/null || echo "000")
  if [ "$HTTPS_STATUS" = "200" ]; then
    echo -e "${GREEN}✅ HTTPS connection works (Status: $HTTPS_STATUS)${NC}"
  elif [ "$HTTPS_STATUS" = "000" ]; then
    echo -e "${YELLOW}⚠️  HTTPS not configured (SSL certificate needed)${NC}"
  else
    echo -e "${YELLOW}⚠️  HTTPS returned status: $HTTPS_STATUS${NC}"
  fi
  echo ""
fi

# 8. Summary and recommendations
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Summary & Next Steps:${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if [ "$DNS_IP" = "$DROPLET_IP" ] && systemctl is-active --quiet nginx && docker ps | grep -q worxstream-agent; then
  echo -e "${GREEN}✅ Domain appears to be properly configured!${NC}"
  echo ""
  echo "Test endpoints:"
  echo "  - Health: https://$DOMAIN/health"
  echo "  - API: https://$DOMAIN/api/chat/stream"
else
  echo -e "${YELLOW}⚠️  Setup incomplete. Follow these steps:${NC}"
  echo ""
  
  if [ "$DNS_IP" != "$DROPLET_IP" ]; then
    echo "1. Configure DNS:"
    echo "   Add A record: mcp.worxstream.io → $DROPLET_IP"
    echo ""
  fi
  
  if ! command -v nginx &> /dev/null || ! systemctl is-active --quiet nginx; then
    echo "2. Install and configure Nginx:"
    echo "   Run: ./scripts/setup-nginx.sh"
    echo "   Or manually:"
    echo "   apt-get install -y nginx certbot python3-certbot-nginx"
    echo ""
  fi
  
  if ! docker ps | grep -q worxstream-agent; then
    echo "3. Start backend container:"
    echo "   cd /opt/worxstream-agent"
    echo "   docker compose up -d"
    echo ""
  fi
fi

echo ""

