// sonification.js — converts normalized measurements into sound.
//
//   M : D -> S        a mapping from data to sound parameters
//   M(d_i) = (f_i, A_i, T_i, P_i)   frequency, amplitude, timbre, stereo position
//   x_i(t) = A_i sin(2 pi f_i t + phi_i)   is what an oscillator then produces
//
// The same engine runs on a live AudioContext (real-time playback) and on an
// OfflineAudioContext (WAV export), so what you export is what you heard.

import { clamp, lerp, mapFrequency, featuresAt } from "./processing.js";

// Hard bounds. Nothing in a catalog mapping can push the sound above these.
const LIMITS = { tone: 0.32, texture: 0.05, pluck: 0.3, ceiling: 0.9 };

// ---------- Mapping: features (0..1) -> sound parameters ----------

function pick(features, feature, fallback = 0.5) {
  const v = features[feature];
  return Number.isFinite(v) ? clamp(v) : fallback;
}

export function computeSoundParams(features, mapping, { curve } = {}) {
  const p = mapping.pitch || {};
  const { freq, midi } = mapFrequency(pick(features, p.feature), { ...p, curve: curve || p.curve });
  const l = mapping.loudness || {};
  const t = mapping.timbre || {};
  const s = mapping.pan || {};
  const x = mapping.texture || {};
  const d = mapping.density || {};
  return {
    freq,
    midi,
    amp: lerp(l.min ?? 0.5, l.max ?? 0.5, pick(features, l.feature)),
    brightness: lerp(t.min ?? 0.4, t.max ?? 0.4, pick(features, t.feature)),
    pan: lerp(s.min ?? 0, s.max ?? 0, pick(features, s.feature)),
    // Gated: small changes stay silent, so the hiss only appears for clearly large changes.
    texture: lerp(0, x.max ?? 0, clamp((pick(features, x.feature, 0) - 0.35) / 0.65)),
    rate: d.feature ? lerp(d.minRate ?? 0, d.maxRate ?? 4, pick(features, d.feature, 0)) : 0,
  };
}

// ---------- Synthesis ----------

export class SonificationEngine {
  constructor(ctx, { volume = 0.7, waveform = "triangle" } = {}) {
    this.ctx = ctx;
    this.started = false;

    // bus -> volume -> limiter -> ceiling -> speakers (analyser taps the final signal)
    this.bus = ctx.createGain();
    this.volume = ctx.createGain();
    this.volume.gain.value = volume;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -14;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.25;
    this.ceiling = ctx.createGain();
    this.ceiling.gain.value = LIMITS.ceiling;
    this.bus.connect(this.volume).connect(this.limiter).connect(this.ceiling).connect(ctx.destination);
    this.analyser = null;
    if (ctx.createAnalyser) {
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.ceiling.connect(this.analyser);
    }

    // Continuous voice: oscillator (+ quiet octave below) -> low-pass filter -> gain -> pan
    this.osc = ctx.createOscillator();
    this.osc.type = waveform;
    this.sub = ctx.createOscillator();
    this.sub.type = "sine";
    this.subGain = ctx.createGain();
    this.subGain.gain.value = 0.45;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.Q.value = 0.8;
    this.toneGain = ctx.createGain();
    this.toneGain.gain.value = 0;
    this.panner = ctx.createStereoPanner();
    this.osc.connect(this.filter);
    this.sub.connect(this.subGain).connect(this.filter);
    this.filter.connect(this.toneGain).connect(this.panner).connect(this.bus);

    // Texture voice: looped noise -> band-pass -> gain. Driven by "how much is changing".
    const seconds = 2;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 1234567;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 16807) % 2147483647; // deterministic, so exports are repeatable
      data[i] = (seed / 2147483647) * 2 - 1;
    }
    this.noise = ctx.createBufferSource();
    this.noise.buffer = buffer;
    this.noise.loop = true;
    this.noiseFilter = ctx.createBiquadFilter();
    this.noiseFilter.type = "bandpass";
    this.noiseFilter.frequency.value = 650; // low and soft, closer to wind than static
    this.noiseFilter.Q.value = 0.5;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    this.noise.connect(this.noiseFilter).connect(this.noiseGain).connect(this.bus);
  }

  start(when = 0) {
    if (this.started) return;
    this.osc.start(when);
    this.sub.start(when);
    this.noise.start(when);
    this.started = true;
  }

  setVolume(v) {
    this.volume.gain.setTargetAtTime(clamp(v), this.ctx.currentTime, 0.02);
  }

  setWaveform(type) {
    this.osc.type = type;
  }

  // Glide the continuous voice toward new parameters. `tc` is the smoothing time constant.
  update(params, when = this.ctx.currentTime, tc = 0.05) {
    const f = clamp(params.freq, 40, 4000);
    this.osc.frequency.setTargetAtTime(f, when, tc);
    this.sub.frequency.setTargetAtTime(f / 2, when, tc);
    this.toneGain.gain.setTargetAtTime(clamp(params.amp) * LIMITS.tone, when, tc);
    // Timbre: 0 = dark and mellow, 1 = bright. The filter opens from ~1.5x to ~9x the pitch.
    this.filter.frequency.setTargetAtTime(clamp(f * lerp(1.5, 9, clamp(params.brightness)), 80, 12000), when, tc);
    this.panner.pan.setTargetAtTime(clamp(params.pan, -1, 1), when, tc);
    this.noiseGain.gain.setTargetAtTime(clamp(params.texture) * LIMITS.texture, when, tc * 2);
  }

  // A short plucked note. Marks each time step so rhythm carries the timing.
  pluck({ freq, amp = 0.6, pan = 0, decay = 0.4 }, when = this.ctx.currentTime) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = clamp(freq, 40, 4000);
    const gain = ctx.createGain();
    const peak = Math.max(0.0001, clamp(amp) * LIMITS.pluck);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(peak, when + 0.008); // soft attack: no clicks
    gain.gain.exponentialRampToValueAtTime(0.0001, when + decay);
    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);
    osc.connect(gain).connect(panner).connect(this.bus);
    osc.start(when);
    osc.stop(when + decay + 0.05);
  }

  // Fade everything out quickly and cancel anything already scheduled.
  silence(when = this.ctx.currentTime) {
    for (const param of [this.toneGain.gain, this.noiseGain.gain]) {
      param.cancelScheduledValues(when);
      param.setTargetAtTime(0, when, 0.03);
    }
  }
}

// ---------- Offline render and WAV export ----------

// Renders a whole data track to an AudioBuffer with the same engine and mapping.
export async function renderDataTrack(track, mapping, { stepSeconds = 0.25, curve, volume = 0.7, sampleRate = 44100 } = {}) {
  const tail = 1.0;
  const duration = track.length * stepSeconds + tail;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
  const engine = new SonificationEngine(ctx, { volume, waveform: mapping.waveform || "triangle" });
  engine.start(0);
  for (let i = 0; i < track.length; i++) {
    const when = i * stepSeconds;
    const params = computeSoundParams(featuresAt(track, i), mapping, { curve });
    engine.update(params, when, 0.05);
    engine.pluck({ freq: params.freq, amp: params.amp, pan: params.pan }, when);
  }
  engine.silence(track.length * stepSeconds);
  return ctx.startRendering();
}

// 16-bit PCM WAV encoder.
export function encodeWav(buffer) {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytes = frames * channels * 2;
  const view = new DataView(new ArrayBuffer(44 + bytes));
  const text = (offset, s) => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); };
  text(0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, bytes, true);
  const data = [];
  for (let c = 0; c < channels; c++) data.push(buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([view], { type: "audio/wav" });
}
