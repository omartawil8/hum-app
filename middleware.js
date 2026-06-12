// Rewrite crawler requests for /?track=SPOTIFY_ID to /api/preview so link previews get og:image, og:title, etc.
import { rewrite, next } from '@vercel/functions';

const BOT_UA =
  /facebookexternalhit|Twitterbot|Slackbot|Discordbot|WhatsApp|TelegramBot|Applebot|LinkedInBot|Pinterest|SkypeUriPreview|iMessage|MetaInspector|bot|crawler|spider/i;

export const config = {
  matcher: '/',
};

export default function middleware(request) {
  const url = new URL(request.url);
  const track = url.searchParams.get('track');
  const ua = request.headers.get('user-agent') || '';
  if (track && BOT_UA.test(ua)) {
    const pageUrl = url.origin + url.pathname + url.search;
    return rewrite(new URL(`/api/preview?track=${encodeURIComponent(track)}&page_url=${encodeURIComponent(pageUrl)}`, request.url));
  }
  return next();
}
