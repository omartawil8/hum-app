// Generates the iOS app icon (1024x1024, opaque) from the hummingbird asset.
// Run: node scripts/make-app-icon.cjs
// Requires sharp (install transiently: npm install --no-save sharp).
const sharp = require('sharp');
const path = require('path');

const SIZE = 1024;
const BIRD = 660; // hummingbird footprint within the canvas

const BIRD_SRC = path.join(__dirname, '..', 'src', 'assets', 'humming-bird.png');
const OUT = path.join(
  __dirname, '..', 'ios', 'App', 'App',
  'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-512@2x.png'
);

// On-brand background: deep purple → warm near-black, with a lavender glow behind
// the bird and a faint amber accent in the corner (echoes the app's gradients).
const background = Buffer.from(`
<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="base" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"  stop-color="#271c4d"/>
      <stop offset="48%" stop-color="#160f2b"/>
      <stop offset="100%" stop-color="#0c0a12"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="47%" r="48%">
      <stop offset="0%"  stop-color="#D8B5FE" stop-opacity="0.55"/>
      <stop offset="50%" stop-color="#9a6cff" stop-opacity="0.20"/>
      <stop offset="100%" stop-color="#D8B5FE" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="amber" cx="86%" cy="100%" r="42%">
      <stop offset="0%"  stop-color="#FFB082" stop-opacity="0.14"/>
      <stop offset="100%" stop-color="#FFB082" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" fill="url(#base)"/>
  <rect width="${SIZE}" height="${SIZE}" fill="url(#glow)"/>
  <rect width="${SIZE}" height="${SIZE}" fill="url(#amber)"/>
</svg>
`);

(async () => {
  const bird = await sharp(BIRD_SRC)
    .resize(BIRD, BIRD, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  const left = Math.round((SIZE - BIRD) / 2);
  const top = Math.round((SIZE - BIRD) / 2) - 10; // nudge up for optical centering

  await sharp(background)
    .composite([{ input: bird, left, top }])
    .flatten({ background: '#160f2b' }) // opaque — App Store rejects icons with alpha
    .removeAlpha()
    .png()
    .toFile(OUT);

  console.log('Wrote', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
