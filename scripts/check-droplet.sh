#!/bin/bash

# Check script for DigitalOcean Droplet
# This script will show what's currently on the droplet before cleanup

echo "🔍 Checking DigitalOcean Droplet contents..."
echo ""

# Check current user
echo "👤 Current user: $(whoami)"
echo "📍 Current directory: $(pwd)"
echo ""

# Check for running processes
echo "🔄 Running Processes:"
echo "--- PM2 Processes ---"
if command -v pm2 &> /dev/null; then
    pm2 list || echo "No PM2 processes"
else
    echo "PM2 not installed"
fi
echo ""

echo "--- Docker Containers ---"
if command -v docker &> /dev/null; then
    docker ps -a || echo "No Docker containers"
else
    echo "Docker not installed"
fi
echo ""

echo "--- Node Processes ---"
ps aux | grep node | grep -v grep || echo "No Node processes running"
echo ""

# Check for git repositories
echo "🔗 Git Repositories:"
find /home -name ".git" -type d 2>/dev/null | while read git_dir; do
    repo_dir=$(dirname "$git_dir")
    echo "📁 Repository: $repo_dir"
    cd "$repo_dir"
    git remote -v 2>/dev/null | head -5 || echo "  No remotes"
    echo ""
done

if [ -d "/root/.git" ] || [ -f "/root/.git/config" ]; then
    echo "📁 Repository: /root"
    cd /root
    git remote -v 2>/dev/null | head -5 || echo "  No remotes"
    echo ""
fi

# Check common directories
echo "📂 Directory Contents:"
echo "--- /home ---"
ls -la /home 2>/dev/null | head -10 || echo "Empty or inaccessible"
echo ""

echo "--- /var/www ---"
ls -la /var/www 2>/dev/null | head -10 || echo "Empty or inaccessible"
echo ""

echo "--- Current Directory ---"
ls -la . | head -20 || echo "Empty"
echo ""

# Check disk usage
echo "💾 Disk Usage:"
df -h | grep -E "Filesystem|/dev/"
echo ""

echo "✅ Check completed!"

