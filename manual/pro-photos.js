// The photos of the Pro sheet (feature/ratings): parts of the photos of the user manual
// (docs/manual/<lang>/img/*.jpg, made by shots.js), cut and saved as app/assets/pro/<lang>/<name>.webp for the
// sheet that opens when a locked feature is tapped (PRO_PHOTO in app.js). Only Node.js and Playwright (as
// shots.js); Chromium cuts the photo on a canvas and writes WebP. Run it again after shots.js has made new
// photos, and look at the parts: where a language's text is longer, its screen is lower, so a part can begin
// lower in that language (the third and the fourth number below).
// Usage: node manual/pro-photos.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const LANGS = ['ja', 'en', 'de', 'es', 'fr', 'ko', 'zh-TW'];
const QUALITY = 0.75;
// name: [photo of the manual, top in px (the photos are 540 × 1080), height, { language: another top }]
const PARTS = {
  graph3d: ['graph3d', 690, 350],                                  // 3D graphs, GIF: the sphere
  tank: ['shapes3d', 440, 330],                                    // tank heads: a horizontal tank with heads in 3D
  profile: ['profile', 290, 255],                                  // solid from a profile: volume and weight
  stl: ['profile', 540, 280, { es: 565, fr: 565, 'zh-TW': 555 }],  // STL: "Save as STL" under the results
  notes: ['notes', 210, 310, { de: 250, es: 250, fr: 250 }],       // calculation notes: "+ New memo" and the lines
  history: ['history', 620, 290]                                   // exporting the history: the menu of 🕘
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let total = 0;
  for (const lang of LANGS) {
    const dir = path.join(ROOT, 'app', 'assets', 'pro', lang);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, [photo, top, height, other]] of Object.entries(PARTS)) {
      const y = (other && other[lang]) || top;
      const src = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(ROOT, 'docs', 'manual', lang, 'img', photo + '.jpg')).toString('base64');
      const url = await page.evaluate(async ([src, y, h, q]) => {
        const im = new Image();
        im.src = src;
        await im.decode();
        const c = document.createElement('canvas');
        c.width = im.naturalWidth;
        c.height = h;
        c.getContext('2d').drawImage(im, 0, -y);
        return c.toDataURL('image/webp', q);
      }, [src, y, height, QUALITY]);
      if (!url.startsWith('data:image/webp;base64,')) throw new Error('no WebP for ' + lang + '/' + name);
      const data = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
      fs.writeFileSync(path.join(dir, name + '.webp'), data);
      total += data.length;
    }
  }
  await browser.close();
  console.log('app/assets/pro: ' + LANGS.length * Object.keys(PARTS).length + ' photos, ' + total + ' bytes');
})();
