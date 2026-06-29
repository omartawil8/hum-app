const axios = require('axios');
const { withRetry } = require('./http');

// =========================
// DEEZER POPULARITY SOURCE
// =========================
// Spotify stopped exposing the `popularity` field for Development-Mode apps, so we use
// Deezer (free, no auth) as the popularity signal. Deezer's `rank` (~0..1,000,000+) is a
// real popularity metric; we normalize it onto Spotify's familiar 0..100 scale so it drops
// straight into the existing ranking logic. Spotify is still used for links/album art.

const DEEZER_SEARCH = 'https://api.deezer.com/search';

const VARIATION_KEYWORDS = [
  'remix', 'mix)', 'edit', 'acoustic', 'live', 'live at', 'remaster',
  'remastered', 'radio edit', 'extended', 'club', 'instrumental',
  'karaoke', 'cover', 'tribute', 'version', 'sped up', 'slowed',
  'reverb', 'nightcore', 'hardstyle', 'bootleg', 'flip', 'vip',
  'mashup', 'hyperpop', 'lofi', 'lo-fi', '8d', 'speed up', 'slowed down'
];

// Variant descriptors used to reduce a title to its "core" so a remix/hardstyle/nightcore/
// slowed match resolves to the real original (e.g., "Sweet But Psycho Hardstyle" -> "Sweet
// But Psycho"). Keep in sync with VARIATION_KEYWORDS above.
const VARIANT_ALT = 'remix|mix|edit|acoustic|unplugged|live|remaster(?:ed)?|radio edit|extended|club|instrumental|karaoke|cover|tribute|version|sped\\s*up|slowed(?:\\s*down)?|reverb|nightcore|hardstyle|bootleg|flip|vip|mashup|hyperpop|lo-?fi|8d';
const TRAILING_VARIANT_RE = new RegExp(`[\\s,]+(?:${VARIANT_ALT})\\s*$`, 'i');
const DASH_VARIANT_RE = new RegExp(`\\s*[-–—]\\s*.*\\b(?:${VARIANT_ALT})\\b.*$`, 'i');

function coreTitle(title) {
  let t = (title || '').replace(/\s*[\(\[].*?[\)\]]\s*/g, ' ').trim(); // drop (...) and [...]
  t = t.replace(DASH_VARIANT_RE, '');                                  // drop "- Slowed & Reverb"
  let prev;                                                            // strip trailing "Hardstyle" etc.
  do { prev = t; t = t.replace(TRAILING_VARIANT_RE, '').trim(); } while (t !== prev && t);
  return t.trim() || (title || '').trim();
}

function normalizeRank(rank) {
  if (typeof rank !== 'number' || rank <= 0) return 0;
  return Math.min(100, Math.round(rank / 10000)); // ~hit (880k) -> 88
}

// Popularity (0..100) for a specific title+artist.
async function getDeezerPopularity(title, artist) {
  if (!global.__humDeezerPopCache) global.__humDeezerPopCache = new Map();
  const t = (title || '').trim();
  const a = (artist || '').trim();
  if (!t) return 0;

  const cacheKey = `${t.toLowerCase()}|${a.toLowerCase()}`;
  if (global.__humDeezerPopCache.has(cacheKey)) return global.__humDeezerPopCache.get(cacheKey);

  let pop = 0;
  try {
    const strictQuery = a ? `track:"${t}" artist:"${a}"` : t;
    let resp = await withRetry(() => axios.get(DEEZER_SEARCH, { params: { q: strictQuery, limit: 1 } }));
    let item = resp.data?.data?.[0];

    // Looser fallback if the strict field query found nothing.
    if (!item && a) {
      resp = await withRetry(() => axios.get(DEEZER_SEARCH, { params: { q: `${t} ${a}`, limit: 1 } }));
      item = resp.data?.data?.[0];
    }

    pop = item ? normalizeRank(item.rank) : 0;
  } catch (e) {
    console.error('❌ Deezer popularity error:', e.message);
  }

  global.__humDeezerPopCache.set(cacheKey, pop);
  return pop;
}

// The most popular (canonical) version of a title, chosen by Deezer rank.
async function findMostPopularVersionDeezer(title) {
  if (!global.__humDeezerCanonCache) global.__humDeezerCanonCache = new Map();

  // Reduce to the core title so a remix/hardstyle/etc. resolves to the real original.
  const clean = coreTitle(title);
  if (!clean) return null;

  const cacheKey = clean.toLowerCase();
  if (global.__humDeezerCanonCache.has(cacheKey)) return global.__humDeezerCanonCache.get(cacheKey);

  let result = null;
  try {
    const resp = await withRetry(() => axios.get(DEEZER_SEARCH, { params: { q: clean, limit: 15 } }));
    const items = resp.data?.data || [];
    if (items.length) {
      const cleanLower = clean.toLowerCase();
      const originals = items.filter((it) => {
        const tl = (it.title || '').toLowerCase();
        const titleMatch = tl.includes(cleanLower) || cleanLower.includes(tl);
        if (!titleMatch) return false;
        return !VARIATION_KEYWORDS.some((k) => tl.includes(k));
      });
      const pool = originals.length ? originals : items;
      pool.sort((a, b) => (b.rank || 0) - (a.rank || 0)); // highest rank = most popular
      const top = pool[0];
      result = {
        title: top.title,
        artist: top.artist?.name || '',
        popularity: normalizeRank(top.rank),
        deezerRank: top.rank || 0,
      };
    }
  } catch (e) {
    console.error('❌ Deezer canonical lookup error:', e.message);
  }

  global.__humDeezerCanonCache.set(cacheKey, result);
  return result;
}

module.exports = { getDeezerPopularity, findMostPopularVersionDeezer, normalizeRank, coreTitle };
