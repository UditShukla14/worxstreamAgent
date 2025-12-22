#!/bin/bash

# Fix Ubuntu 24.10 repository sources and install Docker
# Run this on your droplet

set +e

echo "🔧 Fixing Ubuntu repository sources..."

# Backup original sources
cp /etc/apt/sources.list /etc/apt/sources.list.backup 2>/dev/null || true

# Fix repository sources - use archive.ubuntu.com instead of mirrors
echo "📝 Updating repository sources..."

# Replace DigitalOcean mirrors with official Ubuntu archive
find /etc/apt/sources.list.d/ -name "*.list" -exec sed -i 's|http://mirrors.digitalocean.com/ubuntu|http://archive.ubuntu.com/ubuntu|g' {} \; 2>/dev/null || true
find /etc/apt/sources.list.d/ -name "*.list" -exec sed -i 's|http://security.ubuntu.com/ubuntu|http://archive.ubuntu.com/ubuntu|g' {} \; 2>/dev/null || true

# Also fix main sources.list
sed -i 's|http://mirrors.digitalocean.com/ubuntu|http://archive.ubuntu.com/ubuntu|g' /etc/apt/sources.list 2>/dev/null || true
sed -i 's|http://security.ubuntu.com/ubuntu|http://archive.ubuntu.com/ubuntu|g' /etc/apt/sources.list 2>/dev/null || true

# For Ubuntu 24.10 (Oracular), use noble repositories as fallback
UBUNTU_CODENAME=$(lsb_release -cs)
if [ "$UBUNTU_CODENAME" = "oracular" ]; then
  echo "⚠️  Ubuntu 24.10 detected. Using noble (24.04 LTS) repositories for compatibility..."
  
  # Create a temporary sources file using noble
  cat > /etc/apt/sources.list.d/noble-sources.list << 'EOF'
deb http://archive.ubuntu.com/ubuntu noble main restricted universe multiverse
deb http://archive.ubuntu.com/ubuntu noble-updates main restricted universe multiverse
deb http://archive.ubuntu.com/ubuntu noble-backports main restricted universe multiverse
deb http://archive.ubuntu.com/ubuntu noble-security main restricted universe multiverse
EOF
fi

# Update package lists
echo "📦 Updating package lists..."
apt-get update 2>&1 | grep -v "404\|Not Found" || {
  echo "⚠️  Some repository errors, but continuing..."
}

# Install Docker using Docker's official repository (more reliable)
echo "🐳 Installing Docker from Docker's official repository..."

# Remove old Docker if exists
apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

# Install prerequisites
apt-get install -y ca-certificates curl gnupg lsb-release 2>/dev/null || \
apt-get install -y ca-certificates curl gnupg 2>/dev/null || echo "⚠️  Some prerequisites failed"

# Add Docker's official GPG key
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

# Set up Docker repository (use noble for 24.10 compatibility)
if [ "$UBUNTU_CODENAME" = "oracular" ]; then
  DOCKER_CODENAME="noble"
else
  DOCKER_CODENAME="$UBUNTU_CODENAME"
fi

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${DOCKER_CODENAME} stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

# Update and install Docker
apt-get update 2>&1 | grep -v "404\|Not Found" || true
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin 2>/dev/null || {
  echo "⚠️  Docker CE installation failed, trying docker.io..."
  apt-get install -y docker.io 2>/dev/null || echo "⚠️  Docker installation failed"
}

# Install docker-compose-plugin or docker-compose
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
  echo "📦 Installing docker-compose..."
  apt-get install -y docker-compose-plugin 2>/dev/null || \
  apt-get install -y docker-compose 2>/dev/null || \
  echo "⚠️  docker-compose installation failed"
fi

# Start Docker
systemctl start docker 2>/dev/null || service docker start 2>/dev/null || true
systemctl enable docker 2>/dev/null || true

# Verify installation
if docker --version 2>/dev/null; then
  echo ""
  echo "✅ Docker installed successfully!"
  docker --version
  docker compose version 2>/dev/null || docker-compose --version 2>/dev/null || echo "⚠️  docker-compose not available"
else
  echo ""
  echo "❌ Docker installation failed. You may need to install manually."
  echo "Try: curl -fsSL https://get.docker.com | sh"
fi

echo ""
echo "✅ Repository fix and Docker installation completed!"

