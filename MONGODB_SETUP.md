# MongoDB Atlas Setup Guide

## Step 1: Create MongoDB Atlas Account

1. Go to https://www.mongodb.com/cloud/atlas/register
2. Sign up for a free account
3. Verify your email

## Step 2: Create a Cluster

1. After logging in, click "Build a Database"
2. Choose **FREE** tier (M0 Sandbox)
3. Select a cloud provider and region (choose closest to your Render region)
4. Click "Create"
5. Wait 3-5 minutes for cluster to be created

## Step 3: Create Database User

1. Go to "Database Access" in left sidebar
2. Click "Add New Database User"
3. Choose "Password" authentication
4. Enter username and password (save these!)
5. Set privileges to "Atlas admin" or "Read and write to any database"
6. Click "Add User"

## Step 4: Whitelist IP Address

1. Go to "Network Access" in left sidebar
2. Click "Add IP Address"
3. Click "Allow Access from Anywhere" (for Render deployment)
   - Or add Render's IP ranges if you want to be more secure
4. Click "Confirm"

## Step 5: Get Connection String

1. Go back to "Database" (Clusters)
2. Click "Connect" on your cluster
3. Choose "Connect your application"
4. Copy the connection string (looks like: `mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`)
5. Replace `<username>` and `<password>` with your database user credentials
6. **IMPORTANT**: If your password contains special characters, you MUST URL-encode them:
   - `@` becomes `%40`
   - `#` becomes `%23`
   - `$` becomes `%24`
   - `%` becomes `%25`
   - `&` becomes `%26`
   - `+` becomes `%2B`
   - `/` becomes `%2F`
   - `=` becomes `%3D`
   - `?` becomes `%3F`
   - `:` becomes `%3A`
   - Space becomes `%20`
   
   Example: If your password is `P@ssw0rd#123`, it should be `P%40ssw0rd%23123` in the connection string
7. Add database name at the end: `...mongodb.net/hum-app?retryWrites=true&w=majority`

## Step 6: Add to Render

1. Go to Render Dashboard → Your backend service
2. Go to "Environment" tab
3. Add new environment variable:
   - **Key**: `MONGODB_URI`
   - **Value**: Your connection string from Step 5
4. Click "Save Changes"
5. Render will automatically redeploy

## Step 7: Verify Connection

1. Check Render logs after redeploy
2. Look for: `✅ Connected to MongoDB`
3. If you see connection errors, check:
   - Username/password are correct
   - IP is whitelisted
   - Connection string format is correct

## Troubleshooting

- **Connection timeout**: Check IP whitelist
- **Authentication failed**: Check username/password
- **Database not found**: Make sure database name is in connection string

## Free Tier Limits

- 512 MB storage
- Shared RAM/CPU
- Perfect for small apps like this!

