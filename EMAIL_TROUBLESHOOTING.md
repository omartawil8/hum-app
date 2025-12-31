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

### 3. Connection Timeout
**Symptoms:** Log shows `❌ Connection timeout` or error code `ETIMEDOUT`

**Solution:**
This is the most common issue on hosting platforms like Render. Gmail SMTP connections are often blocked or timeout.

**Quick Fixes:**
1. **Check if your hosting provider blocks SMTP** - Many free hosting services block SMTP port 587
2. **Try port 465 with SSL** - Some providers allow SSL connections
3. **Use a transactional email service** (Recommended) - See "Alternative Email Services" below

**Why this happens:**
- Hosting providers (like Render) may block SMTP connections to prevent spam
- Gmail may block connections from certain IP ranges
- Network firewalls can block port 587

### 4. Connection Error
**Symptoms:** Log shows `⚠️ CONNECTION ERROR`

**Solution:**
- Check your server's network/firewall settings
- Verify Gmail SMTP is accessible from your server
- Check if your hosting provider blocks SMTP ports

### 5. Rate Limit Exceeded
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

**⚠️ RECOMMENDED:** If you're experiencing connection timeouts, switch to a transactional email service. These services are designed for server-to-server email and work much better than Gmail SMTP.

### Recommended Services:

1. **Resend** (Best for simplicity)
   - Free tier: 3,000 emails/month
   - Easy API setup
   - Great documentation
   - Sign up: https://resend.com

2. **SendGrid** (Most popular)
   - Free tier: 100 emails/day
   - Reliable and well-documented
   - Sign up: https://sendgrid.com

3. **Mailgun** (Good free tier)
   - Free tier: 5,000 emails/month for 3 months, then 1,000/month
   - Sign up: https://mailgun.com

4. **AWS SES** (Cheapest for scale)
   - Very cheap pay-as-you-go
   - Requires AWS account setup
   - Sign up: https://aws.amazon.com/ses

### Why Switch?

- ✅ **No connection timeouts** - These services use HTTP APIs, not SMTP
- ✅ **Better deliverability** - Emails are less likely to go to spam
- ✅ **Built for developers** - Designed for transactional emails
- ✅ **Better analytics** - Track opens, clicks, bounces
- ✅ **More reliable** - 99.9%+ uptime guarantees

### How to Switch

You'll need to:
1. Sign up for one of the services above
2. Get an API key
3. Install their SDK (e.g., `npm install resend`)
4. Update the `sendWelcomeEmail` function in `backend/server.js`

**Example with Resend:**
```javascript
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

await resend.emails.send({
  from: 'omar from hüm <onboarding@yourdomain.com>',
  to: email,
  subject: 'hey, welcome to hüm 👋',
  html: welcomeHtml,
});
```

