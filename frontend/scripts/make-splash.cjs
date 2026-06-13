// Generates the iOS launch/splash image (2732x2732) from the hummingbird asset.
// The storyboard shows this aspect-fill, so a tall phone crops the square to its
// center ~1260px width — the bird is sized to stay fully visible within that.
// Run: node scripts/make-splash.cjs   (needs: npm install --no-save sharp)
const sharp = require('sharp');
const path = require('path');

const SIZE = 2732;
const BIRD = 760; // stays within the center-crop safe area on tall phones

const BIRD_SRC = path.join(__dirname, '..', 'src', 'assets', 'humming-bird.png');
const IMAGESET = path.join(
  __dirname, '..', 'ios', 'App', 'App', 'Assets.xcassets', 'Splash.imageset'
);
// Capacitor uses the same large image for the 1x/2x/3x slots.
const OUT_FILES = [
  'splash-2732x2732.png',
  'splash-2732x2732-1.png',
  'splash-2732x2732-2.png',
].map((f) => path.join(IMAGESET, f));

// Same palette as the app icon: deep purple → near-black, centered lavender glow.
// Radial glow is centered so the center-crop stays symmetric.
const background = Buffer.from(`
<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="base" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"  stop-color="#211840"/>
      <stop offset="50%" stop-color="#140e26"/>
      <stop offset="100%" stop-color="#0c0a12"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="34%">
      <stop offset="0%"  stop-color="#D8B5FE" stop-opacity="0.45"/>
      <stop offset="55%" stop-color="#9a6cff" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#D8B5FE" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" fill="url(#base)"/>
  <rect width="${SIZE}" height="${SIZE}" fill="url(#glow)"/>
</svg>
`);

(async () => {
  const bird = await sharp(BIRD_SRC)
    .resize(BIRD, BIRD, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  const left = Math.round((SIZE - BIRD) / 2);
  const top = Math.round((SIZE - BIRD) / 2);

  const buf = await sharp(background)
    .composite([{ input: bird, left, top }])
    .flatten({ background: '#140e26' })
    .removeAlpha()
    .png()
    .toBuffer();

  for (const out of OUT_FILES) await sharp(buf).toFile(out);
  console.log('Wrote splash to', OUT_FILES.length, 'files in', IMAGESET);
})().catch((e) => { console.error(e); process.exit(1); });
