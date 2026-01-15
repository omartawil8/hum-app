# Resend Email Setup Guide

## Quick Setup (5 minutes)

### Step 1: Sign up for Resend
1. Go to https://resend.com
2. Click **"Sign Up"** (free account)
3. Verify your email address

### Step 2: Get Your API Key
1. Once logged in, go to https://resend.com/api-keys
2. Click **"Create API Key"**
3. Give it a name (e.g., "hüm app")
4. Copy the API key (starts with `re_...`)
   - ⚠️ **Important:** Copy it immediately - you won't see it again!

### Step 3: Add to Render Environment Variables
1. Go to your Render dashboard
2. Click on your backend service
3. Go to **Environment** tab
4. Click **"Add Environment Variable"**
5. Add:
   - **Key:** `RESEND_API_KEY`
   - **Value:** Paste your API key (the `re_...` string)
6. Click **"Save Changes"**

### Step 4: (Optional) Set Custom From Email
For production, you'll want to verify your domain and use your own email address:

1. In Resend dashboard, go to **Domains**
2. Add and verify your domain (follow their instructions)
3. Once verified, add to Render:
   - **Key:** `RESEND_FROM_EMAIL`
   - **Value:** `hello@yourdomain.com` (or whatever email you want)

**For testing:** You can skip this step. The app will use `onboarding@resend.dev` by default.

### Step 5: Deploy
Render will automatically redeploy when you save the environment variable. Or trigger a manual deploy.

## Testing

1. Create a test account on your app
2. Check the Render logs - you should see:
   ```
   ✅ Welcome email successfully sent to [email]
   ```
3. Check the user's inbox (and spam folder)

## Troubleshooting

### "API key invalid" error
- Double-check you copied the full API key (starts with `re_`)
- Make sure there are no extra spaces
- Verify it's set in Render environment variables

### "Domain not verified" error
- For testing: Make sure `RESEND_FROM_EMAIL` is not set, or set it to `onboarding@resend.dev`
- For production: Verify your domain in Resend dashboard first

### Emails going to spam
- Verify your domain in Resend (recommended for production)
- Use a custom `RESEND_FROM_EMAIL` with your verified domain

## Free Tier Limits

- **3,000 emails/month** (free tier)
- Perfect for getting started!
- Upgrade if you need more

## Next Steps

Once you're sending emails successfully:
1. Verify your domain in Resend (for better deliverability)
2. Set `RESEND_FROM_EMAIL` to use your own domain
3. Monitor your email usage in Resend dashboard





