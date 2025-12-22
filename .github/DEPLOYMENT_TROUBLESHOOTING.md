# GitHub Actions Deployment Troubleshooting

## SSH Key Issues

### Problem: "ssh: this private key is passphrase protected"

If your SSH key has a passphrase, you have two options:

#### Option 1: Add Passphrase to GitHub Secrets (Recommended)

1. Go to your GitHub repository → Settings → Secrets and variables → Actions
2. Add a new secret:
   - **Name**: `DROPLET_SSH_PASSPHRASE`
   - **Value**: Your SSH key passphrase

The workflow will automatically use this passphrase.

#### Option 2: Generate a New SSH Key Without Passphrase (More Secure for CI/CD)

Generate a dedicated SSH key for CI/CD without a passphrase:

```bash
# Generate a new SSH key specifically for CI/CD
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/github_actions_deploy -N ""

# Copy the public key to your droplet
ssh-copy-id -i ~/.ssh/github_actions_deploy.pub root@157.245.218.43

# Or manually add the public key
cat ~/.ssh/github_actions_deploy.pub
# Then on your droplet:
# echo "YOUR_PUBLIC_KEY" >> ~/.ssh/authorized_keys
```

Then update your GitHub Secret:
1. Go to GitHub → Settings → Secrets → Actions
2. Update `DROPLET_SSH_KEY` with the contents of:
   ```bash
   cat ~/.ssh/github_actions_deploy
   ```

#### Option 3: Remove Passphrase from Existing Key (Less Secure)

```bash
# Backup your original key first!
cp ~/.ssh/id_rsa ~/.ssh/id_rsa.backup

# Remove passphrase
ssh-keygen -p -f ~/.ssh/id_rsa

# When prompted for new passphrase, press Enter (leave empty)
```

**Warning**: Only do this if you're comfortable with having an unencrypted private key.

## Required GitHub Secrets

Make sure you have these secrets configured:

1. **DROPLET_IP**: `157.245.218.43`
2. **DROPLET_SSH_KEY**: Your private SSH key (contents of `~/.ssh/id_rsa` or similar)
3. **DROPLET_SSH_PASSPHRASE**: (Optional) Your SSH key passphrase if the key is encrypted

## Testing SSH Connection

Test your SSH connection manually:

```bash
# Test SSH connection
ssh -i ~/.ssh/id_rsa root@157.245.218.43

# If it works, your key is correct
# If it asks for a passphrase, you need to add DROPLET_SSH_PASSPHRASE secret
```

## Common Issues

### "ssh: unable to authenticate"

- Check that your SSH key is correctly added to GitHub Secrets
- Verify the key has the correct permissions: `chmod 600 ~/.ssh/id_rsa`
- Ensure the public key is in `~/.ssh/authorized_keys` on the droplet

### "Permission denied (publickey)"

- Verify the public key is on the droplet:
  ```bash
  ssh root@157.245.218.43 "cat ~/.ssh/authorized_keys"
  ```
- Make sure the key format is correct (starts with `-----BEGIN` and ends with `-----END`)

### Deployment Script Fails

- Check that `.env` file exists on the droplet
- Verify Docker is installed: `docker --version`
- Check container logs: `docker compose logs`

## Manual Deployment

If GitHub Actions continues to fail, you can deploy manually:

```bash
ssh root@157.245.218.43
cd /opt/worxstream-agent
git pull origin main
./scripts/deploy.sh
```

