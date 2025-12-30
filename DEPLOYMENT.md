# 🆓 FREE Deployment Guide for hüm

## Recommended: Render (Backend) + Vercel (Frontend) - 100% FREE

### Step 1: Deploy Backend on Render (FREE)

1. Go to https://render.com
2. Sign up with GitHub (free account)
3. Click "New +" → "Web Service"
4. Connect your GitHub repository
5. Configure:
   - **Name**: `hum-backend` (or any name)
   - **Root Directory**: `backend`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free (spins down after 15 min inactivity, but wakes up on request)
6. Add environment variables (click "Environment" tab):
   - Copy all from your `.env` file:
     - `ACR_HOST`
     - `ACR_ACCESS_KEY`
     - `ACR_ACCESS_SECRET`
     - `SPOTIFY_CLIENT_ID`
     - `SPOTIFY_CLIENT_SECRET`
     - `OPENAI_API_KEY`
     - `JWT_SECRET` (generate: `openssl rand -base64 32`)
     - `STRIPE_SECRET_KEY`
     - `STRIPE_WEBHOOK_SECRET` (get from Stripe after setting up webhook)
     - `FEEDBACK_EMAIL_USER`
     - `FEEDBACK_EMAIL_PASSWORD`
   - `FRONTEND_URL` = (set after deploying frontend)
7. Click "Create Web Service"
8. Render will give you a URL like `https://hum-backend.onrender.com`
9. **Note**: First request may take 30-60 seconds (cold start), subsequent requests are fast

### Step 2: Deploy Frontend on Vercel (FREE)

1. Go to https://vercel.com
2. Sign up with GitHub (free forever)
3. Click "Add New Project" → Import your GitHub repo
4. Configure:
   - **Root Directory**: `frontend`
   - **Framework Preset**: Vite (auto-detected)
   - **Build Command**: `npm run build` (auto-detected)
   - **Output Directory**: `dist` (auto-detected)
5. Add environment variable:
   - `VITE_API_URL` = your Render backend URL (e.g., `https://hum-backend.onrender.com`)
6. Click "Deploy"
7. Vercel will give you a URL like `https://hum-app.vercel.app`

### Step 3: Final Configuration

1. **Update Backend Environment Variable:**
   - Go back to Render dashboard
   - Update `FRONTEND_URL` to your Vercel URL (e.g., `https://hum-app.vercel.app`)

2. **Set Up Stripe Webhook:**
   - Go to Stripe Dashboard → Webhooks
   - Click "Add endpoint"
   - Endpoint URL: `https://hum-backend.onrender.com/api/payments/webhook`
   - Select events:
     - `checkout.session.completed`
     - `customer.subscription.deleted`
   - Copy the webhook signing secret (starts with `whsec_`)
   - Go back to Render and update `STRIPE_WEBHOOK_SECRET` with this value

3. **Test Your Deployment:**
   - Visit your Vercel URL
   - Try signing up
   - Test a search
   - Test payment flow (use Stripe test cards)

---

## Alternative: Render for Both (FREE but slower)

If you want everything on one platform:

**Backend:**
- Follow Step 1 above

**Frontend:**
1. In Render, click "New +" → "Static Site"
2. Connect same GitHub repo
3. Configure:
   - **Root Directory**: `frontend`
   - **Build Command**: `npm install && npm run build`
   - **Publish Directory**: `frontend/dist`
4. Add environment variable: `VITE_API_URL` = your backend Render URL
5. Deploy!

---

## Environment Variables Checklist

### Backend (Render):
- `PORT` (auto-set by Render)
- `ACR_HOST`
- `ACR_ACCESS_KEY`
- `ACR_ACCESS_SECRET`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `OPENAI_API_KEY`
- `JWT_SECRET` (generate: `openssl rand -base64 32`)
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET` (from Stripe dashboard)
- `FRONTEND_URL` (your Vercel/Render frontend URL)
- `FEEDBACK_EMAIL_USER`
- `FEEDBACK_EMAIL_PASSWORD`

### Frontend (Vercel):
- `VITE_API_URL` (your Render backend URL)

---

## Notes

- **Render Free Tier**: Spins down after 15 min of inactivity. First request after spin-down takes ~30-60 seconds to wake up.
- **Vercel Free Tier**: Unlimited deployments, instant, no spin-down
- **Stripe Webhooks**: Must use your production backend URL (not localhost)
- **Domain**: Both services allow custom domains on free tier
