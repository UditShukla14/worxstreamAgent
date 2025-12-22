#!/bin/bash

# Initial setup script for DigitalOcean Droplet
# Run this once to set up the environment

set -e

echo "🔧 Setting up DigitalOcean Droplet for Worxstream AI Agent..."

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo "Please run as root"
  exit 1
fi

# Update system
echo "📦 Updating system packages..."
apt-get update
apt-get upgrade -y

# Install essential tools
echo "📦 Installing essential tools..."
apt-get install -y \
  curl \
  wget \
  git \
  build-essential \
  vim \
  htop

# Install Docker
echo "🐳 Installing Docker..."
if ! command -v docker &> /dev/null; then
  # Remove old versions
  apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true
  
  # Install Docker
  apt-get install -y \
    ca-certificates \
    gnupg \
    lsb-release
  
  # Add Docker's official GPG key
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  
  # Set up repository
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
  
  # Install Docker Engine
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  
  # Start and enable Docker
  systemctl start docker
  systemctl enable docker
  
  echo "✅ Docker installed successfully"
else
  echo "✅ Docker already installed"
fi

# Install Node.js (for local development/testing, Docker will use its own)
echo "📦 Installing Node.js..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  echo "✅ Node.js installed"
else
  echo "✅ Node.js already installed"
fi

# Create app directory
APP_DIR="/opt/worxstream-agent"
echo "📁 Creating app directory: $APP_DIR"
mkdir -p "$APP_DIR"
mkdir -p "$APP_DIR/uploads"
chmod 755 "$APP_DIR/uploads"

# Set up firewall (if ufw is available)
if command -v ufw &> /dev/null; then
  echo "🔥 Configuring firewall..."
  ufw allow 22/tcp   # SSH
  ufw allow 3000/tcp # App port
  ufw allow 80/tcp   # HTTP (for reverse proxy)
  ufw allow 443/tcp  # HTTPS
  ufw --force enable || true
  echo "✅ Firewall configured"
fi

# Create .env template
ENV_FILE="$APP_DIR/.env.example"
echo "📝 Creating .env.example template..."
cat > "$ENV_FILE" << EOF
# Anthropic API Key
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# Worxstream API Configuration
WORXSTREAM_BASE_URL=https://api.worxstream.io
WORXSTREAM_API_TOKEN=your_access_token_here

# Default company/user IDs
DEFAULT_COMPANY_ID=1
DEFAULT_USER_ID=1

# Server Configuration
PORT=3000
NODE_ENV=production

# MongoDB (if using)
# MONGODB_URI=mongodb://localhost:27017/worxstream-agent
EOF

echo ""
echo "✅ Droplet setup completed!"
echo ""
echo "Next steps:"
echo "1. Copy .env.example to .env and fill in your values:"
echo "   cd $APP_DIR"
echo "   cp .env.example .env"
echo "   nano .env"
echo ""
echo "2. Clone your repository:"
echo "   cd $APP_DIR"
echo "   git clone https://github.com/UditShukla14/worxstreamAgent.git ."
echo ""
echo "3. Deploy the application:"
echo "   ./scripts/deploy.sh"
echo ""
echo "Or use GitHub Actions for automatic deployment!"

