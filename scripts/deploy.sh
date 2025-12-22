#!/bin/bash

# Worxstream AI Agent - Deployment Script

set -e

APP_DIR="/opt/worxstream-agent"
REPO_URL="https://github.com/UditShukla14/worxstreamAgent.git"
BRANCH="main"

# Check root access
[ "$EUID" -eq 0 ] || { echo "Error: Must run as root" >&2; exit 1; }

# Ensure app directory exists
mkdir -p "$APP_DIR"
cd "$APP_DIR"

# Update code
if [ -d ".git" ]; then
  git pull origin "$BRANCH" > /dev/null 2>&1
else
  git clone -b "$BRANCH" "$REPO_URL" . > /dev/null 2>&1
fi

# Check .env file
if [ ! -f .env ]; then
  if [ -z "$SKIP_ENV_CHECK" ]; then
    echo "Warning: .env file not found" >&2
    exit 1
  fi
fi

# Ensure Docker is installed
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sh > /dev/null 2>&1
  systemctl enable docker > /dev/null 2>&1
fi

# Determine compose command
COMPOSE_CMD="docker compose"
docker compose version > /dev/null 2>&1 || COMPOSE_CMD="docker-compose"

# Prepare directories
mkdir -p uploads
chmod 755 uploads

# Deploy
$COMPOSE_CMD down > /dev/null 2>&1 || true
$COMPOSE_CMD build --no-cache --quiet
$COMPOSE_CMD up -d > /dev/null 2>&1

# Verify deployment
sleep 5
if docker ps | grep -q worxstream-agent; then
  echo "Deployment successful"
  exit 0
else
  echo "Deployment failed" >&2
  $COMPOSE_CMD logs --tail=50
  exit 1
fi
