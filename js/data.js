// data.js — gets data: the catalog, the measurement files, and NASA media.

import { buildDataTrack } from "./processing.js";

export async function loadCatalog(url = "data/catalog.json") {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load the catalog (${response.status})`);
  return response.json();
}

// Loads the measurements for a "data" item and turns them into a feature track.
export async function loadDataTrack(item) {
  const response = await fetch(item.data.file);
  if (!response.ok) throw new Error(`Could not load ${item.data.file} (${response.status})`);
  const json = await response.json();
  let track;
  if (json.values2) {
    // Two series compared on one shared scale: `values` in the left ear, `values2` in the right.
    const min = Math.min(...json.values, ...json.values2);
    const max = Math.max(...json.values, ...json.values2);
    track = buildDataTrack(json.labels, json.values, { min, max });
    track.second = buildDataTrack(json.labels, json.values2, { min, max });
  } else {
    track = buildDataTrack(json.labels, json.values);
  }
  track.meta = json.meta || {};
  return track;
}

// Finds a playable source for a "video" item.
// 1. A local copy in assets/images/ (same origin, so its pixels can be analysed).
//    It is read fully into memory so that seeking works on any simple web server.
// 2. Otherwise NASA's own URL. Browsers only allow pixel analysis of another
//    site's video if that site permits it, so analysis may be blocked in this case.
export async function resolveVideoSource(item) {
  const visual = item.visual || {};
  if (visual.objectUrl) return { url: visual.objectUrl, origin: "user", analysable: true };
  if (visual.local) {
    try {
      const response = await fetch(visual.local);
      const type = response.headers.get("content-type") || "";
      if (response.ok && !type.includes("text/html")) {
        const blob = await response.blob();
        return { url: URL.createObjectURL(blob), origin: "local", analysable: true };
      }
    } catch {
      // fall through to the remote copy
    }
  }
  if (visual.remote) return { url: visual.remote, origin: "remote", analysable: null };
  return null;
}

// Builds catalog items from files the user picked (one video, or a set of images).
export async function itemFromFiles(files, template) {
  const list = [...files];
  const video = list.find((f) => f.type.startsWith("video/"));
  const base = {
    ...template,
    source: {
      name: "Your own file",
      attribution: "Loaded from this computer. Add the original source and credit before sharing.",
      license: "Unknown — check the reuse terms of the original.",
    },
  };
  if (video) {
    return {
      ...base,
      id: "user-video",
      kind: "video",
      title: `Your video: ${video.name}`,
      visual: { objectUrl: URL.createObjectURL(video) },
    };
  }
  const images = list
    .filter((f) => f.type.startsWith("image/"))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (images.length === 0) throw new Error("Choose a video file or one or more image frames.");
  const frames = await Promise.all(images.map((f) => createImageBitmap(f)));
  return {
    ...base,
    id: "user-frames",
    kind: "frames",
    title: `Your frames: ${images.length} image${images.length === 1 ? "" : "s"}`,
    frames,
    frameNames: images.map((f) => f.name),
  };
}
