# 🚀 Fly.io Deployment Guide for hüm

## Prerequisites

1. Install Fly CLI:
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. Sign up for Fly.io:
   - Go to https://fly.io
   - Sign up (free tier includes 3 VMs)

## Step 1: Deploy Backend on Fly.io

1. **Login to Fly.io:**
   ```bash
   fly auth login
   ```

2. **Navigate to backend directory:**
   ```bash
   cd backend
   ```

3. **Launch your app (first time only):**
   ```bash
   fly launch
   ```
   
   When prompted:
   - App name: `hum-backend` (or choose your own)
   - Region: Choose closest to you (e.g., `iad` for US East)
   - Postgres? No
   - Redis? No
   - Deploy now? No (we'll add env vars first)

4. **Add environment variables:**
   ```bash
   fly secrets set ACR_HOST=your_acr_host
   fly secrets set ACR_ACCESS_KEY=your_access_key
   fly secrets set ACR_ACCESS_SECRET=your_access_secret
   fly secrets set SPOTIFY_CLIENT_ID=your_spotify_client_id
   fly secrets set SPOTIFY_CLIENT_SECRET=your_spotify_secret
   fly secrets set OPENAI_API_KEY=your_openai_key
   fly secrets set JWT_SECRET=$(openssl rand -base64 32)
   fly secrets set STRIPE_SECRET_KEY=your_stripe_secret_key
   fly secrets set STRIPE_WEBHOOK_SECRET=your_webhook_secret
   fly secrets set FEEDBACK_EMAIL_USER=your_email
   fly secrets set FEEDBACK_EMAIL_PASSWORD=your_email_password
   fly secrets set FRONTEND_URL=https://your-frontend-url.com
   ```

   Or add them all at once:
   ```bash
   fly secrets set \
     ACR_HOST=your_acr_host \
     ACR_ACCESS_KEY=your_access_key \
     ACR_ACCESS_SECRET=your_access_secret \
     SPOTIFY_CLIENT_ID=your_spotify_client_id \
     SPOTIFY_CLIENT_SECRET=your_spotify_secret \
     OPENAI_API_KEY=your_openai_key \
     JWT_SECRET=$(openssl rand -base64 32) \
     STRIPE_SECRET_KEY=your_stripe_secret_key \
     STRIPE_WEBHOOK_SECRET=your_webhook_secret \
     FEEDBACK_EMAIL_USER=your_email \
     FEEDBACK_EMAIL_PASSWORD=your_email_password \
     FRONTEND_URL=https://your-frontend-url.com
   ```

5. **Deploy:**
   ```bash
   fly deploy
   ```

6. **Get your backend URL:**
   ```bash
   fly status
   ```
   Your backend will be at: `https://hum-backend.fly.dev`

## Step 2: Deploy Frontend (Vercel Recommended)

Since Fly.io is better for backends, deploy frontend on Vercel (free):

1. Go to https://vercel.com
2. Import your GitHub repo
3. Set root directory: `frontend`
4. Add environment variable:
   - `VITE_API_URL` = `https://hum-backend.fly.dev`
5. Deploy!

## Step 3: Update Configuration

1. **Update FRONTEND_URL in Fly.io:**
   ```bash
   fly secrets set FRONTEND_URL=https://your-vercel-app.vercel.app
   ```

2. **Set up Stripe Webhook:**
   - Go to Stripe Dashboard → Webhooks
   - Add endpoint: `https://hum-backend.fly.dev/api/payments/webhook`
   - Select events: `checkout.session.completed` and `customer.subscription.deleted`
   - Copy webhook secret
   - Update in Fly.io:
     ```bash
     fly secrets set STRIPE_WEBHOOK_SECRET=whsec_your_secret
     ```

## Useful Fly.io Commands

```bash
# View logs
fly logs

# Check status
fly status

# SSH into your app
fly ssh console

# Scale your app (free tier: 1 shared-cpu-1x, 256MB)
fly scale count 1

# View secrets (values hidden)
fly secrets list

# Update secrets
fly secrets set KEY=value

# Restart app
fly apps restart hum-backend

# Open app in browser
fly open
```

## Fly.io Free Tier Limits

- **3 VMs** (shared-cpu-1x, 256MB RAM)
- **3GB storage** per VM
- **160GB outbound transfer** per month
- **Auto-scales to zero** when idle (but wakes up instantly)
- **Custom domains** supported
- **Note**: Filesystem is ephemeral - data in `users.json` will persist during runtime but may be lost on redeploy. For production, consider using a database.

## Troubleshooting

1. **Build fails:**
   - Check `fly logs` for errors
   - Make sure all dependencies are in `package.json`

2. **App won't start:**
   - Check environment variables: `fly secrets list`
   - View logs: `fly logs`

3. **Port issues:**
   - Make sure server listens on `process.env.PORT` (Fly.io sets this to 8080)

4. **Database/file storage:**
   - Fly.io VMs are ephemeral
   - Consider using Fly.io Volumes for persistent storage (if needed for users.json)
   - Or use a database service for production

## Next Steps

1. Set up custom domain (optional)
2. Configure monitoring
3. Set up CI/CD (auto-deploy on git push)

