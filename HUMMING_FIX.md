# Fix: Humming/Audio Search Not Working

## Changes Made

I've updated the backend to fix CORS and file size limits for audio uploads:

1. **Enhanced CORS configuration** - Now explicitly allows file uploads
2. **Increased file size limit** - Up to 50MB for audio files
3. **Multer configuration** - Added file size limit to multer

## What You Need to Do

### 1. Wait for Render to Redeploy
- Render should automatically redeploy when it detects the git push
- Check your Render dashboard to see if it's deploying
- If not, manually trigger a redeploy

### 2. Test Again
- After redeploy completes, try humming again
- Check browser console (F12) for any errors

### 3. If Still Not Working

**Check Browser Console:**
1. Open browser DevTools (F12)
2. Go to Console tab
3. Try humming
4. Look for any error messages

**Common Issues:**
- **CORS error**: Backend might not have redeployed yet
- **413 Payload Too Large**: File is too big (should be fixed now)
- **401 Unauthorized**: Auth token issue
- **Network error**: Backend might be spinning up (free tier)

**Check Render Logs:**
1. Go to Render dashboard
2. Click on your backend service
3. Go to "Logs" tab
4. Try humming and watch for errors

## Debugging Steps

1. **Verify backend is running:**
   - Visit your backend URL directly: `https://your-backend.onrender.com/health`
   - Should return: `{"status":"ok"}`

2. **Check CORS:**
   - Open browser console
   - Look for CORS errors
   - Should see successful requests if CORS is working

3. **Test with curl (optional):**
   ```bash
   curl -X POST https://your-backend.onrender.com/api/identify \
     -F "audio=@test.webm" \
     -H "Authorization: Bearer YOUR_TOKEN"
   ```

## Expected Behavior

After the fix:
- Audio files up to 50MB should work
- CORS should allow requests from Vercel
- Authorization headers should be accepted
- File uploads should process correctly



