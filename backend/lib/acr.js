const axios = require('axios');
const crypto = require('crypto');
const FormData = require('form-data');
const { withRetry } = require('./http');

// =========================
// ACRCLOUD IDENTIFICATION
// =========================
async function identifyAudio(audioBuffer) {
  // Check if ACR Cloud credentials are configured
  if (!process.env.ACR_ACCESS_KEY || !process.env.ACR_ACCESS_SECRET || !process.env.ACR_HOST) {
    console.error('❌ ACR Cloud credentials not configured!');
    throw new Error('ACR Cloud API credentials are missing. Please check environment variables.');
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const stringToSign = `POST\n/v1/identify\n${process.env.ACR_ACCESS_KEY}\naudio\n1\n${timestamp}`;

  const signature = crypto
    .createHmac('sha1', process.env.ACR_ACCESS_SECRET)
    .update(Buffer.from(stringToSign, 'utf-8'))
    .digest()
    .toString('base64');

  console.log('   📡 Calling ACR Cloud API...');
  console.log('   🔑 Access Key:', process.env.ACR_ACCESS_KEY ? 'Set' : 'MISSING');
  console.log('   🔑 Access Secret:', process.env.ACR_ACCESS_SECRET ? 'Set' : 'MISSING');
  console.log('   🌐 Host:', process.env.ACR_HOST || 'MISSING');

  try {
    const response = await withRetry(() => {
      const formData = new FormData();
      formData.append('sample', audioBuffer, {
        filename: 'audio.webm',
        contentType: 'audio/webm'
      });
      formData.append('access_key', process.env.ACR_ACCESS_KEY);
      formData.append('sample_bytes', audioBuffer.length);
      formData.append('timestamp', timestamp);
      formData.append('signature', signature);
      formData.append('data_type', 'audio');
      formData.append('signature_version', '1');

      return axios.post(
        `https://${process.env.ACR_HOST}/v1/identify`,
        formData,
        {
          headers: formData.getHeaders(),
          timeout: 30000 // 30 second timeout
        }
      );
    });

    console.log('   ✅ ACR Cloud API responded');
    return response.data;
  } catch (error) {
    console.error('   ❌ ACR Cloud API error:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', error.response.data);
    }
    throw error;
  }
}

module.exports = { identifyAudio };
