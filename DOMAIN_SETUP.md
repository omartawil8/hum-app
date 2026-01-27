# Domain Setup Guide for hum.rocks

## Step 1: Configure DNS in Spaceship

1. Go to your Spaceship dashboard
2. Navigate to your domain "hum.rocks"
3. Go to DNS settings

## Step 2: Point Domain to Your Hosting

### Option A: Use Custom Domain on Vercel (Recommended for Frontend)

1. **In Vercel Dashboard:**
   - Go to your project settings
   - Navigate to "Domains"
   - Add `hum.rocks` and `www.hum.rocks`
   - Vercel will give you DNS records to add

2. **In Spaceship DNS Settings:**
   - Add an A record pointing to Vercel's IP (Vercel will provide this)
   - OR add a CNAME record: `@` → `cname.vercel-dns.com`
   - Add CNAME for www: `www` → `cname.vercel-dns.com`

### Option B: Use Subdomain for Backend (Optional)

If you want a subdomain for your backend API:
- Add CNAME: `api` → `hum-app.onrender.com` (or your Render URL)
- Then your API would be at `api.hum.rocks`

## Step 3: Update Environment Variables

### In Vercel (Frontend):
- `VITE_API_URL` = `https://hum-app.onrender.com` (or your backend URL)
  - If using subdomain: `https://api.hum.rocks`

### In Render (Backend):
- `FRONTEND_URL` = `https://hum.rocks`
- `GOOGLE_REDIRECT_URI` = `https://hum-app.onrender.com/api/auth/google/callback`
  - (Keep backend callback on Render URL, or update if using subdomain)

## Step 4: Update Google OAuth (if using)

1. Go to Google Cloud Console
2. Update OAuth redirect URI to include:
   - `https://hum-app.onrender.com/api/auth/google/callback` (keep existing)
   - If using subdomain: `https://api.hum.rocks/api/auth/google/callback`

## Step 5: SSL/HTTPS

- Vercel automatically provides SSL for custom domains
- Render provides SSL automatically
- Spaceship may need SSL enabled (check their dashboard)

## Step 6: Wait for DNS Propagation

- DNS changes can take 24-48 hours to fully propagate
- You can check propagation status at: https://www.whatsmydns.net/

## Step 7: Test

Once DNS propagates:
1. Visit `https://hum.rocks` - should show your app
2. Test authentication flows
3. Test API calls
4. Verify Google OAuth still works

## Quick Checklist

- [ ] Added domain in Vercel
- [ ] Updated DNS records in Spaceship
- [ ] Updated `FRONTEND_URL` in Render backend
- [ ] Updated Google OAuth redirect URIs (if needed)
- [ ] Waited for DNS propagation
- [ ] Tested the site at hum.rocks
- [ ] Verified all features work

## Notes

- Keep your Render backend URL for API calls (or use subdomain)
- Frontend will be at `hum.rocks`
- Backend can stay on Render or use `api.hum.rocks` subdomain
- SSL certificates are usually automatic on Vercel and Render
