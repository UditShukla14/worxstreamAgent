# Deployment Scripts

Scripts for deploying the Worxstream AI Agent.

## deploy.sh

Main deployment script for the Worxstream AI Agent on DigitalOcean droplet.

### Usage

```bash
# On your droplet
cd /opt/worxstream-agent
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

### What it does

1. Pulls latest changes from GitHub
2. Checks for required `.env` file
3. Installs Docker and Docker Compose if needed
4. Builds the Docker image
5. Starts the container
6. Verifies the service is running

### Prerequisites

- Docker and Docker Compose installed
- `.env` file configured with required environment variables
- Git repository cloned in `/opt/worxstream-agent`

### Environment Variables

Required variables in `.env`:
- `ANTHROPIC_API_KEY` - Your Claude API key
- `WORXSTREAM_BASE_URL` - Worxstream API URL
- `WORXSTREAM_API_TOKEN` - Your Worxstream API token
- `DEFAULT_COMPANY_ID` - Default company ID
- `DEFAULT_USER_ID` - Default user ID
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (production)

### Troubleshooting

If deployment fails:
```bash
# Check container logs
docker compose logs -f

# Check container status
docker ps -a

# Restart deployment
./scripts/deploy.sh
```
