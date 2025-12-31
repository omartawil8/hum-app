# Email Troubleshooting Guide

## Common Issues and Solutions

### 1. Email Not Configured
**Symptoms:** Log shows `⚠️ EMAIL NOT CONFIGURED - Welcome email skipped`

**Solution:**
- Check that `FEEDBACK_EMAIL_USER` and `FEEDBACK_EMAIL_PASSWORD` are set in your deployment platform (Render/Vercel)
- Go to your Render service → Environment tab → Verify both variables exist

### 2. Gmail Authentication Failed
**Symptoms:** Log shows `❌ GMAIL AUTHENTICATION FAILED` or error code `EAUTH`

**Solution:**
Gmail requires an **App Password**, not your regular Gmail password.

**Steps to create a Gmail App Password:**
1. Go to [Google Account](https://myaccount.google.com/)
2. Click **Security** (left sidebar)
3. Enable **2-Step Verification** (if not already enabled)
4. Under "Signing in to Google", click **App Passwords**
5. Select app: **Mail**
6. Select device: **Other (Custom name)** → Enter "hüm App"
7. Click **Generate**
8. Copy the 16-character password (it will look like: `abcd efgh ijkl mnop`)
9. Use this as your `FEEDBACK_EMAIL_PASSWORD` (remove spaces or keep them, both work)

**Important:** 
- The `FEEDBACK_EMAIL_USER` should be your full Gmail address (e.g., `yourname@gmail.com`)
- The `FEEDBACK_EMAIL_PASSWORD` should be the 16-character App Password

### 3. Connection Error
**Symptoms:** Log shows `⚠️ CONNECTION ERROR`

**Solution:**
- Check your server's network/firewall settings
- Verify Gmail SMTP is accessible from your server
- Check if your hosting provider blocks SMTP ports

### 4. Rate Limit Exceeded
**Symptoms:** Log shows `⚠️ RATE LIMIT EXCEEDED`

**Solution:**
- Gmail has daily sending limits (500 emails/day for free accounts)
- Wait 24 hours or upgrade to a paid Gmail/Google Workspace account

## How to Check Logs

### On Render:
1. Go to your Render dashboard
2. Click on your backend service
3. Click **Logs** tab
4. Look for messages starting with `📧` or `❌`

### What to Look For:
- `✅ Welcome email successfully sent` - Email worked!
- `⚠️ EMAIL NOT CONFIGURED` - Missing environment variables
- `❌ GMAIL AUTHENTICATION FAILED` - Need App Password
- `❌ Email server verification failed` - Connection/auth issue

## Testing Email Configuration

You can test if email is working by:
1. Creating a test account (signup)
2. Checking the Render logs immediately after signup
3. Looking for the email in the user's inbox (and spam folder)

## Alternative: Use a Different Email Service

If Gmail continues to cause issues, consider:
- **SendGrid** (free tier: 100 emails/day)
- **Mailgun** (free tier: 5,000 emails/month)
- **AWS SES** (very cheap, pay-as-you-go)

To switch, you'll need to modify the `sendWelcomeEmail` function in `backend/server.js` to use a different service's SMTP settings.

