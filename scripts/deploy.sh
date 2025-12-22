#!/bin/bash

# Deployment script for Worxstream AI Agent
# This script can be run manually on the droplet

set -e

echo "🚀 Starting deployment..."

# Configuration
APP_DIR="/opt/worxstream-agent"
REPO_URL="https://github.com/UditShukla14/worxstreamAgent.git"
BRANCH="main"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo -e "${RED}Please run as root${NC}"
  exit 1
fi

# Create app directory if it doesn't exist
if [ ! -d "$APP_DIR" ]; then
  echo -e "${YELLOW}Creating app directory...${NC}"
  mkdir -p "$APP_DIR"
fi

cd "$APP_DIR"

# Clone or pull repository
if [ -d ".git" ]; then
  echo -e "${GREEN}Pulling latest changes...${NC}"
  git pull origin "$BRANCH"
else
  echo -e "${GREEN}Cloning repository...${NC}"
  git clone -b "$BRANCH" "$REPO_URL" .
fi

# Check for .env file
if [ ! -f .env ]; then
  echo -e "${YELLOW}⚠️  Warning: .env file not found!${NC}"
  echo -e "${YELLOW}Please create .env file with required environment variables.${NC}"
  echo ""
  echo "Required variables:"
  echo "  - ANTHROPIC_API_KEY"
  echo "  - WORXSTREAM_BASE_URL (default: https://api.worxstream.io)"
  echo "  - WORXSTREAM_API_TOKEN"
  echo "  - BACKEND_URL (default: https://mcp.worxstream.io)"
  echo "  - DEFAULT_COMPANY_ID (default: 1)"
  echo "  - DEFAULT_USER_ID (default: 1)"
  echo "  - PORT (default: 3000)"
  echo "  - NODE_ENV (default: production)"
  echo "  - MONGODB_URL (optional, has default)"
  echo ""
  read -p "Continue anyway? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# Install Docker if not installed
if ! command -v docker &> /dev/null; then
  echo -e "${YELLOW}Installing Docker...${NC}"
  apt-get update
  apt-get install -y docker.io docker-compose-plugin
  systemctl start docker
  systemctl enable docker
fi

# Install Docker Compose if not installed
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
  echo -e "${YELLOW}Installing Docker Compose...${NC}"
  apt-get install -y docker-compose-plugin
fi

# Create uploads directory
mkdir -p uploads
chmod 755 uploads

# Determine which compose command to use
if docker compose version &> /dev/null; then
  COMPOSE_CMD="docker compose"
else
  COMPOSE_CMD="docker-compose"
fi

# Stop existing containers
echo -e "${GREEN}Stopping existing containers...${NC}"
$COMPOSE_CMD down || true

# Build and start containers
echo -e "${GREEN}Building Docker image...${NC}"
$COMPOSE_CMD build --no-cache

echo -e "${GREEN}Starting containers...${NC}"
$COMPOSE_CMD up -d

# Wait for service to start
echo -e "${YELLOW}Waiting for service to start...${NC}"
sleep 10

# Check health
echo -e "${GREEN}Checking service health...${NC}"
if docker ps | grep -q worxstream-agent; then
  echo -e "${GREEN}✅ Deployment successful!${NC}"
  echo ""
  echo "Container status:"
  docker ps | grep worxstream-agent
  echo ""
  echo "Service URL: http://localhost:3000"
  echo "Health check: http://localhost:3000/health"
  echo ""
  echo "To view logs: $COMPOSE_CMD logs -f"
else
  echo -e "${RED}❌ Deployment failed!${NC}"
  echo ""
  echo "Container logs:"
  $COMPOSE_CMD logs
  exit 1
fi

