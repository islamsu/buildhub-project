/**
 * Derive the RAKIZA token ramps from the approved hex anchors, and prove the
 * contrast pairs the design depends on.
 *
 * The brand sheet gives six hexes and no ramps. Hand-picking nine more steps
 * per family by eye is how a palette ends up with a 700 that is bluer than its
 * 600. So the ramps are GENERATED here from the anchor's own hue and chroma,
 * the anchor keeps its exact value at its step, and every step is printed with
 * its hex so a reviewer can see what the numbers mean.
 *
 * Run: node scripts/brand/palette.mjs
 */

const lin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const unlin = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function oklchToRgb(L, C, Hdeg) {
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  return [r, g, bb].map(v => Math.max(0, Math.min(255, Math.round(unlin(v) * 255))));
}

export function rgbToOklch([R, G, B]) {
  const r = lin(R / 255), g = lin(G / 255), b = lin(B / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  let H = (Math.atan2(Bb, A) * 180) / Math.PI;
  if (H < 0) H += 360;
  return [L, Math.hypot(A, Bb), H];
}

export const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
export const rgbToHex = ([r, g, b]) =>
  '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0').toUpperCase()).join('');

const relLum = ([R, G, B]) => 0.2126 * lin(R / 255) + 0.7152 * lin(G / 255) + 0.0722 * lin(B / 255);
export function contrast(a, b) {
  const la = relLum(typeof a === 'string' ? hexToRgb(a) : a);
  const lb = relLum(typeof b === 'string' ? hexToRgb(b) : b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const ANCHORS = {
  navy:   '#0F2D5B',
  blue:   '#1B6BFF',
  amber:  '#F59E0B',
  light:  '#F8FAFC',
  gray:   '#94A3B8',
  text:   '#111827',
};

/**
 * Lightness and chroma curves for the eleven-step navy family.
 *
 * Step 800 is the anchor and holds #0F2D5B exactly. Everything else is a
 * smooth walk out from it, at the anchor's own hue. Chroma peaks mid-ramp and
 * falls at both ends, which is what keeps a 50 from looking like dirty water
 * and a 950 from looking purple.
 */
const BRAND_STEPS = [
  [50,  0.980, 0.006],
  [100, 0.950, 0.018],
  [200, 0.890, 0.038],
  [300, 0.805, 0.064],
  [400, 0.695, 0.088],
  [500, 0.575, 0.106],
  [600, 0.455, 0.108],
  [700, 0.375, 0.100],
  [800, null,  null],   // the anchor
  [900, 0.232, 0.070],
  [950, 0.165, 0.048],
];

export function brandRamp() {
  const [L, C, H] = rgbToOklch(hexToRgb(ANCHORS.navy));
  return BRAND_STEPS.map(([step, l, c]) =>
    step === 800 ? [step, L, C, H] : [step, l, c, H]);
}

/** Amber and Secondary Blue get three steps each, not eleven. See index.css. */
export function shortRamp(hex, lighter, darker) {
  const [L, C, H] = rgbToOklch(hexToRgb(hex));
  return [
    [400, L + lighter[0], C * lighter[1], H],
    [500, L, C, H],
    [600, L - darker[0], C * darker[1], H],
  ];
}

const fmt = (L, C, H) => `oklch(${(L * 100).toFixed(1)}% ${C.toFixed(3)} ${H.toFixed(0)})`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const show = (name, ramp) => {
    console.log(`\n${name}`);
    for (const [step, L, C, H] of ramp) {
      const hex = rgbToHex(oklchToRgb(L, C, H));
      const onWhite = contrast(hex, '#FFFFFF').toFixed(2);
      const onText = contrast(hex, ANCHORS.text).toFixed(2);
      console.log(`  ${String(step).padEnd(4)} ${fmt(L, C, H).padEnd(26)} ${hex}  vs white ${onWhite.padStart(5)}  vs #111827 ${onText.padStart(5)}`);
    }
  };
  show('brand (navy, anchor at 800 = ' + ANCHORS.navy + ')', brandRamp());
  show('brand-accent (amber, anchor at 500 = ' + ANCHORS.amber + ')',
       shortRamp(ANCHORS.amber, [0.07, 0.78], [0.10, 1.03]));
  show('brand-blue (secondary, anchor at 500 = ' + ANCHORS.blue + ')',
       shortRamp(ANCHORS.blue, [0.10, 0.80], [0.09, 0.98]));

  console.log('\nneutral anchors');
  for (const [k, hex] of Object.entries({ light: ANCHORS.light, gray: ANCHORS.gray, text: ANCHORS.text })) {
    const [L, C, H] = rgbToOklch(hexToRgb(hex));
    console.log(`  ${k.padEnd(6)} ${hex}  ${fmt(L, C, H)}`);
  }

  console.log('\nthe pairs the design depends on');
  const pairs = [
    ['white text on amber-500', '#FFFFFF', ANCHORS.amber],
    ['Text Dark on amber-500', ANCHORS.text, ANCHORS.amber],
    ['Text Dark on amber-400', ANCHORS.text, rgbToHex(oklchToRgb(...shortRamp(ANCHORS.amber, [0.07, 0.78], [0.10, 1.03])[0].slice(1)))],
    ['Text Dark on amber-600', ANCHORS.text, rgbToHex(oklchToRgb(...shortRamp(ANCHORS.amber, [0.07, 0.78], [0.10, 1.03])[2].slice(1)))],
    ['white on navy anchor', '#FFFFFF', ANCHORS.navy],
    ['navy on Light Background', ANCHORS.navy, ANCHORS.light],
    ['Text Dark on Light Background', ANCHORS.text, ANCHORS.light],
    ['Neutral Gray on white', ANCHORS.gray, '#FFFFFF'],
    ['Secondary Blue on white', ANCHORS.blue, '#FFFFFF'],
    ['amber-500 as text on white', ANCHORS.amber, '#FFFFFF'],
  ];
  for (const [label, a, b] of pairs) {
    const r = contrast(a, b);
    console.log(`  ${label.padEnd(32)} ${r.toFixed(2).padStart(6)}:1  ${r >= 4.5 ? 'AA text' : r >= 3 ? 'AA large/non-text only' : 'FAILS'}`);
  }
}
