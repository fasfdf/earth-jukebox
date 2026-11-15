// visualizer.js — displays the data, the frames, and the audio waveform.

import { clamp } from "./processing.js";

// Match the canvas pixel size to its on-screen size (sharp on high-density displays).
export function fitCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width * ratio));
  const h = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { w, h, ratio };
}

// Blue (below zero) – white (zero) – red (above zero).
function divergingColor(value, maxAbs) {
  const t = clamp(value / maxAbs, -1, 1);
  const cold = [33, 102, 172];
  const mid = [240, 240, 240];
  const hot = [178, 24, 43];
  const end = t < 0 ? cold : hot;
  const k = Math.abs(t);
  const c = mid.map((m, i) => Math.round(m + (end[i] - m) * k));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function formatValue(value, item) {
  const sign = item.data.signed && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)} ${item.data.unit}`;
}

// Draws a data track: one colored stripe per step, the values as a line, and a playhead.
// With reducedMotion the whole chart is shown at once and only the playhead moves.
export function drawDataStage(canvas, track, item, position, { reducedMotion = false } = {}) {
  const { w, h, ratio } = fitCanvas(canvas);
  const ctx = canvas.getContext("2d");
  const n = track.length;
  const index = clamp(Math.floor(position), 0, n - 1);
  const shown = reducedMotion ? n - 1 : index;
  const maxAbs = Math.max(Math.abs(track.min), Math.abs(track.max)) || 1;
  const stripeW = w / n;

  ctx.fillStyle = "#070b18";
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i <= shown; i++) {
    ctx.fillStyle = divergingColor(track.values[i], maxAbs);
    ctx.fillRect(Math.floor(i * stripeW), 0, Math.ceil(stripeW) + 1, h);
  }

  // Value line, so the information does not rely on color alone.
  const padTop = h * 0.3;
  const padBottom = h * 0.12;
  const y = (v) => padTop + (1 - (v - track.min) / (track.max - track.min || 1)) * (h - padTop - padBottom);
  const x = (i) => (i + 0.5) * stripeW;

  ctx.lineWidth = 1 * ratio;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.setLineDash([6 * ratio, 6 * ratio]);
  ctx.beginPath();
  ctx.moveTo(0, y(0));
  ctx.lineTo(w, y(0));
  ctx.stroke();
  ctx.setLineDash([]);

  for (const [color, width] of [["rgba(255,255,255,0.9)", 5], ["#0b1020", 2.5]]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width * ratio;
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = 0; i <= shown; i++) {
      if (i === 0) ctx.moveTo(x(i), y(track.values[i]));
      else ctx.lineTo(x(i), y(track.values[i]));
    }
    ctx.stroke();
  }

  // Playhead.
  ctx.fillStyle = "#0b1020";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2 * ratio;
  ctx.beginPath();
  ctx.arc(x(index), y(track.values[index]), 7 * ratio, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (reducedMotion) {
    ctx.strokeStyle = "rgba(11,16,32,0.8)";
    ctx.beginPath();
    ctx.moveTo(x(index), 0);
    ctx.lineTo(x(index), h);
    ctx.stroke();
  }

  // Current step label on a solid plate for contrast.
  const label = `${track.labels[index]}`;
  const value = formatValue(track.values[index], item);
  ctx.font = `700 ${Math.round(34 * ratio)}px system-ui, sans-serif`;
  const labelW = ctx.measureText(label).width;
  ctx.font = `600 ${Math.round(18 * ratio)}px system-ui, sans-serif`;
  const valueW = ctx.measureText(value).width;
  const plateW = Math.max(labelW, valueW) + 28 * ratio;
  ctx.fillStyle = "rgba(7,11,24,0.88)";
  ctx.fillRect(14 * ratio, 14 * ratio, plateW, 78 * ratio);
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "top";
  ctx.font = `700 ${Math.round(34 * ratio)}px system-ui, sans-serif`;
  ctx.fillText(label, 28 * ratio, 22 * ratio);
  ctx.font = `600 ${Math.round(18 * ratio)}px system-ui, sans-serif`;
  ctx.fillStyle = "#ffd28a";
  ctx.fillText(value, 28 * ratio, 62 * ratio);
}

// Draws one image frame, letterboxed to fit.
export function drawFrameStage(canvas, bitmap) {
  const { w, h } = fitCanvas(canvas);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#070b18";
  ctx.fillRect(0, 0, w, h);
  if (!bitmap) return;
  const scale = Math.min(w / bitmap.width, h / bitmap.height);
  const dw = bitmap.width * scale;
  const dh = bitmap.height * scale;
  ctx.drawImage(bitmap, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

// Oscilloscope view of the sound that is actually being played.
let scopeBuffer = null;
export function drawScope(canvas, analyser) {
  const { w, h, ratio } = fitCanvas(canvas);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(111,211,255,0.25)";
  ctx.lineWidth = 1 * ratio;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();
  if (!analyser) return;
  if (!scopeBuffer || scopeBuffer.length !== analyser.fftSize) scopeBuffer = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(scopeBuffer);
  ctx.strokeStyle = "#6fd3ff";
  ctx.lineWidth = 2 * ratio;
  ctx.beginPath();
  for (let i = 0; i < scopeBuffer.length; i++) {
    const px = (i / (scopeBuffer.length - 1)) * w;
    const py = h / 2 - scopeBuffer[i] * h * 0.9;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}
