# Quick Start Deployment Guide

## 🚀 Fastest Way to Deploy

### Step 1: Set up GitHub Secrets (for auto-deployment)

1. Go to: https://github.com/UditShukla14/worxstreamAgent/settings/secrets/actions
2. Add these secrets:
   - **DROPLET_IP**: `157.245.218.43`
   - **DROPLET_SSH_KEY**: Your private SSH key (from `~/.ssh/id_rsa`)

### Step 2: Initial Setup on Droplet

Ensure Docker is installed on your droplet:

```bash
# SSH into droplet
ssh root@157.245.218.43

# Install Docker (if not already installed)
curl -fsSL https://get.docker.com | sh
systemctl start docker
systemctl enable docker

# Create app directory
mkdir -p /opt/worxstream-agent
cd /opt/worxstream-agent
```

### Step 3: Configure Environment

```bash
cd /opt/worxstream-agent
cp .env.example .env
nano .env
```

Fill in:
- `ANTHROPIC_API_KEY=sk-ant-...`
- `WORXSTREAM_BASE_URL=https://api.worxstream.io`
- `WORXSTREAM_API_TOKEN=your_token`
- `DEFAULT_COMPANY_ID=1`
- `DEFAULT_USER_ID=1`

### Step 4: Deploy

**Option A: Manual Deployment**
```bash
cd /opt/worxstream-agent
git clone https://github.com/UditShukla14/worxstreamAgent.git .
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

**Option B: Auto-deployment (after GitHub secrets are set)**
Just push to `main` branch - GitHub Actions will deploy automatically!

```bash
git push origin main
```

## ✅ Verify Deployment

```bash
# Check container is running
docker ps

# Check health
curl http://localhost:3000/health

# View logs
docker-compose logs -f
```

## 📝 Next Steps

- Set up domain name (optional)
- Configure Nginx reverse proxy (optional)
- Set up SSL certificate (optional)

See `DEPLOYMENT.md` for detailed instructions.

