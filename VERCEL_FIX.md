# Fix: Searches Not Working on Vercel

## Problem
Your frontend is deployed but searches aren't working because it's trying to connect to `localhost:3001` instead of your Render backend.

## Solution: Add Environment Variable in Vercel

### Step 1: Get Your Render Backend URL
1. Go to your Render dashboard
2. Click on your backend service
3. Copy the URL (should be something like `https://hum-backend.onrender.com`)

### Step 2: Add Environment Variable in Vercel
1. Go to https://vercel.com
2. Click on your project (`hum-app-neon`)
3. Go to **Settings** → **Environment Variables**
4. Click **"Add New"**
5. Add:
   - **Key**: `VITE_API_URL`
   - **Value**: Your Render backend URL (e.g., `https://hum-backend.onrender.com`)
   - **Environment**: Select all (Production, Preview, Development)
6. Click **"Save"**

### Step 3: Redeploy
1. Go to **Deployments** tab
2. Click the **"..."** menu on the latest deployment
3. Click **"Redeploy"**
4. Wait for deployment to complete

### Step 4: Test
1. Visit https://hum-app-neon.vercel.app/
2. Try a search (humming or lyrics)
3. It should now work!

## Quick Checklist
- [ ] Got Render backend URL
- [ ] Added `VITE_API_URL` in Vercel
- [ ] Redeployed frontend
- [ ] Tested search functionality

## If Still Not Working
1. Check browser console (F12) for errors
2. Verify Render backend is running (visit the backend URL directly)
3. Check CORS settings in backend (should allow your Vercel domain)



