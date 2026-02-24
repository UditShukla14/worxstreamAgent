#!/usr/bin/env bash
# Run this ON THE DROPLET (e.g. in /opt/worxstream-agent) to verify session route is present
# and to fix duplicate mcp-backend processes.

set -e
cd /opt/worxstream-agent

echo "=== 1. Check index.js has session mount ==="
if grep -q "sessionRoutes" src/routes/index.js && grep -q "'/session'" src/routes/index.js; then
  echo "OK: index.js has session route"
else
  echo "MISSING: index.js does not mount /session. Run: git pull origin main"
  exit 1
fi

echo ""
echo "=== 2. PM2 processes named mcp-backend ==="
pm2 list | grep mcp-backend || true

echo ""
echo "=== 3. Fix: use only one mcp-backend (ecosystem.config.cjs has instances: 1) ==="
echo "If you see two mcp-backend rows, delete all and start fresh:"
echo "  pm2 delete mcp-backend   # deletes all with that name"
echo "  pm2 start ecosystem.config.cjs"
echo "  pm2 save"
echo ""
echo "Then test: curl -s http://localhost:3000/session"
echo "Expected: {\"success\":true,\"active\":false,...}"
