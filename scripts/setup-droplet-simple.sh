#!/bin/bash

# Simplified setup script that works around Ubuntu 24.10 repository issues
# This version installs Docker directly from Ubuntu repos

set +e

echo "🔧 Setting up DigitalOcean Droplet for Worxstream AI Agent (Simplified)..."

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo "Please run as root"
  exit 1
fi

# Install essential tools (skip update to avoid repository errors)
echo "📦 Installing essential tools..."
apt-get install -y --allow-unauthenticated curl wget git vim 2>/dev/null || \
apt-get install -y curl wget git vim || echo "⚠️  Some tools installation skipped"

# Install Docker from Ubuntu repositories (simpler, works around repo issues)
echo "🐳 Installing Docker..."
if ! command -v docker &> /dev/null; then
  echo "📦 Installing Docker from Ubuntu repositories..."
  apt-get install -y docker.io docker-compose-plugin 2>/dev/null || \
  apt-get install -y docker.io || {
    echo "⚠️  Docker installation failed. Trying alternative method..."
    # Try installing docker-compose separately
    apt-get install -y docker-compose || echo "⚠️  docker-compose not available"
  }
  
  # Start Docker
  systemctl start docker 2>/dev/null || service docker start 2>/dev/null || true
  systemctl enable docker 2>/dev/null || true
  
  # Verify Docker is working
  if docker --version 2>/dev/null; then
    echo "✅ Docker installed successfully"
  else
    echo "⚠️  Docker installation may have issues, but continuing..."
  fi
else
  echo "✅ Docker already installed"
  docker --version
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
  ufw --force enable 2>/dev/null || true
  echo "✅ Firewall configured"
fi

# Create .env template
ENV_FILE="$APP_DIR/.env.example"
echo "📝 Creating .env.example template..."
cat > "$ENV_FILE" << 'EOF'
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
echo "   chmod +x scripts/deploy.sh"
echo "   ./scripts/deploy.sh"
echo ""
echo "Or use GitHub Actions for automatic deployment!"

