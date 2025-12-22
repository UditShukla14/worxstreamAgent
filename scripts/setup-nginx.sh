#!/bin/bash

# Script to set up Nginx reverse proxy for mcp.worxstream.io

set -e

DOMAIN="mcp.worxstream.io"
BACKEND_PORT="3000"

echo "🔧 Setting up Nginx reverse proxy for $DOMAIN..."
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo -e "${RED}Please run as root${NC}"
  exit 1
fi

# Install Nginx and Certbot
if ! command -v nginx &> /dev/null; then
  echo "📦 Installing Nginx and Certbot..."
  apt-get update
  apt-get install -y nginx certbot python3-certbot-nginx
else
  echo -e "${GREEN}✅ Nginx is already installed${NC}"
fi

# Create Nginx configuration
echo "📝 Creating Nginx configuration..."
cat > /etc/nginx/sites-available/worxstream-agent << EOF
server {
    listen 80;
    server_name $DOMAIN;

    # Increase timeouts for long-running requests
    proxy_connect_timeout 300s;
    proxy_send_timeout 300s;
    proxy_read_timeout 300s;
    send_timeout 300s;

    # Increase body size for file uploads
    client_max_body_size 50M;

    location / {
        proxy_pass http://localhost:$BACKEND_PORT;
        proxy_http_version 1.1;
        
        # WebSocket support
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # Standard proxy headers
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Port \$server_port;
        
        # Disable buffering for streaming responses
        proxy_buffering off;
        proxy_cache_bypass \$http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }

    # Health check endpoint
    location /health {
        proxy_pass http://localhost:$BACKEND_PORT/health;
        proxy_set_header Host \$host;
        access_log off;
    }
}
EOF

# Enable the site
if [ ! -L "/etc/nginx/sites-enabled/worxstream-agent" ]; then
  echo "🔗 Enabling Nginx site..."
  ln -s /etc/nginx/sites-available/worxstream-agent /etc/nginx/sites-enabled/
fi

# Remove default site if it exists
if [ -L "/etc/nginx/sites-enabled/default" ]; then
  echo "🗑️  Removing default Nginx site..."
  rm /etc/nginx/sites-enabled/default
fi

# Test Nginx configuration
echo "🧪 Testing Nginx configuration..."
if nginx -t; then
  echo -e "${GREEN}✅ Nginx configuration is valid${NC}"
else
  echo -e "${RED}❌ Nginx configuration has errors${NC}"
  exit 1
fi

# Restart Nginx
echo "🔄 Restarting Nginx..."
systemctl restart nginx
systemctl enable nginx

echo ""
echo -e "${GREEN}✅ Nginx reverse proxy configured!${NC}"
echo ""
echo "Next steps:"
echo "1. Ensure DNS is configured: $DOMAIN → $(hostname -I | awk '{print $1}')"
echo "2. Set up SSL certificate:"
echo "   certbot --nginx -d $DOMAIN"
echo ""
echo "Test the connection:"
echo "   curl http://$DOMAIN/health"

