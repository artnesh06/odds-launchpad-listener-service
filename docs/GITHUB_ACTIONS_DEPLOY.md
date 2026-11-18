# GitHub Actions - Deploy ke Cloud Server (Secure)

## Security Features

Workflow ini sudah dilengkapi dengan:

- ✅ **Vulnerability scanning** - Trivy scan sebelum deploy
- ✅ **Minimal permissions** - Principle of least privilege
- ✅ **Container registry** - Image disimpan di GitHub Container Registry (private)
- ✅ **Image signing** - Provenance dan SBOM untuk supply chain security
- ✅ **Hardened container** - Read-only, no-new-privileges, cap-drop ALL
- ✅ **Resource limits** - Memory dan CPU limits mencegah DoS
- ✅ **Auto rollback** - Rollback otomatis jika health check gagal
- ✅ **Environment protection** - Approval required untuk production
- ✅ **Concurrency control** - Mencegah deploy bersamaan

---

## Setup GitHub

### 1. Repository Secrets

Settings → Secrets and variables → Actions → New repository secret

| Secret | Deskripsi |
|--------|-----------|
| `SERVER_HOST` | IP/domain server |
| `SERVER_USER` | Username SSH (jangan root, buat user khusus) |
| `SSH_PRIVATE_KEY` | Private key SSH |
| `SERVER_PORT` | Port SSH (ganti dari 22) |

### 2. Environment Protection

Settings → Environments → New environment → `production`

Aktifkan:
- ✅ Required reviewers (tambahkan reviewer)
- ✅ Wait timer (optional, misal 5 menit)
- ✅ Deployment branches → Selected branches → `main`

---

## Setup Server (Hardening)

### 1. Buat User Khusus Deploy (jangan pakai root!)

```bash
# Di server sebagai root
adduser deploy
# Set password sementara (nanti akan disable password auth)

# Tambahkan ke docker group
usermod -aG docker deploy

# Batasi sudo hanya untuk docker
echo "deploy ALL=(ALL) NOPASSWD: /usr/bin/docker" >> /etc/sudoers.d/deploy
chmod 440 /etc/sudoers.d/deploy
```

### 2. Setup SSH Key untuk User Deploy

**Di komputer lokal (Windows/Linux/Mac):**

```bash
# Generate SSH key khusus untuk deploy
ssh-keygen -t ed25519 -C "deploy-user" -f ~/.ssh/deploy_key

# Akan generate 2 file:
# ~/.ssh/deploy_key (private key - JANGAN SHARE!)
# ~/.ssh/deploy_key.pub (public key - ini yang di-copy ke server)
```

**Copy public key ke server:**

Opsi A - Menggunakan ssh-copy-id (Linux/Mac):
```bash
# Ganti YOUR_SERVER_IP dengan IP server kamu
ssh-copy-id -i ~/.ssh/deploy_key.pub deploy@YOUR_SERVER_IP
```

Opsi B - Manual (Windows atau jika ssh-copy-id tidak ada):
```bash
# 1. Tampilkan public key
cat ~/.ssh/deploy_key.pub
# atau di Windows PowerShell:
type ~\.ssh\deploy_key.pub

# 2. Copy output-nya (mulai dari ssh-ed25519 sampai akhir)

# 3. Login ke server sebagai root (untuk terakhir kalinya)
ssh root@YOUR_SERVER_IP

# 4. Di server, setup authorized_keys untuk user deploy
mkdir -p /home/deploy/.ssh
nano /home/deploy/.ssh/authorized_keys
# Paste public key yang tadi di-copy, save (Ctrl+X, Y, Enter)

# 5. Set permissions yang benar (PENTING!)
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
```

**Test koneksi dengan key:**
```bash
# Di komputer lokal
ssh -i ~/.ssh/deploy_key deploy@YOUR_SERVER_IP

# Jika berhasil, kamu sudah login sebagai deploy tanpa password!
```

### 3. SSH Hardening (Setelah Key Berhasil!)

**PENTING: Jangan lakukan ini sebelum test SSH key berhasil!**

```bash
# Di server sebagai root atau deploy dengan sudo
sudo nano /etc/ssh/sshd_config
```

Tambahkan/ubah konfigurasi ini:
```
# Ganti port default
Port 2222

# Disable root login
PermitRootLogin no

# Hanya allow user deploy
AllowUsers deploy

# Disable password auth (HANYA setelah SSH key berhasil!)
PasswordAuthentication no

# Use key only
PubkeyAuthentication yes

# Tambahan security
PermitEmptyPasswords no
ChallengeResponseAuthentication no
UsePAM yes
X11Forwarding no
MaxAuthTries 3
```

**Test konfigurasi sebelum restart:**
```bash
sudo sshd -t
# Jika tidak ada error, lanjut restart
```

**Restart SSH service:**
```bash
sudo systemctl restart sshd
```

**Test koneksi dengan port baru:**
```bash
# Di komputer lokal
ssh -i ~/.ssh/deploy_key -p 2222 deploy@YOUR_SERVER_IP
```

**PENTING:** Jangan logout dari session root yang lama sampai test berhasil! Buka terminal baru untuk test.

### 3. Firewall Setup

```bash
# UFW
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 2222/tcp    # SSH custom port
sudo ufw allow 80/tcp      # HTTP
sudo ufw allow 443/tcp     # HTTPS
sudo ufw enable
```

### 4. Setup Reverse Proxy (Nginx)

Container hanya expose ke localhost, gunakan Nginx sebagai reverse proxy:

```bash
sudo apt install nginx certbot python3-certbot-nginx

sudo nano /etc/nginx/sites-available/nft-listener
```

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/nft-listener /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# SSL dengan Let's Encrypt
sudo certbot --nginx -d your-domain.com
```

### 5. Environment File (Secure)

```bash
sudo mkdir -p /opt/nft-listener
sudo nano /opt/nft-listener/.env

# Set permissions ketat
sudo chown deploy:deploy /opt/nft-listener/.env
sudo chmod 600 /opt/nft-listener/.env
```

### 6. SSH Key untuk GitHub Actions

**Generate key terpisah untuk GitHub Actions:**

```bash
# Di komputer lokal
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/github_deploy

# Jangan set passphrase (tekan Enter 2x) karena untuk automation
```

**Copy public key ke server:**

```bash
# Opsi A - Menggunakan ssh-copy-id
ssh-copy-id -i ~/.ssh/github_deploy.pub -p 2222 deploy@YOUR_SERVER_IP

# Opsi B - Manual
# 1. Tampilkan public key
cat ~/.ssh/github_deploy.pub

# 2. Login ke server
ssh -i ~/.ssh/deploy_key -p 2222 deploy@YOUR_SERVER_IP

# 3. Tambahkan ke authorized_keys
echo "PUBLIC_KEY_YANG_TADI_DI_COPY" >> ~/.ssh/authorized_keys
```

**Test koneksi:**
```bash
ssh -i ~/.ssh/github_deploy -p 2222 deploy@YOUR_SERVER_IP
```

**Copy private key untuk GitHub Secret:**

```bash
# Linux/Mac
cat ~/.ssh/github_deploy

# Windows PowerShell
type ~\.ssh\github_deploy

# Copy SEMUA output (termasuk -----BEGIN dan -----END)
# Paste ke GitHub Secret: SSH_PRIVATE_KEY
```

---

## Security Checklist

### GitHub
- [ ] Repository private (jika memungkinkan)
- [ ] Branch protection enabled di `main`
- [ ] Require PR reviews sebelum merge
- [ ] Environment protection untuk production
- [ ] Secrets tidak di-hardcode di code

### Server
- [ ] SSH port diganti dari 22
- [ ] Root login disabled
- [ ] Password auth disabled
- [ ] Firewall aktif
- [ ] User deploy dengan minimal privileges
- [ ] Env file permission 600
- [ ] SSL/TLS enabled
- [ ] Container tidak expose langsung ke internet

### Container
- [ ] Run as non-root user
- [ ] Read-only filesystem
- [ ] No new privileges
- [ ] All capabilities dropped
- [ ] Resource limits set
- [ ] Health check configured

---

## Troubleshooting

### Deploy gagal - Permission denied
```bash
# Pastikan user deploy punya akses docker
sudo usermod -aG docker deploy
# Re-login required
```

### Health check gagal
```bash
# Cek container logs
docker logs nft-listener

# Cek health status
docker inspect --format='{{json .State.Health}}' nft-listener | jq
```

### Rollback manual
```bash
docker stop nft-listener
docker rm nft-listener
docker run -d --name nft-listener \
  -p 127.0.0.1:3000:3000 \
  --env-file /opt/nft-listener/.env \
  ghcr.io/YOUR_REPO:rollback
```
