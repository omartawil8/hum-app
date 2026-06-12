const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Send welcome email function
async function sendWelcomeEmail(email, remainingSearches) {
  try {
    if (!resend) {
      console.error('   ⚠️  EMAIL NOT CONFIGURED - Welcome email skipped');
      console.error('   📧 Missing: RESEND_API_KEY');
      console.error('   💡 Set this environment variable in your deployment platform (Render)');
      console.error('   📖 Get your API key from: https://resend.com/api-keys');
      return;
    }

    console.log(`   📧 Attempting to send welcome email to: ${email}`);
    console.log(`   📧 Using Resend email service`);

    const welcomeHtml = `
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
                <p>💡 tip: hum as clearly as you can. we're still improving, but so far we're doing pretty well!</p>
              </div>

              <p>if you run into any issues or have ideas, just hit reply. we actually read these emails.</p>

              <div class="cta">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}" class="button">start humming →</a>
              </div>
            </div>

            <div class="signature">
              <p class="name">omar</p>
              <p>founder, hüm</p>
            </div>
          </div>
        </body>
      </html>
    `;

    // Get the "from" email address - use RESEND_FROM_EMAIL if set, otherwise use a default
    // Resend free tier only allows sending to account owner's email unless domain is verified
    // For production, verify a domain and set RESEND_FROM_EMAIL to use that domain
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

    const { data, error } = await resend.emails.send({
      from: `omar from hüm <${fromEmail}>`,
      to: email,
      subject: 'hey, welcome to hüm 👋',
      html: welcomeHtml,
      text: `hey 👋\n\nthanks for signing up! you've got ${remainingSearches} free searches to start with.\n\nhum a tune, type some lyrics, or just sing whatever's stuck in your head - we'll figure it out.\n\nstart at ${process.env.FRONTEND_URL || 'http://localhost:5173'}\n\n- omar, founder`
    });

    if (error) {
      // Check if it's the domain verification error
      if (error.message.includes('You can only send testing emails to your own email address')) {
        throw new Error(`Resend domain not verified. To send emails to ${email}, you need to verify a domain in Resend. See: https://resend.com/domains`);
      }
      throw new Error(`Resend API error: ${error.message}`);
    }

    console.log(`   ✅ Welcome email successfully sent to ${email}`);
    console.log(`   📧 Email ID: ${data?.id || 'N/A'}`);
  } catch (emailError) {
    console.error(`   ❌❌❌ FAILED TO SEND WELCOME EMAIL ❌❌❌`);
    console.error(`   📧 Recipient: ${email}`);
    console.error(`   ❌ Error: ${emailError.message}`);

    if (emailError.message.includes('API key') || emailError.message.includes('Unauthorized')) {
      console.error(`   ⚠️  RESEND API KEY INVALID`);
      console.error(`   💡 Check that RESEND_API_KEY is set correctly in Render environment variables`);
      console.error(`   📖 Get your API key from: https://resend.com/api-keys`);
    } else if (emailError.message.includes('domain') || emailError.message.includes('not verified') || emailError.message.includes('You can only send testing emails')) {
      console.error(`   ⚠️  RESEND DOMAIN NOT VERIFIED`);
      console.error(`   📧 Resend free tier only allows sending to your account email (${process.env.RESEND_ACCOUNT_EMAIL || 'the email you signed up with'})`);
      console.error(`   💡 To send to other emails, verify a domain:`);
      console.error(`      1. Go to https://resend.com/domains`);
      console.error(`      2. Add and verify your domain (add DNS records)`);
      console.error(`      3. Set RESEND_FROM_EMAIL in Render to use your verified domain`);
      console.error(`      4. Example: RESEND_FROM_EMAIL=hello@yourdomain.com`);
    } else if (emailError.message.includes('rate limit') || emailError.message.includes('quota')) {
      console.error(`   ⚠️  RATE LIMIT EXCEEDED - Too many emails sent`);
      console.error(`   💡 Resend free tier: 3,000 emails/month`);
    }

    // Don't fail the signup if email fails
  }
}

module.exports = { resend, sendWelcomeEmail };
