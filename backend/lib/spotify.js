const axios = require('axios');
const { withRetry } = require('./http');
const { getDeezerPopularity, findMostPopularVersionDeezer } = require('./deezer');

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

      // Spotify omits popularity for Dev-Mode apps — backfill from Deezer.
      if (result.popularity == null) {
        result.popularity = await getDeezerPopularity(result.title, result.artist);
      }

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

      // Spotify omits popularity for Dev-Mode apps — backfill from Deezer.
      if (result.popularity == null) {
        result.popularity = await getDeezerPopularity(result.title, result.artist);
      }

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

// Find the most popular ("canonical") version of a song. Popularity comes from Deezer
// (Spotify no longer exposes it for Dev-Mode apps); Spotify is used only for link + art.
async function findMostPopularVersion(songTitle) {
  if (!global.__humSpotifyCanonicalCache) {
    global.__humSpotifyCanonicalCache = new Map();
  }

  const cacheKey = (songTitle || '').trim().toLowerCase();
  if (!cacheKey) return null;
  if (global.__humSpotifyCanonicalCache.has(cacheKey)) {
    return global.__humSpotifyCanonicalCache.get(cacheKey);
  }

  try {
    // Deezer picks the canonical version by its real `rank` (popularity) metric.
    const canonical = await findMostPopularVersionDeezer(songTitle);
    if (!canonical || !canonical.title) {
      global.__humSpotifyCanonicalCache.set(cacheKey, null);
      return null;
    }

    console.log(`   ✅ Most popular (Deezer): "${canonical.title}" by ${canonical.artist} (${canonical.popularity}/100)`);

    // Resolve the same recording on Spotify for the link + album art. (getSpotifyTrackByName
    // also backfills popularity from Deezer, so the numbers stay consistent.)
    const spotify = await getSpotifyTrackByName(canonical.title, canonical.artist);

    const result = {
      title: canonical.title,
      artist: canonical.artist,
      popularity: canonical.popularity,
      album: spotify?.album || '',
      spotify: spotify || {
        title: canonical.title,
        artist: canonical.artist,
        popularity: canonical.popularity,
      },
      isrc: undefined,
    };

    global.__humSpotifyCanonicalCache.set(cacheKey, result);
    return result;
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
