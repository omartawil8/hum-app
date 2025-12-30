# User Storage Issue - Fix Required

## Problem

The app is currently storing users in `users.json` on the filesystem. **On Render's free tier, the filesystem is ephemeral** - it gets wiped every time:
- The service restarts
- The service redeploys
- The service goes to sleep and wakes up

This causes:
- Users to be logged out
- Accounts to "not exist" (they were deleted)
- Users having to recreate accounts with the same credentials
- All user data being lost

## Current Symptoms

- Users keep getting signed out
- Login says "account doesn't exist" 
- Users have to recreate accounts
- Welcome emails may not be sending (separate issue)

## Solution: Use a Database

You need to switch from file-based storage to a persistent database. Here are free options:

### Option 1: MongoDB Atlas (Recommended - Easiest)
1. Sign up at https://www.mongodb.com/cloud/atlas (free tier available)
2. Create a cluster
3. Get connection string
4. Add `MONGODB_URI` to Render environment variables
5. Update `server.js` to use MongoDB instead of `users.json`

### Option 2: Render PostgreSQL (Free Tier)
1. In Render dashboard, create a PostgreSQL database
2. Get connection string
3. Add `DATABASE_URL` to environment variables
4. Update `server.js` to use PostgreSQL

### Option 3: Supabase (Free Tier)
1. Sign up at https://supabase.com
2. Create a project
3. Get connection string
4. Update `server.js` to use Supabase

## Quick Fix (Temporary)

For now, the logging I added will help you see when `users.json` is being reset. Check Render logs to see:
- `📝 Creating new users.json file` - means the file was wiped
- `📊 Loaded users.json: X users` - shows how many users exist
- `⚠️ Login attempt for non-existent user` - user was deleted

## Email Issue

Welcome emails may not be sending because:
1. `FEEDBACK_EMAIL_USER` or `FEEDBACK_EMAIL_PASSWORD` not set in Render
2. Gmail app password expired or incorrect
3. Email service blocking the connection

Check Render logs for:
- `❌ Failed to send welcome email` - email failed
- `⚠️ Email authentication failed` - credentials wrong

## Next Steps

1. **Immediate**: Check Render logs to confirm `users.json` is being reset
2. **Short-term**: Set up MongoDB Atlas (easiest) or another database
3. **Update code**: Replace file-based storage with database
4. **Test**: Verify users persist across restarts

Would you like me to help you set up MongoDB Atlas or another database solution?

