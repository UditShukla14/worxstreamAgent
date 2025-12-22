# Deployment Scripts

## deploy.sh

Deployment script for Worxstream AI Agent.

**Usage:**
```bash
cd /opt/worxstream-agent
./scripts/deploy.sh
```

**Requirements:**
- Root access
- `.env` file with required variables
- Git repository access

**Environment Variables:**
- `ANTHROPIC_API_KEY` (required)
- `WORXSTREAM_API_TOKEN` (required)
- `BACKEND_URL` (default: https://mcp.worxstream.io)
- `PORT` (default: 3000)
- `NODE_ENV` (default: production)

**Troubleshooting:**
```bash
docker compose logs -f
docker ps -a
```
