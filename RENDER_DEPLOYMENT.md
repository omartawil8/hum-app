# 🚀 Render Deployment Guide for hüm

## Prerequisites

1. Sign up for Render (free account):
   - Go to https://render.com
   - Sign up with GitHub (free tier available)

## Step 1: Deploy Backend on Render

1. **Go to Render Dashboard:**
   - Click "New +" → "Web Service"

2. **Connect Repository:**
   - Connect your GitHub account if not already connected
   - Select your `hum-app` repository

3. **Configure Backend Service:**
   - **Name**: `hum-backend` (or any name you prefer)
   - **Region**: Choose closest to you (e.g., `Oregon (US West)` or `Frankfurt (EU)`)
   - **Branch**: `main` (or your default branch)
   - **Root Directory**: `backend`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: **Free** (spins down after 15 min inactivity, wakes up on request)

4. **Add Environment Variables:**
   Click "Environment" tab and add:
   - `ACR_HOST` = your ACR host
   - `ACR_ACCESS_KEY` = your ACR access key
   - `ACR_ACCESS_SECRET` = your ACR access secret
   - `SPOTIFY_CLIENT_ID` = your Spotify client ID
   - `SPOTIFY_CLIENT_SECRET` = your Spotify client secret
   - `OPENAI_API_KEY` = your OpenAI API key
   - `JWT_SECRET` = generate with: `openssl rand -base64 32`
   - `STRIPE_SECRET_KEY` = your Stripe secret key
   - `STRIPE_WEBHOOK_SECRET` = (set after webhook setup)
   - `FEEDBACK_EMAIL_USER` = your email
   - `FEEDBACK_EMAIL_PASSWORD` = your email app password
   - `FRONTEND_URL` = (set after deploying frontend)

5. **Create Web Service:**
   - Click "Create Web Service"
   - Render will start building and deploying
   - Your backend will be at: `https://hum-backend.onrender.com` (or your custom name)

6. **Note about Free Tier:**
   - First request after 15 min inactivity takes ~30-60 seconds (cold start)
   - Subsequent requests are fast
   - No credit card required

## Step 2: Deploy Frontend on Vercel (Recommended - FREE)

Since Render's static site hosting is slower, use Vercel for frontend:

1. **Go to Vercel:**
   - Visit https://vercel.com
   - Sign up with GitHub (free forever)

2. **Import Project:**
   - Click "Add New Project"
   - Import your `hum-app` repository

3. **Configure:**
   - **Root Directory**: `frontend`
   - **Framework Preset**: Vite (auto-detected)
   - **Build Command**: `npm run build` (auto-detected)
   - **Output Directory**: `dist` (auto-detected)

4. **Add Environment Variable:**
   - `VITE_API_URL` = `https://hum-backend.onrender.com` (your Render backend URL)

5. **Deploy:**
   - Click "Deploy"
   - Vercel will give you a URL like: `https://hum-app.vercel.app`

## Step 3: Update Configuration

1. **Update FRONTEND_URL in Render:**
   - Go back to Render dashboard
   - Click on your backend service
   - Go to "Environment" tab
   - Update `FRONTEND_URL` = your Vercel URL (e.g., `https://hum-app.vercel.app`)
   - Save changes (will trigger a redeploy)

2. **Set Up Stripe Webhook:**
   - Go to Stripe Dashboard → Developers → Webhooks
   - Click "Add endpoint"
   - **Endpoint URL**: `https://hum-backend.onrender.com/api/payments/webhook`
   - **Events to send**: 
     - `checkout.session.completed`
     - `customer.subscription.deleted`
   - Click "Add endpoint"
   - Copy the **Signing secret** (starts with `whsec_`)
   - Go back to Render → Environment tab
   - Update `STRIPE_WEBHOOK_SECRET` = your webhook secret
   - Save (will redeploy)

## Step 4: Test Your Deployment

1. Visit your Vercel frontend URL
2. Try signing up
3. Test a search (humming or lyrics)
4. Test payment flow (use Stripe test cards)

## Alternative: Render for Both (FREE but slower)

If you want everything on Render:

**Frontend on Render:**
1. In Render, click "New +" → "Static Site"
2. Connect same GitHub repo
3. Configure:
   - **Name**: `hum-frontend`
   - **Root Directory**: `frontend` ⚠️ **This makes Render run commands FROM the frontend directory**
   - **Build Command**: `npm install && npm run build` (NO `cd frontend` - you're already there!)
   - **Publish Directory**: `dist` (NOT `frontend/dist` - you're already in frontend directory)
4. Add environment variable:
   - `VITE_API_URL` = `https://hum-backend.onrender.com`
5. Deploy!

**If you get "cd frontend" error:**
   - The error means you used `cd frontend` in the build command
   - **Fix**: Remove `cd frontend &&` from Build Command
   - Use: `npm install && npm run build`
   - Keep Root Directory as `frontend`
   - Keep Publish Directory as `dist`

## Render Free Tier Details

- **Backend**: Free tier available
  - Spins down after 15 min inactivity
  - Wakes up automatically on request (~30-60 sec first time)
  - 750 hours/month free
  - Custom domains supported

- **Static Sites**: Free tier available
  - Instant deployment
  - Global CDN
  - Custom domains supported

## Useful Render Features

- **Auto-deploy**: Automatically deploys on git push to main branch
- **Logs**: View real-time logs in dashboard
- **Metrics**: Monitor CPU, memory, requests
- **Custom domains**: Add your own domain for free

## Troubleshooting

1. **Build fails:**
   - Check logs in Render dashboard
   - Make sure all dependencies are in `package.json`
   - Verify root directory is correct

2. **App won't start:**
   - Check environment variables are set
   - View logs: Click on service → "Logs" tab
   - Verify start command is `npm start`

3. **Slow first request:**
   - Normal for free tier (cold start)
   - Subsequent requests are fast
   - Consider upgrading to paid plan for always-on

4. **Webhook not working:**
   - Verify webhook URL is correct
   - Check webhook secret matches in Render
   - View logs for webhook errors

## Environment Variables Checklist

### Backend (Render):
- `PORT` (auto-set by Render)
- `ACR_HOST`
- `ACR_ACCESS_KEY`
- `ACR_ACCESS_SECRET`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `OPENAI_API_KEY`
- `JWT_SECRET`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `FRONTEND_URL`
- `FEEDBACK_EMAIL_USER`
- `FEEDBACK_EMAIL_PASSWORD`

### Frontend (Vercel):
- `VITE_API_URL`

## Next Steps

1. Set up custom domain (optional)
2. Configure monitoring/alerts
3. Set up database for persistent user storage (if needed)

