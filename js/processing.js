// processing.js — cleans measurements and holds the project's math.
// Everything here is a pure function (no DOM, no audio), so it can be tested
// with `node tests/math.test.mjs` and audited against the README formulas.

// ---------- Basic helpers ----------

export const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
export const lerp = (a, b, t) => a + (b - a) * t;

// Step 2 of "Measurements to Sound":  d_norm = (d - d_min) / (d_max - d_min)
export function normalize(d, dMin, dMax) {
  if (!Number.isFinite(d) || dMax === dMin) return 0;
  return clamp((d - dMin) / (dMax - dMin));
}

export function normalizeSeries(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max, norm: values.map((v) => normalize(v, min, max)) };
}

// Centered moving average. Used to expose the long-term trend of a series.
export function movingAverage(values, window = 5) {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j >= 0 && j < values.length) {
        sum += values[j];
        count++;
      }
    }
    return sum / count;
  });
}

// Exponential smoothing for live features, so sound does not jump harshly.
// alpha = 1 means no smoothing; smaller alpha means slower, smoother changes.
export class Smoother {
  constructor(alpha = 0.35) {
    this.alpha = alpha;
    this.value = null;
  }
  next(x) {
    this.value = this.value === null ? x : this.value + this.alpha * (x - this.value);
    return this.value;
  }
  reset() {
    this.value = null;
  }
}

// ---------- Frequency mappings (section D of the team math notes) ----------

// 1. Linear:       f(x) = f_min + x (f_max - f_min)
export const linearMap = (x, fMin, fMax) => fMin + clamp(x) * (fMax - fMin);

// 2. Logarithmic:  f(x) = f_min (f_max / f_min)^x   (pitch perception is roughly logarithmic)
export const logMap = (x, fMin, fMax) => fMin * Math.pow(fMax / fMin, clamp(x));

// 3. Quantized:    f(n) = 440 * 2^((n - 69) / 12)   (n is a MIDI note number)
export const midiToFreq = (n) => 440 * Math.pow(2, (n - 69) / 12);
export const freqToMidi = (f) => 69 + 12 * Math.log2(f / 440);

export const SCALES = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonicMajor: [0, 2, 4, 7, 9],
  pentatonicMinor: [0, 3, 5, 7, 10],
};

// Snap a normalized value to the nearest note of a musical scale between fMin and fMax.
export function quantizedMap(x, fMin, fMax, scale = "pentatonicMinor", root = 57) {
  const degrees = SCALES[scale] || SCALES.chromatic;
  const target = freqToMidi(logMap(x, fMin, fMax));
  const lo = Math.ceil(freqToMidi(fMin) - 1e-9);
  const hi = Math.floor(freqToMidi(fMax) + 1e-9);
  let best = Math.round(target);
  let bestDist = Infinity;
  for (let n = lo; n <= hi; n++) {
    const degree = (((n - root) % 12) + 12) % 12;
    if (!degrees.includes(degree)) continue;
    const dist = Math.abs(n - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = n;
    }
  }
  return { midi: best, freq: midiToFreq(best) };
}

// One entry point for the three curves. Returns { freq, midi }.
export function mapFrequency(x, { curve = "quantized", fMin = 220, fMax = 880, scale, root } = {}) {
  if (curve === "linear") {
    const freq = linearMap(x, fMin, fMax);
    return { freq, midi: freqToMidi(freq) };
  }
  if (curve === "log") {
    const freq = logMap(x, fMin, fMax);
    return { freq, midi: freqToMidi(freq) };
  }
  return quantizedMap(x, fMin, fMax, scale, root);
}

const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
export function noteName(midi) {
  const n = Math.round(midi);
  return `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}

// ---------- Light and sound (the "Conjugates" section) ----------

export const SPEED_OF_LIGHT = 299792458; // m/s

// f_light = c / lambda
export const wavelengthToFrequency = (nm) => SPEED_OF_LIGHT / (nm * 1e-9);

// Visible light is ~400-790 THz. Halving a frequency 40 times (40 octaves down)
// lands it in the audible range while keeping the ratios between colors.
export const lightToAudible = (nm, octaves = 40) => wavelengthToFrequency(nm) / Math.pow(2, octaves);

// Spectral intensity to amplitude:  A_i = A_max (I_i - I_min) / (I_max - I_min)
export const intensityToAmplitude = (I, iMin, iMax, aMax = 1) => aMax * normalize(I, iMin, iMax);

// Approximate display color for a wavelength (for the on-screen swatch only).
export function wavelengthToRgb(nm) {
  let r = 0, g = 0, b = 0;
  if (nm >= 380 && nm < 440) { r = -(nm - 440) / 60; b = 1; }
  else if (nm < 490) { g = (nm - 440) / 50; b = 1; }
  else if (nm < 510) { g = 1; b = -(nm - 510) / 20; }
  else if (nm < 580) { r = (nm - 510) / 70; g = 1; }
  else if (nm < 645) { r = 1; g = -(nm - 645) / 65; }
  else if (nm <= 750) { r = 1; }
  let k = 1;
  if (nm < 420) k = 0.3 + (0.7 * (nm - 380)) / 40;
  else if (nm > 700) k = 0.3 + (0.7 * (750 - nm)) / 50;
  return [r, g, b].map((c) => Math.round(255 * Math.pow(c * k, 0.8)));
}

// ---------- Data tracks (sound derived from scientific data) ----------

// Turns a list of measurements into normalized per-step features.
//   value    : the measurement itself, normalized 0..1
//   trend    : smoothed measurement, same normalization
//   change   : size of the step-to-step change, normalized by the largest change
//   progress : position in time, 0 at the start and 1 at the end
export function buildDataTrack(labels, values, { trendWindow = 9 } = {}) {
  const { min, max, norm } = normalizeSeries(values);
  const trend = movingAverage(values, trendWindow).map((v) => normalize(v, min, max));
  const diffs = values.map((v, i) => (i === 0 ? 0 : Math.abs(v - values[i - 1])));
  const maxDiff = Math.max(...diffs) || 1;
  const n = values.length;
  const features = values.map((_, i) => ({
    value: norm[i],
    trend: trend[i],
    change: diffs[i] / maxDiff,
    progress: n > 1 ? i / (n - 1) : 0,
  }));
  return { labels, values, min, max, features, length: n };
}

// Linear interpolation between two neighbouring steps of a track.
export function featuresAt(track, position) {
  const i = clamp(Math.floor(position), 0, track.length - 1);
  const j = Math.min(track.length - 1, i + 1);
  const t = clamp(position - i);
  const a = track.features[i];
  const b = track.features[j];
  const out = {};
  for (const key of Object.keys(a)) out[key] = lerp(a[key], b[key], t);
  return out;
}

// ---------- Frame features (sound derived from image appearance) ----------

export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

export const COLOR_TARGETS = {
  warm: { label: "Warm colors (reds, oranges)", hueFrom: 330, hueTo: 50 },
  cool: { label: "Cool colors (blues)", hueFrom: 180, hueTo: 270 },
  fire: { label: "Vivid reds and oranges (fire, hot spots)", hueFrom: 345, hueTo: 28, minSat: 0.6, minVal: 0.6 },
  yellow: { label: "Vivid yellows (lightning, bright fronts)", hueFrom: 40, hueTo: 68, minSat: 0.55, minVal: 0.55 },
  green: { label: "Greens", hueFrom: 75, hueTo: 170 },
  bright: { label: "Bright areas (any color)", brightOnly: true },
};

function hueInRange(h, from, to) {
  return from <= to ? h >= from && h <= to : h >= from || h <= to;
}

// Reads one frame (RGBA pixels) and returns raw features, each 0..1:
//   brightness  : mean luminance of the frame
//   colorAmount : fraction of pixels that belong to the selected color target
//   centroidX   : horizontal center of the selected color (0 = left, 1 = right)
//   warmth      : balance of warm versus cool colored pixels (0.5 = balanced)
//   change      : mean luminance change since the previous frame
// `prevLum` is the luminance array returned by the previous call (or null).
export function extractFrameFeatures(pixels, width, height, prevLum = null, target = COLOR_TARGETS.warm) {
  const n = width * height;
  const lum = new Float32Array(n);
  let lumSum = 0, diffSum = 0, hit = 0, hitX = 0, warm = 0, cool = 0;
  for (let i = 0; i < n; i++) {
    const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2];
    const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    lum[i] = l;
    lumSum += l;
    if (prevLum) diffSum += Math.abs(l - prevLum[i]);
    const [h, s, v] = rgbToHsv(r, g, b);
    const colored = s >= 0.25 && v >= 0.2;
    if (colored) {
      if (hueInRange(h, 330, 50)) warm++;
      else if (hueInRange(h, 180, 270)) cool++;
    }
    const isHit = target.brightOnly
      ? l >= 0.6
      : colored && s >= (target.minSat ?? 0) && v >= (target.minVal ?? 0) && hueInRange(h, target.hueFrom, target.hueTo);
    if (isHit) {
      hit++;
      hitX += i % width;
    }
  }
  return {
    brightness: lumSum / n,
    colorAmount: hit / n,
    centroidX: hit > 0 ? hitX / hit / Math.max(1, width - 1) : 0.5,
    warmth: warm + cool > 0 ? warm / (warm + cool) : 0.5,
    change: prevLum ? diffSum / n : 0,
    lum,
  };
}

// Rescale raw frame features with the fixed ranges stored in the catalog, so the
// same frame always produces the same sound and the tuning is auditable.
export function normalizeFrameFeatures(raw, ranges = {}) {
  const out = {};
  for (const key of ["brightness", "colorAmount", "centroidX", "warmth", "change"]) {
    const [lo, hi] = ranges[key] || [0, 1];
    out[key] = normalize(raw[key], lo, hi);
  }
  return out;
}
