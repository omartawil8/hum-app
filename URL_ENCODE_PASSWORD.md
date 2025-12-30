# How to URL-Encode Your MongoDB Password

## The Problem

If your MongoDB password contains special characters (like `@`, `#`, `$`, `%`, `&`, `+`, `/`, `=`, `?`, `:`, or spaces), you need to URL-encode them in the connection string.

## Quick Fix

### Option 1: Use an Online Encoder
1. Go to https://www.urlencoder.org/
2. Paste your password
3. Copy the encoded version
4. Replace `<password>` in your connection string with the encoded version

### Option 2: Use JavaScript (in browser console)
```javascript
encodeURIComponent('YOUR_PASSWORD_HERE')
```

### Option 3: Use Python
```python
from urllib.parse import quote
print(quote('YOUR_PASSWORD_HERE'))
```

## Common Character Encodings

| Character | Encoded |
|-----------|---------|
| `@` | `%40` |
| `#` | `%23` |
| `$` | `%24` |
| `%` | `%25` |
| `&` | `%26` |
| `+` | `%2B` |
| `/` | `%2F` |
| `=` | `%3D` |
| `?` | `%3F` |
| `:` | `%3A` |
| Space | `%20` |

## Example

**Original password**: `MyP@ss#123`
**Encoded password**: `MyP%40ss%23123`

**Connection string before**:
```
mongodb+srv://username:MyP@ss#123@cluster0.xxxxx.mongodb.net/hum-app
```

**Connection string after**:
```
mongodb+srv://username:MyP%40ss%23123@cluster0.xxxxx.mongodb.net/hum-app
```

## After Encoding

1. Copy your encoded connection string
2. Go to Render Dashboard → Your backend service → Environment
3. Update `MONGODB_URI` with the encoded version
4. Save (Render will redeploy automatically)
5. Check logs for: `✅ Connected to MongoDB`

