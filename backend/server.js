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

app.use(cors({
    origin: '*'  // Allow all origins for now (we'll restrict this later)
  }));
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
        const matches = result.metadata.music || result.metadata.humming;
        
        // Priority scoring function
        const getPriority = (match) => {
          const title = match.title || '';
          const artist = match.artists?.[0]?.name || '';
          const label = match.label || '';
          const combined = title + artist + label;
          
          // Check for different language scripts
          const hasAsianChars = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf\uac00-\ud7a3]/.test(combined);
          const hasArabicChars = /[\u0600-\u06ff]/.test(combined);
          const hasSpanishIndicators = /spanish|español|latina|latino|reggaeton/i.test(label + combined);
          const hasFrenchIndicators = /french|français|francais/i.test(label + combined);
          const isAsianLabel = /japan|korea|jpop|kpop|mandarin|cantonese/i.test(label);
          
          // Priority: English/Western (3) > Spanish/French/Arabic (2) > Asian (0)
          if (hasAsianChars || isAsianLabel) return 0;
          if (hasArabicChars || hasSpanishIndicators || hasFrenchIndicators) return 2;
          return 3; // English/Western default
        };
        
        // Sort by priority first, then by confidence score
        const sortedMatches = matches
          .map(match => ({
            ...match,
            priority: getPriority(match)
          }))
          .sort((a, b) => {
            if (b.priority !== a.priority) return b.priority - a.priority;
            return (b.score || 0) - (a.score || 0);
          });
        
        // Return top 3 matches
        const topMatches = sortedMatches.slice(0, 3).map(match => ({
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
        }));
        
        res.json({
          success: true,
          songs: topMatches,  // Return array of songs
          primaryMatch: topMatches[0]  // Keep backward compatibility
        });
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