// Run with:  node tests/math.test.mjs
// Checks the formulas in js/processing.js against the worked examples in the team's math notes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalize, linearMap, logMap, midiToFreq, quantizedMap, mapFrequency, noteName,
  wavelengthToFrequency, lightToAudible, intensityToAmplitude,
  buildDataTrack, featuresAt, extractFrameFeatures, normalizeFrameFeatures, COLOR_TARGETS,
} from "../js/processing.js";

const near = (a, b, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

// Brightness table: 0.15, 0.40, 0.75, 1.00 mapped linearly to 220-880 Hz.
const brightness = [0.15, 0.4, 0.75, 1.0];
const norm = brightness.map((d) => normalize(d, 0.15, 1.0));
near(norm[1], 0.29, 0.005);
near(norm[2], 0.71, 0.005);
const hz = norm.map((x) => linearMap(x, 220, 880));
near(hz[0], 220); near(hz[1], 414, 1); near(hz[2], 686, 1); near(hz[3], 880);
// (The notes round the normalized value to two decimals first, which gives 411 and 689 Hz.)
near(linearMap(0.29, 220, 880), 411, 0.5);
near(linearMap(0.71, 220, 880), 689, 0.5);

// Log mapping: halfway between 220 and 880 Hz is one octave up, 440 Hz.
near(logMap(0.5, 220, 880), 440, 0.001);

// Quantized mapping: MIDI 69 is A4 = 440 Hz; every result lands on a scale note.
near(midiToFreq(69), 440, 1e-9);
near(midiToFreq(81), 880, 1e-9);
assert.equal(noteName(69), "A4");
for (let x = 0; x <= 1; x += 0.05) {
  const { midi, freq } = quantizedMap(x, 220, 880, "pentatonicMinor", 57);
  assert.ok([0, 3, 5, 7, 10].includes((((midi - 57) % 12) + 12) % 12));
  assert.ok(freq >= 219.9 && freq <= 880.1);
}
assert.equal(mapFrequency(0, { curve: "quantized" }).midi, 57);
assert.equal(mapFrequency(1, { curve: "quantized" }).midi, 81);

// Light: f = c / lambda. 500 nm is about 600 THz; 40 octaves down is about 545 Hz.
near(wavelengthToFrequency(500) / 1e12, 599.6, 0.1);
near(lightToAudible(500), 545.3, 0.1);
near(intensityToAmplitude(5, 0, 10, 0.8), 0.4, 1e-9);

// Data track built from the bundled NASA file.
const gistemp = JSON.parse(readFileSync(new URL("../data/gistemp_annual.json", import.meta.url)));
assert.equal(gistemp.labels.length, gistemp.values.length);
assert.equal(gistemp.labels[0], 1880);
for (let i = 1; i < gistemp.labels.length; i++) assert.equal(gistemp.labels[i], gistemp.labels[i - 1] + 1);
const track = buildDataTrack(gistemp.labels, gistemp.values);
assert.equal(track.labels[track.values.indexOf(track.max)], 2024);
assert.equal(track.labels[track.values.indexOf(track.min)], 1909);
for (const f of track.features) for (const v of Object.values(f)) assert.ok(v >= 0 && v <= 1);
near(featuresAt(track, 0.5).value, (track.features[0].value + track.features[1].value) / 2, 1e-9);

// Frame features: an all-red frame is "warm"; a frame that is red only on the right pans right.
const w = 8, h = 4;
const frame = (fn) => { const p = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) p.set(fn(i % w), i * 4); return p; };
const red = extractFrameFeatures(frame(() => [220, 30, 30, 255]), w, h, null, COLOR_TARGETS.warm);
near(red.colorAmount, 1, 1e-9); near(red.warmth, 1, 1e-9); assert.equal(red.change, 0);
const blue = extractFrameFeatures(frame(() => [30, 60, 220, 255]), w, h, red.lum, COLOR_TARGETS.warm);
near(blue.colorAmount, 0, 1e-9); near(blue.warmth, 0, 1e-9); assert.ok(blue.change > 0);
const split = extractFrameFeatures(frame((x) => (x >= w / 2 ? [220, 30, 30, 255] : [20, 20, 20, 255])), w, h, null, COLOR_TARGETS.warm);
assert.ok(split.centroidX > 0.7); near(split.colorAmount, 0.5, 1e-9);
const n = normalizeFrameFeatures(split, { colorAmount: [0, 0.5] });
near(n.colorAmount, 1, 1e-9);

console.log("All math checks passed.");
