# Environment Variables for Render Deployment

**⚠️ IMPORTANT: Copy the values from your `backend/.env` file. This file shows the variable names only.**

## Required Variables (Add All of These in Render)

### ACRCloud (Humming Identification)
```
ACR_HOST=[copy from backend/.env]
ACR_ACCESS_KEY=[copy from backend/.env]
ACR_ACCESS_SECRET=[copy from backend/.env]
```

### Spotify (Metadata Enrichment)
```
SPOTIFY_CLIENT_ID=[copy from backend/.env]
SPOTIFY_CLIENT_SECRET=[copy from backend/.env]
```

### OpenAI (Lyrics Search)
```
OPENAI_API_KEY=[copy from backend/.env]
```

### Authentication (JWT)
```
JWT_SECRET=[generate with: openssl rand -base64 32]
```
*Or use the generated one from your .env file*

### Stripe Payment
```
STRIPE_SECRET_KEY=[copy from backend/.env]
STRIPE_WEBHOOK_SECRET=[add after webhook setup in Stripe]
```
*Note: Update `STRIPE_WEBHOOK_SECRET` after setting up webhook in Stripe (Step 3 of deployment)*

### Email (Welcome Emails)
```
FEEDBACK_EMAIL_USER=[copy from backend/.env]
FEEDBACK_EMAIL_PASSWORD=[copy from backend/.env]
```

### Frontend URL
```
FRONTEND_URL=[update after deploying frontend on Vercel]
```
*Example: `https://hum-app.vercel.app`*

---

## How to Add in Render

1. Go to your Render service → **Environment** tab
2. Click **"Add Environment Variable"**
3. For each variable above:
   - **Key**: The variable name (e.g., `ACR_HOST`)
   - **Value**: Copy from your `backend/.env` file
   - Click **"Save Changes"**

## Quick Checklist

- [ ] ACR_HOST
- [ ] ACR_ACCESS_KEY
- [ ] ACR_ACCESS_SECRET
- [ ] SPOTIFY_CLIENT_ID
- [ ] SPOTIFY_CLIENT_SECRET
- [ ] OPENAI_API_KEY
- [ ] JWT_SECRET
- [ ] STRIPE_SECRET_KEY
- [ ] STRIPE_WEBHOOK_SECRET (update after webhook setup)
- [ ] FEEDBACK_EMAIL_USER
- [ ] FEEDBACK_EMAIL_PASSWORD
- [ ] FRONTEND_URL (update after frontend deployment)

## Important Notes

1. **PORT** - Render sets this automatically, don't add it
2. **STRIPE_WEBHOOK_SECRET** - Add after setting up webhook in Stripe dashboard
3. **FRONTEND_URL** - Update to your Vercel URL after deploying frontend
4. All values should be copied from your local `backend/.env` file
