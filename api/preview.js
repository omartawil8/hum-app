// Serverless function: returns HTML with Open Graph meta for shared song links.
// Crawlers (iMessage, Slack, etc.) get this when they request /?track=SPOTIFY_ID
const BACKEND_URL = process.env.VITE_API_URL || process.env.BACKEND_URL || '';

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default async function handler(request) {
  const url = new URL(request.url);
  const trackId = url.searchParams.get('track');
  if (!trackId || !/^[a-zA-Z0-9]+$/.test(trackId)) {
    return new Response(
      '<!DOCTYPE html><html><head><title>hüm</title></head><body>Invalid link</body></html>',
      { status: 400, headers: { 'Content-Type': 'text/html' } }
    );
  }

  let title = 'hüm – Find Songs by Humming';
  let description = 'Listen to this song on hüm';
  let image = '';
  const pageUrl = url.searchParams.get('page_url') || url.origin + url.pathname + url.search;

  if (BACKEND_URL) {
    try {
      const r = await fetch(`${BACKEND_URL.replace(/\/$/, '')}/api/track/${encodeURIComponent(trackId)}`, {
        headers: { Accept: 'application/json' },
      });
      if (r.ok) {
        const data = await r.json();
        title = `${escapeHtml(data.title || title)} – ${escapeHtml(data.artist || '')}`.trim() || title;
        description = data.artist ? `by ${escapeHtml(data.artist)}` : description;
        if (data.album_art) image = data.album_art;
      }
    } catch (e) {
      console.error('Preview fetch error:', e.message);
    }
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${escapeHtml(pageUrl)}" />
  ${image ? `<meta property="og:image" content="${escapeHtml(image)}" />` : ''}
  <meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  ${image ? `<meta name="twitter:image" content="${escapeHtml(image)}" />` : ''}
  <meta http-equiv="refresh" content="0;url=${escapeHtml(pageUrl)}" />
</head>
<body><p>Redirecting to <a href="${escapeHtml(pageUrl)}">hüm</a>…</p></body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
