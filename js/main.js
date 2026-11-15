// main.js — application controller. Connects the page, the data, the
// sonification engine and the visualizer, and owns the single playback clock.

import { loadCatalog, loadDataTrack, resolveVideoSource, itemFromFiles } from "./data.js";
import {
  clamp, normalize, featuresAt, noteName, formatLabel, isDecadeStart, freqToMidi, Smoother, COLOR_TARGETS,
  extractFrameFeatures, normalizeFrameFeatures,
  wavelengthToFrequency, lightToAudible, wavelengthToRgb,
} from "./processing.js";
import { SonificationEngine, computeSoundParams, renderDataTrack, encodeWav, COMPARE_PAN, shouldPluck } from "./sonification.js";
import { drawDataStage, drawFrameStage, drawScope, formatValue } from "./visualizer.js";

const $ = (id) => document.getElementById(id);
const el = {
  select: $("itemSelect"), file: $("fileInput"), stage: $("stage"), canvas: $("stageCanvas"),
  video: $("stageVideo"), note: $("stageNote"), caption: $("stageCaption"), scope: $("scope"),
  play: $("playBtn"), restart: $("restartBtn"), prev: $("prevBtn"), next: $("nextBtn"),
  legend: $("legendBtn"), guided: $("guided"), speak: $("speak"), decades: $("decades"), decadesLabel: $("decadesLabel"), about: $("aboutBlock"), timeline: $("timeline"), time: $("timeReadout"),
  volume: $("volume"), mute: $("muteBtn"), timeRange: $("itemTimeRange"), speed: $("speed"), curve: $("curve"), colorField: $("colorTargetField"),
  color: $("colorTarget"), reduced: $("reducedMotion"), announce: $("announce"), exportBtn: $("exportBtn"),
  status: $("status"), live: $("liveRegion"), title: $("itemTitle"), badge: $("derivedBadge"),
  description: $("itemDescription"), summary: $("itemSummary"), momentNow: $("momentNow"),
  momentsBlock: $("momentsBlock"), moments: $("moments"), mapping: $("mappingTable").querySelector("tbody"),
  readout: $("liveReadout"), limitations: $("limitations"), source: $("sourceBlock"),
  wavelength: $("wavelength"), swatch: $("swatch"), lightReadout: $("lightReadout"), lightPlay: $("lightPlay"),
};

const ANALYSIS_W = 128;
const ANALYSIS_H = 72;
const analysisCanvas = document.createElement("canvas");
analysisCanvas.width = ANALYSIS_W;
analysisCanvas.height = ANALYSIS_H;
const analysisCtx = analysisCanvas.getContext("2d", { willReadFrequently: true });

const state = {
  catalog: null,
  item: null,
  track: null,       // data items: the feature track
  duration: 0,       // seconds
  pos: 0,            // seconds — the one playback clock everything follows
  playing: false,
  loading: false,
  scrubbing: false,
  lastNow: 0,        // audio clock reading at the previous tick
  lastIdx: -1,       // last step (data) or frame (frames) that was handled
  lastSample: 0,     // time of the last video frame analysis
  lastTs: 0,
  lastReadout: 0,
  dirty: true,       // the stage needs redrawing
  analysable: true,  // false when the browser refuses to read the pixels
  features: null,    // latest smoothed image features
  prevLum: null,
  smoothers: {},
  notePhase: 0,
  params: null,
  ctx: null,
  engine: null,
  muted: false,
};

// ---------- Small helpers ----------

const setStatus = (text) => { el.status.textContent = text; };
const speed = () => parseFloat(el.speed.value) || 1;
const formatClock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function ensureAudio() {
  if (!state.ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    state.ctx = new AudioCtx();
    state.engine = new SonificationEngine(state.ctx, {
      volume: currentVolume(),
      waveform: state.item?.mapping.waveform || "triangle",
    });
    state.engine.start();
    // Second voice for comparisons; it plays through the first engine's volume and limiter.
    state.engine2 = new SonificationEngine(state.ctx, { waveform: "sawtooth", destination: state.engine.bus });
    state.engine2.start();
  }
  return state.ctx.state === "suspended" ? state.ctx.resume() : Promise.resolve();
}

function currentVolume() {
  return state.muted ? 0 : el.volume.value / 100;
}

function stepSeconds() {
  return state.item.timing.stepSeconds || 0.25;
}

function framesPerSecond() {
  return state.item.timing.framesPerSecond || 4;
}

// A data item can show a NASA animation of the same data alongside its chart.
// The measurements drive the sound; the video only follows the data clock.
function companion() {
  return state.item?.kind === "data" && state.hasCompanion ? state.item.visual.companion : null;
}

function companionTime() {
  const c = companion();
  const t = (state.pos / stepSeconds()) * c.secondsPerStep;
  return clamp(t, 0, Math.max(0, (el.video.duration || 0) - 0.05));
}

function syncCompanion(force = false) {
  const c = companion();
  if (!c || el.video.readyState < 1) return;
  const target = companionTime();
  if (force || Math.abs(el.video.currentTime - target) > 0.35) el.video.currentTime = target;
  el.video.playbackRate = clamp((c.secondsPerStep / stepSeconds()) * speed(), 0.25, 4);
}

// ---------- Guided tour ----------
// At each key moment the sound stops, the description is shown (and optionally
// spoken), and playback then carries on by itself.
function cancelGuide() {
  clearTimeout(state.guideTimer);
  state.guiding = false;
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

function guidePause(text) {
  pause("");
  state.guiding = true;
  setStatus(text);
  const resume = () => {
    if (!state.guiding) return;
    cancelGuide();
    play();
  };
  if (el.speak.checked && "speechSynthesis" in window) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = resume;
    utterance.onerror = resume;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    state.guideTimer = setTimeout(resume, 25000); // safety net if the browser never reports the end
  } else {
    state.guideTimer = setTimeout(resume, Math.max(3500, text.length * 75));
  }
}

// ---------- Transport ----------

async function play() {
  if (!state.item || state.loading || state.duration <= 0) return;
  await ensureAudio();
  state.engine.setWaveform(state.item.mapping.waveform || "triangle");
  if (state.pos >= state.duration - 0.02) seek(0);
  state.lastNow = state.ctx.currentTime;
  state.notePhase = 0;
  if (state.item.kind === "video") {
    el.video.playbackRate = speed();
    try {
      await el.video.play();
    } catch {
      setStatus("The browser could not start this video.");
      return;
    }
  }
  if (companion()) {
    syncCompanion(true);
    el.video.play().catch(() => {});
  }
  state.playing = true;
  el.play.textContent = "Pause";
  setStatus(state.analysable === false ? "Playing the picture only. This video cannot be analysed from here, so there is no sound." : "Playing.");
}

function pause(message = "Paused.") {
  if (state.item?.kind === "video" || companion()) el.video.pause();
  state.engine?.silence();
  state.engine2?.silence();
  if (state.playing) setStatus(message);
  state.playing = false;
  el.play.textContent = "Play";
}

function seek(seconds) {
  state.pos = clamp(seconds, 0, state.duration);
  if (state.item?.kind === "video" && Number.isFinite(state.pos)) el.video.currentTime = state.pos;
  if (companion()) syncCompanion(true);
  if (state.ctx) state.lastNow = state.ctx.currentTime;
  state.lastIdx = -1;
  state.prevLum = null;
  state.lastSample = 0;
  state.dirty = true;
  if (state.playing) {
    state.engine.silence(); // release anything sounding; the next tick resumes
    state.engine2.silence();
  }
}

// ---------- Selecting an item ----------

async function selectItem(item) {
  cancelGuide();
  pause("");
  state.loading = true;
  state.item = item;
  state.track = null;
  state.pos = 0;
  state.duration = 0;
  state.lastIdx = -1;
  state.features = null;
  state.prevLum = null;
  state.params = null;
  state.params2 = null;
  state.scrubIdx = -1;
  state.smoothers = {};
  state.analysable = true;
  state.hasCompanion = false;
  el.stage.classList.remove("split");
  el.note.hidden = true;
  el.momentNow.hidden = true;
  el.readout.textContent = "Press Play to start.";
  setStatus("Loading…");

  const isVideo = item.kind === "video";
  el.video.hidden = !isVideo;
  el.canvas.hidden = isVideo;
  if (!isVideo) {
    el.video.pause();
    el.video.removeAttribute("src");
    el.video.load();
  }

  try {
    if (item.kind === "data") {
      state.track = await loadDataTrack(item);
      state.duration = state.track.length * stepSeconds();
      if (item.visual.companion) {
        const source = await resolveVideoSource({ visual: { local: item.visual.companion.local } });
        if (source && (await loadVideoUrl(source.url, false))) {
          state.hasCompanion = true;
          el.video.hidden = false;
          el.stage.classList.add("split");
        }
      }
    } else if (item.kind === "frames") {
      state.duration = item.frames.length / framesPerSecond();
    } else {
      await attachVideo(item);
    }
    setStatus(state.duration > 0 ? "Ready. Press Play to listen." : el.status.textContent);
  } catch (error) {
    setStatus(`Something went wrong while loading: ${error.message}`);
  }

  renderInfo(item);
  el.timeline.max = String(Math.max(0.01, state.duration));
  el.timeline.value = "0";
  const isData = item.kind === "data" && !!state.track;
  el.prev.hidden = el.next.hidden = el.decadesLabel.hidden = !isData;
  el.timeline.step = isData ? String(stepSeconds()) : "0.01";
  const unit = (item.data?.stepLabel || "year").toLowerCase();
  el.prev.textContent = `Previous ${unit}`;
  el.next.textContent = `Next ${unit}`;
  // Each item starts on its own recommended pitch curve; the listener can still change it.
  el.curve.value = item.mapping.pitch.curve || "quantized";
  el.exportBtn.disabled = item.kind !== "data";
  el.exportBtn.title = item.kind === "data" ? "" : "Audio download is available for items that are driven by data.";
  el.colorField.hidden = item.derivedFrom !== "image-features";
  if (item.colorTarget) el.color.value = item.colorTarget;
  state.loading = false;
  state.dirty = true;
}

function loadVideoUrl(url, withCors) {
  const video = el.video;
  return new Promise((resolve) => {
    const done = (ok) => {
      clearTimeout(timer);
      video.removeEventListener("loadedmetadata", onOk);
      video.removeEventListener("error", onBad);
      resolve(ok);
    };
    const onOk = () => done(true);
    const onBad = () => done(false);
    const timer = setTimeout(() => done(false), 20000);
    video.addEventListener("loadedmetadata", onOk);
    video.addEventListener("error", onBad);
    if (withCors) video.crossOrigin = "anonymous";
    else video.removeAttribute("crossorigin");
    video.src = url;
    video.load();
  });
}

async function attachVideo(item) {
  const source = await resolveVideoSource(item);
  let ok = false;
  if (source) {
    if (source.origin === "remote") {
      ok = await loadVideoUrl(source.url, true); // ask NASA's server for permission to read pixels
      if (!ok) {
        ok = await loadVideoUrl(source.url, false); // display only
        state.analysable = false;
      }
    } else {
      ok = await loadVideoUrl(source.url, false);
    }
  }
  if (!ok) {
    state.analysable = false;
    showStageNote("This NASA video could not be loaded. Check the internet connection, or save a local copy by running tools/fetch_assets.sh in the project folder, then reload the page.");
    setStatus("The video is not available right now.");
    return;
  }
  state.duration = el.video.duration;
  if (state.analysable === false) showBlockedNote();
}

function showStageNote(text) {
  el.note.textContent = text;
  el.note.hidden = false;
}

function showBlockedNote() {
  showStageNote("The picture plays from NASA's website, but the browser is not allowed to read its pixels from another site, so it cannot be turned into sound here. Run tools/fetch_assets.sh once to save a local copy, then reload the page.");
}

// ---------- Information panels ----------

const MAPPING_ROWS = [
  ["pitch", "Pitch (how high the note is)"],
  ["density", "Rhythm (how often notes play)"],
  ["loudness", "Loudness"],
  ["timbre", "Tone (mellow to bright)"],
  ["pan", "Left–right position"],
  ["texture", "Background hiss"],
];

function addText(parent, tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  parent.appendChild(node);
  return node;
}

function renderInfo(item) {
  el.title.textContent = item.title;
  const fromData = item.derivedFrom === "scientific-data";
  el.badge.textContent = fromData ? "Sound derived from scientific data" : "Sound derived from image features";
  el.badge.classList.toggle("image", !fromData);
  el.timeRange.hidden = !item.timeRange;
  el.timeRange.textContent = item.timeRange ? `Time range: ${item.timeRange}` : "";
  el.description.textContent = item.description;
  el.summary.textContent = item.summary;
  el.canvas.setAttribute("aria-label", `${item.title}. ${item.summary}`);
  el.caption.textContent = item.kind === "data"
    ? `${state.hasCompanion ? `Top: ${item.visual.companion.label}, following the data. Bottom: ` : ""}${item.visual.caption || "One colored stripe per step, with a line and a label showing the same values, so nothing depends on color alone."}`
    : "The video's own audio is muted so only the sonification is heard.";

  el.mapping.replaceChildren();
  for (const [key, name] of MAPPING_ROWS) {
    const m = item.mapping[key];
    if (!m) continue;
    const row = document.createElement("tr");
    addText(row, "th", name).scope = "row";
    addText(row, "td", m.drivenBy || "");
    addText(row, "td", m.explain || "");
    addText(row, "td", m.bounds || "");
    el.mapping.appendChild(row);
  }

  el.moments.replaceChildren();
  const moments = item.keyMoments || [];
  el.momentsBlock.hidden = moments.length === 0 || !state.track;
  if (state.track) {
    for (const moment of moments) {
      const index = state.track.labels.indexOf(moment.at);
      if (index < 0) continue;
      const li = document.createElement("li");
      const button = addText(li, "button", moment.text);
      button.type = "button";
      button.addEventListener("click", () => {
        cancelGuide();
        seek(index * stepSeconds());
      });
      el.moments.appendChild(li);
    }
  }

  el.about.replaceChildren();
  for (const part of item.about || []) {
    addText(el.about, "h3", part.heading);
    addText(el.about, "p", part.text);
  }

  el.limitations.replaceChildren();
  for (const text of item.limitations || []) addText(el.limitations, "li", text);

  el.source.replaceChildren();
  const s = item.source || {};
  if (s.name) {
    const p = document.createElement("p");
    if (s.url) {
      const a = addText(p, "a", s.name);
      a.href = s.url;
      a.target = "_blank";
      a.rel = "noopener";
    } else {
      p.textContent = s.name;
    }
    el.source.appendChild(p);
  }
  if (s.attribution) addText(el.source, "p", `Credit: ${s.attribution}`);
  if (s.license) addText(el.source, "p", `Reuse: ${s.license}`);
  if (s.accessed) addText(el.source, "p", `Accessed: ${s.accessed}`);
  if (s.related) addText(el.source, "p", s.related);
  if (item.data?.file) {
    const p = addText(el.source, "p", "Values used by this page: ");
    const a = addText(p, "a", item.data.file.split("/").pop());
    a.href = item.data.file;
    a.download = "";
  }
}

function onDataStep(index) {
  const item = state.item;
  const moment = (item.keyMoments || []).find((m) => m.at === state.track.labels[index]);
  if (moment) {
    el.momentNow.textContent = moment.text;
    el.momentNow.hidden = false;
    if (state.playing && el.guided.checked) guidePause(moment.text);
    else if (state.playing && el.announce.checked) el.live.textContent = moment.text;
  }
  return moment ? moment.text : "";
}

// ---------- The tick: one clock drives picture and sound ----------

function advanceClock() {
  const item = state.item;
  if (item.kind === "video") {
    if (!state.scrubbing && !el.video.seeking && el.video.readyState > 0) state.pos = el.video.currentTime;
    if (state.playing && el.video.ended) pause("Finished. Press Play to listen again.");
    return;
  }
  if (!state.playing) return;
  const now = state.ctx.currentTime;
  state.pos += (now - state.lastNow) * speed();
  state.lastNow = now;
  if (state.pos >= state.duration) {
    state.pos = state.duration;
    pause("Finished. Press Play to listen again.");
  }
  syncCompanion();
}

// Sound parameters for one series at a (possibly fractional) step position.
function soundFor(track, x, pan) {
  const params = computeSoundParams(featuresAt(track, x), state.item.mapping, { curve: el.curve.value });
  if (pan !== undefined) params.pan = pan;
  return params;
}

// The plucked note (or pair of notes) for one step, plus the decade tick.
function playStepNotes(index) {
  const { track } = state;
  const dual = !!track.second;
  const a = soundFor(track, index, dual ? -COMPARE_PAN : undefined);
  state.engine.pluck({ freq: a.freq, amp: a.amp, pan: a.pan });
  if (dual) {
    const b = soundFor(track.second, index, COMPARE_PAN);
    state.engine2.pluck({ freq: b.freq, amp: b.amp, pan: b.pan });
  }
  if (el.decades.checked && isDecadeStart(track.labels[index])) state.engine.tick();
}

// "1998: +0.61 °C", or both values for a comparison.
function stepText(index) {
  const { track, item } = state;
  if (!track.second) return `${formatLabel(track.labels[index])}: ${formatValue(track.values[index], item)}`;
  const names = item.data.names || ["Left", "Right"];
  return `${track.labels[index]}: ${names[0]} ${formatValue(track.values[index], item)}, ${names[1]} ${formatValue(track.second.values[index], item)}`;
}

function tickData() {
  const { track, item } = state;
  const x = state.pos / stepSeconds();
  const index = Math.min(track.length - 1, Math.floor(x));
  const dual = !!track.second;
  state.params = soundFor(track, x, dual ? -COMPARE_PAN : undefined);
  state.params2 = dual ? soundFor(track.second, x, COMPARE_PAN) : null;
  if (state.playing) {
    state.engine.update(state.params);
    if (dual) state.engine2.update(state.params2);
  }
  if (index !== state.lastIdx) {
    if (state.playing) {
      if (shouldPluck(track.labels[index], item.timing)) playStepNotes(index);
      else if (el.decades.checked && isDecadeStart(track.labels[index])) state.engine.tick();
    }
    state.lastIdx = index;
    state.dirty = true;
    onDataStep(index);
  }
  if (state.dirty) {
    drawDataStage(el.canvas, track, item, x, { reducedMotion: el.reduced.checked });
    state.dirty = false;
  }
}

// Explore at your own pace: move one step, play its note, and read out its value.
async function stepBy(delta) {
  const { track } = state;
  if (!track) return;
  cancelGuide();
  if (state.playing) pause("");
  await ensureAudio();
  const current = clamp(Math.floor(state.pos / stepSeconds() + 1e-6), 0, track.length - 1);
  const index = clamp(current + delta, 0, track.length - 1);
  seek(index * stepSeconds() + 0.001);
  state.lastIdx = index;
  playStepNotes(index);
  const moment = onDataStep(index);
  const text = moment ? `${stepText(index)}. ${moment.replace(/^[^:]{4,14}: /, "")}` : stepText(index);
  setStatus(text);
}

// An audible legend: the lowest note, the baseline (if there is one) and the highest note.
async function playLegend() {
  const item = state.item;
  if (!item) return;
  pause("");
  await ensureAudio();
  const notes = [];
  const add = (level, text) => {
    const features = { value: level, trend: level, change: 0, progress: 0.5, brightness: level, colorAmount: level, warmth: level, centroidX: 0.5 };
    notes.push({ freq: computeSoundParams(features, item.mapping, { curve: el.curve.value }).freq, text });
  };
  const track = state.track;
  if (item.kind === "data" && track) {
    add(0, `the lowest value, ${formatValue(track.min, item)}`);
    if (item.data.signed && track.min < 0 && track.max > 0) add(normalize(0, track.min, track.max), `the baseline, 0 ${item.data.unit}`);
    add(1, `the highest value, ${formatValue(track.max, item)}`);
  } else {
    add(0, "the lowest note this item plays");
    add(1, "the highest note this item plays");
  }
  setStatus(`Reference notes, in order: ${notes.map((n) => n.text).join("; ")}.`);
  notes.forEach((n, i) => {
    state.engine.pluck({ freq: n.freq, amp: 0.8, pan: 0, decay: 0.7 }, state.ctx.currentTime + 0.2 + i * 0.85);
  });
}

function analyse(source) {
  if (state.analysable === false) return;
  try {
    analysisCtx.drawImage(source, 0, 0, ANALYSIS_W, ANALYSIS_H);
    const image = analysisCtx.getImageData(0, 0, ANALYSIS_W, ANALYSIS_H);
    const raw = extractFrameFeatures(image.data, ANALYSIS_W, ANALYSIS_H, state.prevLum, COLOR_TARGETS[el.color.value]);
    state.prevLum = raw.lum;
    const normalized = normalizeFrameFeatures(raw, state.item.featureRanges);
    const smoothed = {};
    for (const [key, value] of Object.entries(normalized)) {
      state.smoothers[key] ||= new Smoother(0.35);
      smoothed[key] = state.smoothers[key].next(value);
    }
    state.features = smoothed;
  } catch {
    // Cross-origin pixels: the browser refuses to hand them over.
    state.analysable = false;
    state.features = null;
    state.engine?.silence();
    showBlockedNote();
    if (state.playing) setStatus("Playing the picture only. This video cannot be analysed from here, so there is no sound.");
  }
}

function tickImage(ts) {
  const item = state.item;
  const dt = clamp((ts - state.lastTs) / 1000, 0, 0.1);
  if (item.kind === "frames") {
    const index = Math.min(item.frames.length - 1, Math.floor(state.pos * framesPerSecond()));
    if (index !== state.lastIdx || state.dirty) {
      drawFrameStage(el.canvas, item.frames[index]);
      if (index !== state.lastIdx) analyse(item.frames[index]);
      state.lastIdx = index;
      state.dirty = false;
    }
  } else {
    const due = ts - state.lastSample >= (item.timing.sampleSeconds || 0.08) * 1000;
    if ((state.playing || state.dirty) && due && el.video.readyState >= 2) {
      analyse(el.video);
      state.lastSample = ts;
      state.dirty = false;
    }
  }
  if (!state.features) {
    state.params = null;
    return;
  }
  const params = computeSoundParams(state.features, item.mapping, { curve: el.curve.value });
  state.params = params;
  if (!state.playing) return;
  state.engine.update(params);
  state.notePhase += params.rate * dt * speed();
  if (state.notePhase >= 1) {
    state.notePhase %= 1;
    state.engine.pluck({ freq: params.freq, amp: params.amp, pan: params.pan });
  }
}

function updateTransport(ts) {
  const item = state.item;
  if (!state.scrubbing) el.timeline.value = String(state.pos);
  let text;
  if (item.kind === "data" && state.track) {
    const index = clamp(Math.floor(state.pos / stepSeconds()), 0, state.track.length - 1);
    text = stepText(index).replace(": ", " · ");
  } else {
    text = `${formatClock(state.pos)} of ${formatClock(state.duration || 0)}`;
  }
  if (el.time.textContent !== text) {
    el.time.textContent = text;
    el.timeline.setAttribute("aria-valuetext", text);
  }
  if (ts - state.lastReadout > 250 && state.params) {
    state.lastReadout = ts;
    const p = state.params;
    if (state.params2 && item.kind === "data") {
      const names = item.data.names || ["Left", "Right"];
      const dualText = `Left ear, ${names[0]}: note ${noteName(p.midi)} (${Math.round(p.freq)} Hz) · Right ear, ${names[1]}: note ${noteName(state.params2.midi)} (${Math.round(state.params2.freq)} Hz)`;
      if (el.readout.textContent !== dualText) el.readout.textContent = dualText;
      return;
    }
    const side = Math.abs(p.pan) < 0.05 ? "centre" : `${Math.round(Math.abs(p.pan) * 100)}% ${p.pan < 0 ? "left" : "right"}`;
    const parts = [
      `Note ${noteName(p.midi)} (${Math.round(p.freq)} Hz)`,
      `level ${Math.round(p.amp * 100)}%`,
      `tone ${Math.round(p.brightness * 100)}% bright`,
      `position ${side}`,
      `hiss ${Math.round(p.texture * 100)}%`,
    ];
    if (item.mapping.density?.feature) parts.push(`${p.rate.toFixed(1)} notes per second`);
    const textNow = parts.join(" · ");
    if (el.readout.textContent !== textNow) el.readout.textContent = textNow;
  }
}

function loop(ts) {
  requestAnimationFrame(loop);
  if (!state.item || state.loading) return;
  advanceClock();
  if (state.item.kind === "data") {
    if (state.track) tickData();
  } else {
    tickImage(ts);
  }
  updateTransport(ts);
  if (!el.reduced.checked) drawScope(el.scope, state.engine?.analyser);
  state.lastTs = ts;
}

// ---------- Export ----------

function download(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function mappingNotes(item) {
  const lines = [
    `Earth Jukebox — listening notes`,
    ``,
    item.title,
    item.derivedFrom === "scientific-data" ? "Sound derived from scientific data." : "Sound derived from image features.",
    ``,
    item.description,
    ``,
    `What happens: ${item.summary}`,
    ``,
    `How data becomes sound (pitch curve: ${el.curve.options[el.curve.selectedIndex].text}, speed: ${el.speed.options[el.speed.selectedIndex].text}):`,
  ];
  for (const [key, name] of MAPPING_ROWS) {
    const m = item.mapping[key];
    if (m) lines.push(`- ${name}: ${m.drivenBy}. ${m.explain} Limits: ${m.bounds}.`);
  }
  lines.push(``, `Limitations:`);
  for (const text of item.limitations || []) lines.push(`- ${text}`);
  const s = item.source || {};
  lines.push(``, `Source: ${s.name || ""} ${s.url || ""}`, `Credit: ${s.attribution || ""}`, `Accessed: ${s.accessed || ""}`);
  return lines.join("\n");
}

async function exportAudio() {
  const { item, track } = state;
  if (!item || item.kind !== "data" || !track) return;
  el.exportBtn.disabled = true;
  setStatus("Rendering audio…");
  try {
    const buffer = await renderDataTrack(track, item.mapping, {
      stepSeconds: stepSeconds() / speed(),
      curve: el.curve.value,
      volume: Math.max(0.2, el.volume.value / 100),
      decadeTicks: el.decades.checked,
      timing: item.timing,
    });
    download(encodeWav(buffer), `earth-jukebox-${item.id}.wav`);
    download(new Blob([mappingNotes(item)], { type: "text/plain" }), `earth-jukebox-${item.id}-notes.txt`);
    setStatus("Audio and listening notes downloaded.");
  } catch (error) {
    setStatus(`The audio could not be rendered: ${error.message}`);
  }
  el.exportBtn.disabled = false;
}

// ---------- Light to sound lab ----------

function updateLight() {
  const nm = Number(el.wavelength.value);
  const thz = wavelengthToFrequency(nm) / 1e12;
  const hz = lightToAudible(nm);
  const [r, g, b] = wavelengthToRgb(nm);
  el.swatch.style.background = `rgb(${r},${g},${b})`;
  const text = `Wavelength ${nm} nm · light frequency ${thz.toFixed(0)} THz · 40 octaves lower is ${hz.toFixed(1)} Hz, close to the note ${noteName(freqToMidi(hz))}`;
  el.lightReadout.textContent = text;
  el.wavelength.setAttribute("aria-valuetext", `${nm} nanometres, ${hz.toFixed(0)} hertz`);
}

// ---------- Wiring ----------

const GROUP_LABELS = {
  measurements: "From NASA measurements",
  frames: "From video colors",
};

function addOption(item) {
  const key = item.group || "frames";
  let group = el.select.querySelector(`optgroup[data-group="${key}"]`);
  if (!group) {
    group = document.createElement("optgroup");
    group.label = GROUP_LABELS[key] || key;
    group.dataset.group = key;
    el.select.appendChild(group);
  }
  const option = document.createElement("option");
  option.value = item.id;
  option.textContent = item.title;
  group.appendChild(option);
}

async function init() {
  el.reduced.checked = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  applyReducedMotion();
  for (const [key, target] of Object.entries(COLOR_TARGETS)) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = target.label;
    el.color.appendChild(option);
  }
  updateLight();

  try {
    state.catalog = await loadCatalog();
  } catch (error) {
    el.title.textContent = "The catalog could not be loaded";
    setStatus(`${error.message}. Open this page through a local web server.`);
    return;
  }
  state.catalog.items.forEach(addOption);

  el.select.addEventListener("change", () => {
    const item = state.catalog.items.find((i) => i.id === el.select.value);
    if (item) selectItem(item);
  });
  el.file.addEventListener("change", async () => {
    if (!el.file.files.length) return;
    try {
      const template = state.catalog.userTemplate;
      const mapping = state.catalog.items.find((i) => i.id === template.mappingFrom).mapping;
      const item = await itemFromFiles(el.file.files, { ...template, mapping });
      state.catalog.items = state.catalog.items.filter((i) => !i.id.startsWith("user-"));
      [...el.select.querySelectorAll("option")].filter((o) => o.value.startsWith("user-")).forEach((o) => o.remove());
      state.catalog.items.push(item);
      addOption(item);
      el.select.value = item.id;
      await selectItem(item);
    } catch (error) {
      setStatus(error.message);
    }
  });

  el.play.addEventListener("click", () => {
    if (state.guiding) {
      cancelGuide();
      setStatus("Tour stopped. Press Play to carry on.");
      return;
    }
    state.playing ? pause() : play();
  });
  el.restart.addEventListener("click", () => {
    cancelGuide();
    seek(0);
    setStatus("Back at the start.");
  });
  el.timeline.addEventListener("pointerdown", () => { state.scrubbing = true; });
  el.timeline.addEventListener("input", () => {
    seek(parseFloat(el.timeline.value));
    // While paused on a measurement item, moving the timeline plays the note you land on.
    if (!state.playing && state.item?.kind === "data" && state.track) {
      const index = clamp(Math.floor(state.pos / stepSeconds() + 1e-6), 0, state.track.length - 1);
      if (index !== state.scrubIdx) {
        state.scrubIdx = index;
        ensureAudio().then(() => playStepNotes(index));
      }
    }
  });
  el.prev.addEventListener("click", () => stepBy(-1));
  el.next.addEventListener("click", () => stepBy(1));
  el.legend.addEventListener("click", playLegend);
  for (const type of ["pointerup", "pointercancel", "change", "blur"]) {
    el.timeline.addEventListener(type, () => { state.scrubbing = false; });
  }
  el.volume.addEventListener("input", () => state.engine?.setVolume(currentVolume()));
  el.mute.addEventListener("click", () => {
    state.muted = !state.muted;
    el.mute.textContent = state.muted ? "Unmute" : "Mute";
    el.mute.setAttribute("aria-pressed", String(state.muted));
    state.engine?.setVolume(currentVolume());
    setStatus(state.muted ? "Sound muted." : "Sound on.");
  });
  el.speed.addEventListener("change", () => {
    if (companion()) syncCompanion();
    else el.video.playbackRate = speed();
  });
  el.curve.addEventListener("change", () => { state.dirty = true; });
  el.color.addEventListener("change", () => { state.prevLum = null; state.dirty = true; });
  el.reduced.addEventListener("change", applyReducedMotion);
  el.exportBtn.addEventListener("click", exportAudio);
  el.wavelength.addEventListener("input", updateLight);
  el.lightPlay.addEventListener("click", async () => {
    await ensureAudio();
    state.engine.pluck({ freq: lightToAudible(Number(el.wavelength.value)), amp: 0.8, decay: 1.2 });
  });

  document.addEventListener("keydown", (event) => {
    if (event.code !== "Space" || event.repeat) return;
    const tag = event.target.tagName;
    if (["BUTTON", "INPUT", "SELECT", "TEXTAREA", "A", "SUMMARY"].includes(tag)) return;
    event.preventDefault();
    state.playing ? pause() : play();
  });
  window.addEventListener("resize", () => { state.dirty = true; });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.playing) pause("Paused because the page was hidden.");
  });
  window.addEventListener("pagehide", () => pause(""));

  await selectItem(state.catalog.items[0]);
  requestAnimationFrame(loop);
}

function applyReducedMotion() {
  el.stage.classList.toggle("reduced", el.reduced.checked);
  el.scope.hidden = el.reduced.checked;
  state.dirty = true;
}

init();
