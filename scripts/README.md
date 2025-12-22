# Droplet Cleanup Scripts

Scripts to clean up and unlink GitHub repositories from your DigitalOcean droplet.

## Prerequisites

- SSH access to your droplet (IP: 157.245.218.43)
- Root or sudo access on the droplet

## Step 1: Check Current Contents (Optional but Recommended)

First, check what's currently on the droplet:

```bash
# SSH into your droplet
ssh root@157.245.218.43
# OR if you use a different user:
ssh your-username@157.245.218.43

# Upload the check script
scp scripts/check-droplet.sh root@157.245.218.43:/root/

# Or copy-paste the script content directly
nano check-droplet.sh
# Paste the script content, save and exit (Ctrl+X, Y, Enter)

# Make it executable
chmod +x check-droplet.sh

# Run it
./check-droplet.sh
```

## Step 2: Cleanup the Droplet

**⚠️ WARNING: This will DELETE ALL CONTENTS on the droplet!**

```bash
# Upload the cleanup script
scp scripts/cleanup-droplet.sh root@157.245.218.43:/root/

# Or copy-paste the script content directly
nano cleanup-droplet.sh
# Paste the script content, save and exit

# Make it executable
chmod +x cleanup-droplet.sh

# Run it (it has a 10-second warning)
./cleanup-droplet.sh
```

## What the Cleanup Script Does

1. **Stops all services:**
   - PM2 processes
   - Docker containers
   - Node.js processes

2. **Unlinks GitHub repositories:**
   - Finds all `.git` directories
   - Removes GitHub remotes (origin, upstream, github)
   - Deletes `.git` directories

3. **Removes files:**
   - All files in `/home/*`
   - All files in `/var/www/*`
   - All files in `/opt/*`
   - GitHub Actions (`.github` directories)
   - `node_modules` directories
   - `.env` files

4. **Cleans up:**
   - npm cache
   - Log files
   - Uploads directories

## Alternative: Manual Cleanup

If you prefer to do it manually:

```bash
# SSH into droplet
ssh root@157.245.218.43

# Stop PM2
pm2 stop all
pm2 delete all
pm2 kill

# Stop Docker
docker stop $(docker ps -aq)
docker rm $(docker ps -aq)
docker system prune -af --volumes

# Kill Node processes
pkill -f node

# Find and remove git repositories
find /home -name ".git" -type d -exec rm -rf {} +
find /root -name ".git" -type d -exec rm -rf {} +

# Remove GitHub remotes (if in a git repo)
cd /path/to/repo
git remote remove origin
git remote remove upstream

# Remove all files
rm -rf /home/*
rm -rf /var/www/*
rm -rf /opt/*

# Remove GitHub Actions
find /home -name ".github" -type d -exec rm -rf {} +
find /root -name ".github" -type d -exec rm -rf {} +
```

## After Cleanup

Once cleanup is complete, your droplet will be clean and ready for:
- Fresh deployment
- New project setup
- New GitHub repository connection

## Verification

After cleanup, verify everything is removed:

```bash
# Check for remaining files
ls -la /home
ls -la /var/www

# Check for git repositories
find /home -name ".git" -type d
find /root -name ".git" -type d

# Check running processes
pm2 list
docker ps -a
ps aux | grep node
```

## Troubleshooting

If you encounter permission errors:
```bash
sudo ./cleanup-droplet.sh
```

If files are locked:
```bash
# Find and kill processes using files
lsof | grep /path/to/file
kill -9 <PID>
```

