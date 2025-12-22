# Deployment Guide for Worxstream AI Agent

This guide covers deploying the Worxstream AI Agent to your DigitalOcean droplet using Docker.

## Prerequisites

- DigitalOcean droplet with Ubuntu 24.10
- SSH access to the droplet (IP: 157.245.218.43)
- GitHub repository: https://github.com/UditShukla14/worxstreamAgent.git

## Option 1: Automated Deployment with GitHub Actions (Recommended)

### Step 1: Set up GitHub Secrets

Go to your GitHub repository → Settings → Secrets and variables → Actions, and add:

1. **DROPLET_IP**: `157.245.218.43`
2. **DROPLET_SSH_KEY**: Your private SSH key (the one you use to SSH into the droplet)

To get your SSH key:
```bash
cat ~/.ssh/id_rsa
# Copy the entire output including -----BEGIN and -----END lines
```

### Step 2: Initial Setup on Droplet

Ensure Docker and Docker Compose are installed on your droplet:

```bash
ssh root@157.245.218.43

# Install Docker (if not already installed)
curl -fsSL https://get.docker.com | sh
systemctl start docker
systemctl enable docker

# Verify installation
docker --version
docker compose version
```

### Step 3: Configure Environment Variables

```bash
cd /opt/worxstream-agent
cp .env.example .env
nano .env
```

Fill in your environment variables:
- `ANTHROPIC_API_KEY` - Your Claude API key
- `WORXSTREAM_BASE_URL` - Worxstream API URL (default: https://api.worxstream.io)
- `WORXSTREAM_API_TOKEN` - Your Worxstream API token
- `BACKEND_URL` - Public URL for the backend API (default: https://mcp.worxstream.io)
- `DEFAULT_COMPANY_ID` - Your company ID (default: 1)
- `DEFAULT_USER_ID` - Your user ID (default: 1)
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (production/development)
- `MONGODB_URL` - MongoDB connection string (optional, has default)

### Step 4: Enable GitHub Actions

Once you push to the `main` branch, GitHub Actions will automatically:
1. Build the Docker image
2. Deploy to your droplet
3. Start the container

## Option 2: Manual Deployment

### Step 1: Clone Repository

```bash
cd /opt/worxstream-agent
git clone https://github.com/UditShukla14/worxstreamAgent.git .
```

### Step 3: Configure Environment

```bash
cp .env.example .env
nano .env
# Fill in your environment variables
```

### Step 3: Deploy

```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

## Option 3: Direct Docker Commands

```bash
cd /opt/worxstream-agent

# Build image
docker-compose build

# Start container
docker-compose up -d

# View logs
docker-compose logs -f

# Stop container
docker-compose down
```

## Managing the Deployment

### View Logs
```bash
cd /opt/worxstream-agent
docker-compose logs -f
```

### Restart Service
```bash
docker-compose restart
```

### Update Deployment
```bash
cd /opt/worxstream-agent
git pull origin main
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### Check Status
```bash
docker ps
curl http://localhost:3000/health
```

## Setting up Nginx Reverse Proxy (Optional)

If you want to use a domain name and HTTPS:

```bash
# Install Nginx
apt-get install -y nginx certbot python3-certbot-nginx

# Create Nginx config
nano /etc/nginx/sites-available/worxstream-agent
```

Add this configuration:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable and restart:
```bash
ln -s /etc/nginx/sites-available/worxstream-agent /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx

# Set up SSL
certbot --nginx -d your-domain.com
```

## Troubleshooting

### Container won't start
```bash
docker-compose logs
docker ps -a
```

### Port already in use
```bash
# Check what's using port 3000
lsof -i :3000
# Or change port in docker-compose.yml
```

### Environment variables not loading
```bash
# Check .env file exists and has correct format
cat .env
# Restart container
docker-compose restart
```

### Build fails
```bash
# Clean Docker cache
docker system prune -a
docker-compose build --no-cache
```

## Monitoring

### Health Check
```bash
curl http://localhost:3000/health
```

### Container Stats
```bash
docker stats worxstream-agent
```

### Disk Usage
```bash
df -h
docker system df
```

## Security Notes

1. **Never commit `.env` file** - It's in `.gitignore`
2. **Use strong SSH keys** - Don't share your private key
3. **Keep system updated** - Run `apt-get update && apt-get upgrade` regularly
4. **Firewall** - Only open necessary ports
5. **SSL/HTTPS** - Use Certbot for production

## Backup

### Backup Environment Variables
```bash
cp /opt/worxstream-agent/.env /root/worxstream-agent.env.backup
```

### Backup Uploads
```bash
tar -czf uploads-backup-$(date +%Y%m%d).tar.gz /opt/worxstream-agent/uploads
```

## Rollback

If something goes wrong:

```bash
cd /opt/worxstream-agent
git log  # Find previous working commit
git checkout <previous-commit-hash>
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

