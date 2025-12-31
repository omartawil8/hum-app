# Welcome Email Template

This is the current welcome email template used when users sign up.

## HTML Version

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        line-height: 1.7;
        color: #1a1a1a;
        max-width: 560px;
        margin: 0 auto;
        padding: 40px 20px;
        background: #f5f5f5;
      }
      .container {
        background: white;
        border-radius: 12px;
        padding: 48px 40px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      }
      .header {
        margin-bottom: 32px;
      }
      h1 {
        color: #1a1a1a;
        margin: 0 0 8px 0;
        font-size: 28px;
        font-weight: 600;
        letter-spacing: -0.5px;
      }
      .subtitle {
        color: #666;
        font-size: 16px;
        margin: 0;
        font-weight: 400;
      }
      .content {
        margin: 32px 0;
      }
      p {
        color: #333;
        font-size: 16px;
        margin: 0 0 20px 0;
      }
      .highlight-box {
        background: #f8f9fa;
        border-left: 3px solid #667eea;
        padding: 20px;
        border-radius: 6px;
        margin: 28px 0;
      }
      .highlight-box p {
        margin: 0;
        color: #1a1a1a;
        font-size: 15px;
      }
      .cta {
        margin: 32px 0;
        text-align: center;
      }
      .button {
        display: inline-block;
        background: #1a1a1a;
        color: white;
        padding: 14px 28px;
        text-decoration: none;
        border-radius: 8px;
        font-weight: 500;
        font-size: 15px;
      }
      .button:hover {
        background: #333;
      }
      .signature {
        margin-top: 40px;
        padding-top: 32px;
        border-top: 1px solid #e5e5e5;
      }
      .signature p {
        margin: 8px 0;
        color: #666;
        font-size: 15px;
      }
      .signature .name {
        color: #1a1a1a;
        font-weight: 500;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>hey 👋</h1>
        <p class="subtitle">welcome to hüm</p>
      </div>
      
      <div class="content">
        <p>thanks for signing up! we're a small team building something we think is pretty cool.</p>
        
        <p>you've got <strong>${remainingSearches} free searches</strong> to start with. hum a tune, type some lyrics, or just sing whatever's stuck in your head - we'll figure it out.</p>
        
        <div class="highlight-box">
          <p>💡 tip: the clearer you hum, the better the results. but honestly, even our messy hums work pretty well.</p>
        </div>
        
        <p>if you run into any issues or have ideas, just hit reply. we actually read these emails.</p>
        
        <div class="cta">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}" class="button">start humming →</a>
        </div>
      </div>
      
      <div class="signature">
        <p class="name">omar</p>
        <p>co-founder, hüm</p>
      </div>
    </div>
  </body>
</html>
```

## Plain Text Version

```
hey 👋

thanks for signing up! you've got ${remainingSearches} free searches to start with.

hum a tune, type some lyrics, or just sing whatever's stuck in your head - we'll figure it out.

start at http://localhost:5173

- omar, co-founder
```

## Email Settings

- **From**: `"omar from hüm" <${process.env.FEEDBACK_EMAIL_USER}>`
- **Subject**: `hey, welcome to hüm 👋`
- **To**: User's email address

## Variables Used

- `${remainingSearches}` - Number of free searches the user has (5 minus any anonymous searches used)
- `${process.env.FRONTEND_URL}` - Your frontend URL (defaults to localhost:5173)

## Location in Code

The email template is in `backend/server.js` in the `sendWelcomeEmail()` function (around line 186-306).

## To Modify

Edit the `welcomeHtml` template string in `backend/server.js` starting at line 186. Make sure to:
1. Keep the `${remainingSearches}` variable if you want dynamic search count
2. Keep the `${process.env.FRONTEND_URL}` variable for the button link
3. Test the HTML in an email client before deploying

