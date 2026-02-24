# Deployment Guide for Worxstream AI Agent

This guide covers deploying the Worxstream AI Agent to your DigitalOcean droplet using **PM2** (recommended) or Docker.

## Prerequisites

- DigitalOcean droplet with Ubuntu 24.10
- SSH access to the droplet (IP: 157.245.218.43)
- GitHub repository: https://github.com/UditShukla14/worxstreamAgent.git

## Option 1: PM2 with GitHub Actions (Recommended)

### Step 1: Set up GitHub Secrets

Go to your GitHub repository → Settings → Secrets and variables → Actions, and add:

1. **DROPLET_IP**: `157.245.218.43`
2. **DROPLET_SSH_KEY**: Your private SSH key (the one you use to SSH into the droplet)
3. **DROPLET_SSH_PASSPHRASE**: (optional) Passphrase for the key, if set

To get your SSH key:
```bash
cat ~/.ssh/id_rsa
# Copy the entire output including -----BEGIN and -----END lines
```

### Step 2: Initial setup on the droplet (one-time)

SSH in and install Node.js, PM2, and the app:

```bash
ssh root@157.245.218.43

# Install Node.js 20 (if not already installed)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install PM2 globally
npm install -g pm2

# Clone app and configure
mkdir -p /opt/worxstream-agent
cd /opt/worxstream-agent
git clone https://github.com/UditShukla14/worxstreamAgent.git .
cp .env.example .env
nano .env   # fill in ANTHROPIC_API_KEY, WORXSTREAM_*, etc.

# Install dependencies and start with PM2
npm ci --omit=dev
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # run the command it prints so the app restarts on reboot
```

### Step 3: Environment variables

In `/opt/worxstream-agent/.env` set at least:

- `ANTHROPIC_API_KEY` - Your Claude API key
- `WORXSTREAM_BASE_URL` - Worxstream API URL (default: https://api.worxstream.io)
- `WORXSTREAM_API_TOKEN` - Your Worxstream API token
- `BACKEND_URL` - Public URL for the backend API (default: https://mcp.worxstream.io)
- `DEFAULT_COMPANY_ID`, `DEFAULT_USER_ID`, `PORT` (default 3000), `NODE_ENV`, `MONGODB_URL` (optional)

### Step 4: Deployments

- **Automatic:** Push to `main` or run the "Deploy to DigitalOcean" workflow. It will SSH in, pull code, run `npm ci --omit=dev`, then `pm2 restart mcp-backend` (or start from `ecosystem.config.cjs` if not running).
- **Manual:**  
  ```bash
  ssh root@<DROPLET_IP>
  cd /opt/worxstream-agent
  git pull origin main
  npm ci --omit=dev
  pm2 restart mcp-backend --update-env
  pm2 save
  ```

## Restarting after the droplet was stopped

**Same droplet, app already set up at `/opt/worxstream-agent`:**

1. **Via GitHub Actions:** Run the "Deploy to DigitalOcean" workflow (or push to `main`). It will pull and restart PM2.
2. **Via SSH:**  
   ```bash
   ssh root@<DROPLET_IP>
   cd /opt/worxstream-agent
   git pull origin main
   npm ci --omit=dev
   pm2 restart mcp-backend
   pm2 save
   ```

**Droplet recreated or `/opt/worxstream-agent` empty:** Do the full one-time setup again (Step 2 above), then use the workflow or manual deploy.

## Option 2: Manual PM2 (no GitHub Actions)

### Clone and configure

```bash
ssh root@<DROPLET_IP>
mkdir -p /opt/worxstream-agent && cd /opt/worxstream-agent
git clone https://github.com/UditShukla14/worxstreamAgent.git .
cp .env.example .env
nano .env
npm ci --omit=dev
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup
```

### Update later

```bash
cd /opt/worxstream-agent
git pull origin main
npm ci --omit=dev
pm2 restart mcp-backend
pm2 save
```

## Option 3: Docker (alternative)

If you prefer Docker instead of PM2, use the deploy script (see `scripts/deploy.sh`). The GitHub Action is configured for PM2; for Docker you would run the script over SSH yourself.

```bash
cd /opt/worxstream-agent
git pull origin main
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

Or run Docker Compose directly:

```bash
cd /opt/worxstream-agent
docker compose build
docker compose up -d
docker compose logs -f
docker compose down
```

## Managing the Deployment

### View logs (PM2)
```bash
pm2 logs mcp-backend
# or
pm2 logs
```

### Restart (PM2)
```bash
pm2 restart mcp-backend
pm2 save
```

### Check status
```bash
pm2 status
curl http://localhost:3000/health
```

### Docker (if you use Option 3)
```bash
cd /opt/worxstream-agent
docker compose logs -f
docker compose restart
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

### GitHub Actions deploy fails

- **SSH or key error:** Check `DROPLET_IP`, `DROPLET_SSH_KEY`, and `DROPLET_SSH_PASSPHRASE` in repo secrets.
- **`pm2: command not found`:** Install PM2 on the droplet: `npm install -g pm2` (after Node.js is installed).
- **App won’t start or crashes:** Ensure `/opt/worxstream-agent/.env` exists and has valid values. SSH in and run `pm2 logs mcp-backend` to see the error.

### Container won't start
```bash
docker-compose logs
docker ps -a
```

### PM2: "One of the pids provided is invalid" (pidusage)

If you run the app with PM2 and see this in logs, it’s a known PM2/pidusage issue when a process restarts or a PID goes stale. The app keeps working; the message is noise. To reduce it: upgrade PM2 (`npm i -g pm2@latest`) or ignore it.

### Port already in use

The deploy script automatically stops any **Docker container** (and, if needed, any process) using port 3000. If you still see "address already in use", something else is holding the port:

```bash
# On the droplet: see what is using port 3000
lsof -i :3000
# Stop that process or change PORT in .env and the port mapping in docker-compose.yml
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

