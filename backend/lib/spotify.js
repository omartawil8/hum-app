const axios = require('axios');
const { withRetry } = require('./http');

// =========================
// SPOTIFY INTEGRATION
// =========================
let spotifyToken = null;
let spotifyTokenExpiry = 0;

async function getSpotifyToken() {
  if (spotifyToken && Date.now() < spotifyTokenExpiry) {
    return spotifyToken;
  }

  try {
    const response = await withRetry(() => axios.post(
      'https://accounts.spotify.com/api/token',
      'grant_type=client_credentials',
      {
        headers: {
          'Authorization': 'Basic ' + Buffer.from(
            process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET
          ).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    ));

    spotifyToken = response.data.access_token;
    spotifyTokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000;

    return spotifyToken;
  } catch (error) {
    console.error('❌ Spotify token error:', error.message);
    return null;
  }
}

async function getSpotifyTrack(isrc) {
  // Per-process in-memory cache to avoid duplicate lookups across a single request burst
  if (!global.__humSpotifyIsrcCache) {
    global.__humSpotifyIsrcCache = new Map();
  }

  if (!isrc) return null;

  if (global.__humSpotifyIsrcCache.has(isrc)) {
    return global.__humSpotifyIsrcCache.get(isrc);
  }

  try {
    const token = await getSpotifyToken();
    if (!token) return null;

    const response = await withRetry(() => axios.get(
      `https://api.spotify.com/v1/search?q=isrc:${isrc}&type=track&limit=1`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    ));

    if (response.data.tracks.items.length > 0) {
      const track = response.data.tracks.items[0];
      const result = {
        id: track.id,
        title: track.name,
        artist: track.artists[0].name,
        artistId: track.artists[0].id,
        album: track.album.name,
        popularity: track.popularity,
        preview_url: track.preview_url,
        external_url: track.external_urls.spotify,
        album_art: track.album.images[0]?.url
      };

      global.__humSpotifyIsrcCache.set(isrc, result);
      return result;
    }

    return null;
  } catch (error) {
    console.error('❌ Spotify search error:', error.message);
    return null;
  }
}

async function getSpotifyTrackByName(title, artist) {
  if (!global.__humSpotifyNameCache) {
    global.__humSpotifyNameCache = new Map();
  }

  try {
    const token = await getSpotifyToken();
    if (!token) return null;

    const cleanTitle = (title || '').replace(/[()[\]]/g, '').trim();
    const cleanArtist = (artist || '').replace(/[()[\]]/g, '').trim();

    if (!cleanTitle || !cleanArtist) return null;

    const cacheKey = `${cleanTitle.toLowerCase()}|${cleanArtist.toLowerCase()}`;
    if (global.__humSpotifyNameCache.has(cacheKey)) {
      return global.__humSpotifyNameCache.get(cacheKey);
    }

    const query = `track:${cleanTitle} artist:${cleanArtist}`;

    const response = await withRetry(() => axios.get(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    ));

    if (response.data.tracks.items.length > 0) {
      const track = response.data.tracks.items[0];
      const result = {
        id: track.id,
        title: track.name,
        artist: track.artists[0].name,
        artistId: track.artists[0].id,
        album: track.album.name,
        popularity: track.popularity,
        preview_url: track.preview_url,
        external_url: track.external_urls.spotify,
        album_art: track.album.images[0]?.url
      };

      global.__humSpotifyNameCache.set(cacheKey, result);
      return result;
    }

    return null;
  } catch (error) {
    console.error('❌ Spotify search by name error:', error.message);
    return null;
  }
}

async function getSpotifyArtistInfo(artistId) {
  try {
    const token = await getSpotifyToken();
    if (!token) return null;

    const response = await withRetry(() => axios.get(
      `https://api.spotify.com/v1/artists/${artistId}`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    ));

    if (response.data) {
      return {
        genres: response.data.genres || [],
        // Spotify doesn't have explicit "origin country", but we can infer from genres
      };
    }

    return null;
  } catch (error) {
    console.error('❌ Spotify artist info error:', error.message);
    return null;
  }
}

// NEW: Find the most popular version of a song on Spotify (catches unlabeled covers!)
async function findMostPopularVersion(songTitle) {
  if (!global.__humSpotifyCanonicalCache) {
    global.__humSpotifyCanonicalCache = new Map();
  }

  try {
    const token = await getSpotifyToken();
    if (!token) return null;

    // Clean the title - remove everything in parentheses/brackets
    const cleanTitle = (songTitle || '')
      .replace(/\s*[\(\[].*?[\)\]]\s*/g, '')
      .replace(/\s*-\s*(remix|mix|edit|acoustic|live|remaster).*$/i, '')
      .trim();

    if (!cleanTitle) return null;

    const cacheKey = cleanTitle.toLowerCase();
    if (global.__humSpotifyCanonicalCache.has(cacheKey)) {
      return global.__humSpotifyCanonicalCache.get(cacheKey);
    }

    console.log(`\n🔍 Searching Spotify for most popular version of: "${cleanTitle}"`);

    const response = await withRetry(() => axios.get(
      // Dev-Mode apps cap the search limit (≥20 returns 400 "Invalid limit"), so use 10 —
      // still plenty to filter out variations and find the canonical top result.
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(cleanTitle)}&type=track&limit=10`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    ));

    if (response.data.tracks.items.length > 0) {
      const tracks = response.data.tracks.items;

      // Filter out variations
      const variationKeywords = [
        'remix', 'mix)', 'edit', 'acoustic', 'live', 'live at',
        'remaster', 'remastered', 'radio edit', 'extended', 'club',
        'instrumental', 'karaoke', 'cover', 'tribute', 'version',
        'sped up', 'slowed', 'reverb', 'nightcore'
      ];

      const originalTracks = tracks.filter(track => {
        const trackTitle = track.name.toLowerCase();
        const titleMatch = trackTitle.includes(cleanTitle.toLowerCase()) ||
                          cleanTitle.toLowerCase().includes(trackTitle.slice(0, Math.max(1, trackTitle.length - 5)));
        if (!titleMatch) return false;

        const isVariation = variationKeywords.some(keyword => trackTitle.includes(keyword));
        return !isVariation;
      });

      // Spotify omits `popularity` for apps in Development Mode. When it's missing we
      // fall back to Spotify's search ORDER (results come back ranked by relevance/
      // popularity), so the first hit is effectively the most popular — and we assign a
      // proxy popularity from the rank so the downstream "replace cover with canonical"
      // logic (which compares popularity numbers) still works. Backward compatible: if
      // real popularity is present we use it.
      const hasRealPopularity = typeof tracks[0]?.popularity === 'number';
      const popOf = (track) => {
        if (typeof track.popularity === 'number') return track.popularity;
        const rank = tracks.indexOf(track);
        return Math.max(55, 90 - rank * 4); // top result ≈ 90, decreasing with rank
      };

      if (originalTracks.length === 0) {
        console.log(`   ⚠️  No clear original found, using most popular overall`);
        const mostPopular = tracks[0];
        const pop = popOf(mostPopular);
        const fallback = {
          title: mostPopular.name,
          artist: mostPopular.artists[0].name,
          popularity: pop,
          album: mostPopular.album.name,
          spotify: {
            id: mostPopular.id,
            title: mostPopular.name,
            artist: mostPopular.artists[0].name,
            album: mostPopular.album.name,
            popularity: pop,
            preview_url: mostPopular.preview_url,
            external_url: mostPopular.external_urls.spotify,
            album_art: mostPopular.album.images[0]?.url
          },
          isrc: mostPopular.external_ids?.isrc
        };
        global.__humSpotifyCanonicalCache.set(cacheKey, fallback);
        return fallback;
      }

      // Only sort when real popularity exists; otherwise keep Spotify's search order.
      if (hasRealPopularity) {
        originalTracks.sort((a, b) => b.popularity - a.popularity);
      }
      const mostPopular = originalTracks[0];
      const pop = popOf(mostPopular);

      console.log(`   ✅ Most popular: "${mostPopular.name}" by ${mostPopular.artists[0].name} (${pop}/100${hasRealPopularity ? '' : ' approx'})`);

      const result = {
        title: mostPopular.name,
        artist: mostPopular.artists[0].name,
        popularity: pop,
        album: mostPopular.album.name,
        spotify: {
          id: mostPopular.id,
          title: mostPopular.name,
          artist: mostPopular.artists[0].name,
          album: mostPopular.album.name,
          popularity: pop,
          preview_url: mostPopular.preview_url,
          external_url: mostPopular.external_urls.spotify,
          album_art: mostPopular.album.images[0]?.url
        },
        isrc: mostPopular.external_ids?.isrc
      };

      global.__humSpotifyCanonicalCache.set(cacheKey, result);
      return result;
    }

    return null;
  } catch (error) {
    console.error('❌ Error finding most popular version:', error.message);
    return null;
  }
}

module.exports = {
  getSpotifyToken,
  getSpotifyTrack,
  getSpotifyTrackByName,
  getSpotifyArtistInfo,
  findMostPopularVersion,
};
