// backend/server.js
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

// ACRCloud identification function
async function identifyAudio(audioBuffer) {
  const timestamp = Math.floor(Date.now() / 1000);
  const stringToSign = `POST\n/v1/identify\n${process.env.ACR_ACCESS_KEY}\naudio\n1\n${timestamp}`;
  
  const signature = crypto
    .createHmac('sha1', process.env.ACR_ACCESS_SECRET)
    .update(Buffer.from(stringToSign, 'utf-8'))
    .digest()
    .toString('base64');

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

  const response = await axios.post(
    `https://${process.env.ACR_HOST}/v1/identify`,
    formData,
    {
      headers: formData.getHeaders(),
    }
  );

  return response.data;
}

// API endpoint
app.post('/api/identify', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    console.log('Received audio file:', req.file.size, 'bytes');
    
    const result = await identifyAudio(req.file.buffer);
    
    console.log('ACRCloud response:', JSON.stringify(result, null, 2));
    
    if (result.status.code === 0 && (result.metadata?.music?.length > 0 || result.metadata?.humming?.length > 0)) {
        const match = result.metadata.music?.[0] || result.metadata.humming?.[0];
      res.json({
        success: true,
        song: {
          title: match.title,
          artist: match.artists?.[0]?.name || 'Unknown Artist',
          album: match.album?.name || '',
          releaseDate: match.release_date || '',
          duration: match.duration_ms || 0,
          confidence: Math.round((match.score || 0) * 100),
          externalIds: {
            spotify: match.external_ids?.spotify || null,
            youtube: match.external_metadata?.youtube?.vid || null
          }
        }
      });
    } else {
      res.json({
        success: false,
        message: result.status.msg || 'No match found. Try humming more clearly or for longer.'
      });
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to identify audio',
      details: error.message 
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🎵 hüm backend running on port ${PORT}`);
});