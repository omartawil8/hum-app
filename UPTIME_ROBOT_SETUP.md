# Uptime Robot Setup (Temporary Fix)

## What Uptime Robot Does

Uptime Robot is a free monitoring service that pings your website every 5 minutes to keep it awake. This prevents Render's free tier from going to sleep.

## What It Fixes

✅ **Prevents service from sleeping** - Keeps your backend awake 24/7
✅ **Faster response times** - No 30-60 second cold start delay
✅ **Free** - Uptime Robot has a free tier (50 monitors)

## What It DOESN'T Fix

❌ **Filesystem persistence** - `users.json` still gets wiped on redeploys
❌ **User data loss** - Users will still disappear when you redeploy
❌ **Email issues** - Won't fix email sending problems

## Setup Instructions

1. **Sign up for Uptime Robot** (free):
   - Go to https://uptimerobot.com
   - Create a free account

2. **Add a Monitor**:
   - Click "Add New Monitor"
   - **Monitor Type**: HTTP(s)
   - **Friendly Name**: hüm Backend
   - **URL**: Your Render backend URL (e.g., `https://hum-backend.onrender.com/health`)
   - **Monitoring Interval**: 5 minutes (free tier minimum)
   - Click "Create Monitor"

3. **That's it!** Uptime Robot will ping your backend every 5 minutes, keeping it awake.

## Important Notes

- **This is a temporary solution** - You still need a database for persistent user storage
- **Redeploys will still wipe users** - Only prevents sleep, not filesystem resets
- **Free tier limit** - 50 monitors (you only need 1)

## Better Solution

For a permanent fix, you still need to:
1. Set up MongoDB Atlas (free) or another database
2. Update code to use database instead of `users.json`
3. Then users will persist even through redeploys

## Current Status

With Uptime Robot:
- ✅ Service stays awake (no cold starts)
- ❌ Users still lost on redeploy
- ❌ Filesystem still ephemeral

With Database:
- ✅ Service stays awake (if you also use Uptime Robot)
- ✅ Users persist through redeploys
- ✅ Permanent solution

