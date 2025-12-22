#!/bin/bash

# Cleanup script for DigitalOcean Droplet
# This script will:
# 1. Stop all running services (PM2, Docker, Node processes)
# 2. Remove all files and directories
# 3. Unlink GitHub repositories
# 4. Clean up system

set -e

echo "⚠️  WARNING: This script will DELETE ALL CONTENTS on the droplet!"
echo "Press Ctrl+C within 10 seconds to cancel..."
sleep 10

echo ""
echo "🧹 Starting cleanup process..."

# Get current directory
CURRENT_DIR=$(pwd)
echo "📍 Current directory: $CURRENT_DIR"

# 1. Stop all PM2 processes
echo ""
echo "🛑 Stopping PM2 processes..."
if command -v pm2 &> /dev/null; then
    pm2 stop all 2>/dev/null || true
    pm2 delete all 2>/dev/null || true
    pm2 kill 2>/dev/null || true
    echo "✅ PM2 processes stopped"
else
    echo "ℹ️  PM2 not found, skipping..."
fi

# 2. Stop all Docker containers
echo ""
echo "🐳 Stopping Docker containers..."
if command -v docker &> /dev/null; then
    docker stop $(docker ps -aq) 2>/dev/null || true
    docker rm $(docker ps -aq) 2>/dev/null || true
    docker system prune -af --volumes 2>/dev/null || true
    echo "✅ Docker containers stopped and removed"
else
    echo "ℹ️  Docker not found, skipping..."
fi

# 3. Kill all Node processes
echo ""
echo "🛑 Stopping Node.js processes..."
pkill -f node || true
sleep 2
echo "✅ Node processes stopped"

# 4. Find and unlink GitHub repositories
echo ""
echo "🔗 Finding and unlinking GitHub repositories..."

# Find all git repositories
find /home -name ".git" -type d 2>/dev/null | while read git_dir; do
    repo_dir=$(dirname "$git_dir")
    echo "📁 Found git repository: $repo_dir"
    
    cd "$repo_dir"
    
    # Check for GitHub remote
    if git remote -v 2>/dev/null | grep -q "github.com"; then
        echo "  🔗 Removing GitHub remotes..."
        git remote remove origin 2>/dev/null || true
        git remote remove upstream 2>/dev/null || true
        git remote remove github 2>/dev/null || true
        echo "  ✅ GitHub remotes removed"
    fi
    
    # Remove .git directory
    rm -rf .git
    echo "  ✅ Git repository unlinked"
done

# Check root directory for git
if [ -d "/root/.git" ] || [ -f "/root/.git/config" ]; then
    echo "📁 Found git repository in /root"
    cd /root
    git remote remove origin 2>/dev/null || true
    git remote remove upstream 2>/dev/null || true
    rm -rf .git
    echo "✅ Root git repository unlinked"
fi

# 5. Remove GitHub Actions and CI/CD files
echo ""
echo "🗑️  Removing GitHub Actions and CI/CD files..."
find /home -name ".github" -type d 2>/dev/null -exec rm -rf {} + || true
find /root -name ".github" -type d 2>/dev/null -exec rm -rf {} + || true
echo "✅ GitHub Actions removed"

# 6. Remove all files in common deployment directories
echo ""
echo "🗑️  Removing files from common directories..."

# Remove files from home directory (except hidden system files)
if [ -d "/home" ]; then
    find /home -mindepth 1 -maxdepth 1 -type d ! -name ".*" -exec rm -rf {} + 2>/dev/null || true
    find /home -mindepth 1 -maxdepth 1 -type f ! -name ".*" -delete 2>/dev/null || true
fi

# Remove files from /var/www (common web directory)
if [ -d "/var/www" ]; then
    rm -rf /var/www/* 2>/dev/null || true
fi

# Remove files from /opt (optional applications)
if [ -d "/opt" ]; then
    rm -rf /opt/* 2>/dev/null || true
fi

# Remove files from current directory if in a project folder
if [ "$CURRENT_DIR" != "/" ] && [ "$CURRENT_DIR" != "/root" ] && [ "$CURRENT_DIR" != "/home" ]; then
    echo "🗑️  Removing files from current directory: $CURRENT_DIR"
    cd /
    rm -rf "$CURRENT_DIR"/* 2>/dev/null || true
fi

# 7. Clean up system files
echo ""
echo "🧹 Cleaning up system files..."

# Remove npm cache
if command -v npm &> /dev/null; then
    npm cache clean --force 2>/dev/null || true
fi

# Remove node_modules directories
find /home -name "node_modules" -type d -exec rm -rf {} + 2>/dev/null || true
find /root -name "node_modules" -type d -exec rm -rf {} + 2>/dev/null || true
find /var/www -name "node_modules" -type d -exec rm -rf {} + 2>/dev/null || true

# Remove .env files (for security)
find /home -name ".env" -type f -delete 2>/dev/null || true
find /root -name ".env" -type f -delete 2>/dev/null || true

# 8. Clean up logs
echo ""
echo "📋 Cleaning up logs..."
rm -rf /var/log/*.log 2>/dev/null || true
rm -rf ~/.pm2/logs/* 2>/dev/null || true

# 9. Remove uploads directory if exists
echo ""
echo "🗑️  Removing uploads directory..."
rm -rf /home/*/uploads 2>/dev/null || true
rm -rf /var/www/*/uploads 2>/dev/null || true
rm -rf /root/uploads 2>/dev/null || true

echo ""
echo "✅ Cleanup completed!"
echo ""
echo "📊 Summary:"
echo "  - All PM2 processes stopped"
echo "  - All Docker containers removed"
echo "  - All Node processes killed"
echo "  - All GitHub repositories unlinked"
echo "  - All files removed from common directories"
echo "  - System cleaned up"
echo ""
echo "💡 The droplet is now clean and ready for fresh deployment."

