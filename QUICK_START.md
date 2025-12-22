# Quick Start Deployment Guide

## 🚀 Fastest Way to Deploy

### Step 1: Set up GitHub Secrets (for auto-deployment)

1. Go to: https://github.com/UditShukla14/worxstreamAgent/settings/secrets/actions
2. Add these secrets:
   - **DROPLET_IP**: `157.245.218.43`
   - **DROPLET_SSH_KEY**: Your private SSH key (from `~/.ssh/id_rsa`)

### Step 2: Initial Setup on Droplet

```bash
# SSH into droplet
ssh root@157.245.218.43

# Upload and run setup script
# From your local machine:
scp scripts/setup-droplet.sh root@157.245.218.43:/root/
scp scripts/deploy.sh root@157.245.218.43:/root/

# On droplet:
chmod +x setup-droplet.sh deploy.sh
./setup-droplet.sh
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
./deploy.sh
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

