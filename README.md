# Earth Jukebox

NASA Space Apps Challenge 2026 — **Earth Information Jukebox**

Earth Jukebox pairs NASA Earth Information Center (EIC) visualizations with sound generated in real time in the browser, so a changing planet can be heard as well as seen. It is a static site: HTML, CSS and JavaScript with the Web Audio API. There is no backend and nothing to install.

## Try it

**Live site: <https://fasfdf.github.io/earth-jukebox/>**

Open the link, choose a visualization and press Play. Nothing plays until you do, and there is nothing to install. It has been tested in Chrome; other current browsers should work but have not been checked.

## Run it locally (for development)

The page loads JavaScript modules and JSON, which browsers block when a file is opened directly, so use a local web server:

- **VS Code:** install the "Live Server" extension, right-click `index.html`, choose "Open with Live Server".
- **Terminal:** `python3 -m http.server 8000` in this folder, then open <http://localhost:8000>.

### NASA videos

Small web-sized copies (640 pixels wide, about 20 MB in total) of the NASA animations are included in `assets/clips/`, so every item works on the live site and straight after cloning. The app analyses frames at 128 × 72 pixels, so these copies produce the same sound as the originals.

To fetch the full-quality originals from NASA (about 430 MB, saved to `assets/images/` and not committed to git):

```bash
bash tools/fetch_assets.sh
```

To use an original in the app, change that item's `visual.local` path in `data/catalog.json`. You can also load any video or set of image frames from your own computer with the file picker; those are analysed live.

### Check the math

```bash
node tests/math.test.mjs
```

## What is in the jukebox

| Item | Sound derived from | Source |
|---|---|---|
| Global temperature, 1880–2025 (NASA map animation plays in step) | **Scientific data**: GISTEMP v4 annual global mean anomaly | NASA GISS, <https://data.giss.nasa.gov/gistemp/> |
| Arctic temperature, 1880–2025 | **Scientific data**: GISTEMP v4 zonal annual means, 64°N–90°N | NASA GISS, <https://data.giss.nasa.gov/gistemp/> |
| Carbon dioxide in the air, 1959–2025 | **Scientific data**: Mauna Loa annual mean | NOAA Global Monitoring Laboratory, <https://gml.noaa.gov/ccgg/trends/> |
| Arctic sea ice in September, 1979–2026 | **Scientific data**: Sea Ice Index monthly extent | NSIDC, <https://nsidc.org/data/g02135> |
| Global temperature map animation | **Image features** of each video frame | NASA SVS visualization 5603, <https://svs.gsfc.nasa.gov/5603/> |
| Spread of the Dixie Fire, 2021 | **Image features** of each video frame | NASA SVS visualization 4993, <https://svs.gsfc.nasa.gov/4993/> |
| Ocean surface currents and temperature, 2007–2008 | **Image features** | NASA SVS visualization 3912, <https://svs.gsfc.nasa.gov/3912/> |
| Lightning seen from the Space Station, 2017–2023 | **Image features** | NASA SVS visualization 5011, <https://svs.gsfc.nasa.gov/5011/> |
| Your own video or frames | **Image features** | Whatever you load. Credit its source. |

The measurement-driven items are the main list: every note is a real value, which is what makes the science audible to someone who cannot see the picture. This direction came from a blind member of the team after testing the first version. The video-color items are kept as a second group for exploring a visualization by ear. Every item states which of the two it is. Color on screen is a picture of the data, not the measurement, so where NASA publishes the numbers behind a visualization we use the numbers.

## Project structure

```
earth-jukebox/
├── index.html            Website structure
├── styles.css            Styling
├── README.md             This file
├── js/
│   ├── main.js           Connects the components; owns the single playback clock
│   ├── data.js           Gets data: catalog, measurement files, NASA media, user files
│   ├── processing.js     Cleans measurements: normalization, smoothing, mappings, frame features
│   ├── sonification.js   Converts measurements into sound; WAV export
│   └── visualizer.js     Displays the data, the frames and the audio waveform
├── data/
│   ├── catalog.json      One entry per visualization: source, description, timing, mapping
│   ├── gistemp_annual.json and three more measurement files
│   └── raw/              Source files exactly as downloaded
├── tools/
│   ├── fetch_assets.sh   Downloads the NASA video into assets/images/
│   ├── update_data.py    Refreshes the global temperature data directly from NASA GISS
│   └── fetch_data.sh     Downloads the raw Arctic temperature, carbon dioxide and sea ice files
├── tests/math.test.mjs   Checks the formulas against the worked examples below
└── assets/
    ├── clips/            Web-sized copies of the NASA animations (committed)
    ├── images/           Full-quality originals from tools/fetch_assets.sh (not committed)
    └── audio/            Exported audio
```

Data flow: `index.html` / `styles.css` → `main.js` (controller) → `data.js` + `processing.js` (data engine) → `sonification.js` (sonification engine) → Web Audio API.

Mapping parameters live in `data/catalog.json`, not in the player code, so the sound design of each visualization can be tuned and audited without touching JavaScript.

## Methodology

### Sound as a function

A computer represents a sound wave as

```
x(t) = A · sin(2π f t + φ)
```

where `A` is amplitude (signal strength), `f` is frequency in hertz (pitch), `t` is time in seconds and `φ` is the phase offset (where the wave is in its cycle at `t = 0`). The waveform shape sets the timbre.

### Sonification as a mapping

Sonification is the systematic transformation of data into sound: a mapping `M : D → S` from a dataset to sound parameters. For each measurement,

```
M(dᵢ) = (fᵢ, Aᵢ, Tᵢ, Pᵢ)      frequency, amplitude, timbre, stereo position
xᵢ(t) = Aᵢ · sin(2π fᵢ t + φᵢ)
```

### From measurements to sound

1. **Form a dataset.**
2. **Normalize:** `d_norm = (d − d_min) / (d_max − d_min)` — `normalize()` in `processing.js`.
3. **Map to frequency.** Three curves are implemented and can be switched live with the "Pitch curve" control:

| Curve | Formula | Function |
|---|---|---|
| Linear | `f(x) = f_min + x (f_max − f_min)` | `linearMap` |
| Logarithmic | `f(x) = f_min (f_max / f_min)^x` | `logMap` |
| Quantized (musical scale) | `f(n) = 440 · 2^((n − 69) / 12)`, `n` a MIDI note | `quantizedMap`, `midiToFreq` |

Human pitch perception is close to logarithmic, so the log curve gives equal steps in the data equal steps in perceived pitch. The quantized curve snaps the log result to the nearest note of a scale, which is easier to listen to.

Worked example, linear, 220–880 Hz:

| Brightness | Normalized | Frequency |
|---|---|---|
| 0.15 | 0.00 | 220 Hz |
| 0.40 | 0.29 | 411 Hz |
| 0.75 | 0.71 | 689 Hz |
| 1.00 | 1.00 | 880 Hz |

(With unrounded normalized values the middle two are 414 Hz and 686 Hz; the test file checks both.)

### Multi-dimensional mapping

One measurement stream can drive several sound parameters at once. `computeSoundParams()` in `sonification.js` returns pitch, loudness, tone brightness, stereo position, background texture and note rate, each from a named feature and each inside fixed bounds.

For the temperature data: anomaly → pitch and tone brightness; nine-year average → loudness; year-to-year change → a soft hiss; position in time → left to right.

For image frames, following the team plan:

| Image feature | Sound | Guard |
|---|---|---|
| Balance of warm against cool colors | Pitch | Snapped to a scale between 220 and 880 Hz |
| Amount of a selected color | Number of notes per second | Capped at six per second |
| Frame-to-frame change | Background texture | Smoothed so animation does not sound harsh |
| Overall brightness | Loudness | Bounded range, fixed ceiling, volume control |
| Horizontal position of the selected color | Stereo position | 80% left to 80% right |

Frames are sampled about 12 times a second at 128 × 72 pixels (`extractFrameFeatures`), rescaled with fixed ranges from the catalog (`normalizeFrameFeatures`) and smoothed (`Smoother`).

### Light and sound

For a spectrum, each measurement is a pair `(λᵢ, Iᵢ)`: wavelength and intensity.

```
f_light = c / λ                         c = 299,792,458 m/s
Aᵢ = A_max (Iᵢ − I_min) / (I_max − I_min)
```

Visible light (about 380–750 nm) is roughly 400–790 THz, far above hearing. Halving the frequency 40 times, 40 octaves down, brings it into the audible range and keeps the ratios between colors. The "Light to sound" panel lets you try this: 500 nm → 600 THz → 545 Hz. It is a teaching aid, not a measurement.

### Synthesis and timing

- One clock. Data items advance on the audio clock; video items follow the video's own time. Picture and sound read the same position, so they cannot drift.
- A continuous voice (oscillator, low-pass filter, gain, stereo panner) glides between values. A short plucked note marks every time step. A very quiet, low band-passed noise marks only clearly large changes.
- All output passes through a limiter and a fixed ceiling. Pausing, seeking or switching items cancels scheduled sound and fades out within a few hundredths of a second.
- "Download audio (WAV)" renders data-driven items offline with the same engine and mapping, and saves a text file of listening notes alongside.

## Accessibility

- No autoplay, and a mute button beside the volume control. Every control works from the keyboard, has a visible focus ring and a text label.
- Each item has a written description, a plain-language summary of the trend, and key moments you can jump to. "Announce key moments" sends them to screen readers during playback.
- The timeline reports its position in words (for example "1998 · +0.61 °C").
- Meaning never depends on color alone: the chart has a value line and a numeric label, and the mapping is explained in a table.
- "Reduce motion" (on by default if your system asks for it) shows the whole chart with only a moving marker, hides the video and turns off the oscilloscope. Sound continues.
- Loudness is bounded and there are no sudden onsets.

Reviewed by a blind team member, whose feedback moved the project toward measurement-driven sound. Wider testing with blind and low-vision users is the most valuable next step.

## Limitations

- The temperature sonification follows the global yearly average only. It does not say where warming occurs.
- Image-derived sound reflects what is on screen, including legends, labels and map outlines. Treat it as a way to experience the visualization, not as a reading of the data.
- The bundled temperature values were read directly from NASA GISS on 15 November 2026. NASA revises recent years slightly over time; `python3 tools/update_data.py` refreshes them.
- Exact year labels are not shown for the NASA video because its frame timing is not published with the file.

## Adding a visualization

Add an entry to `data/catalog.json`:

- `kind`: `"data"` (a JSON file of `labels` and `values`) or `"video"` (a file in `assets/images/`, optionally with a remote URL).
- `derivedFrom`: `"scientific-data"` or `"image-features"`.
- `title`, `description`, `summary`, `keyMoments`, `limitations`.
- `source`: name, URL, attribution, reuse terms, access date.
- `mapping`: for each of `pitch`, `loudness`, `timbre`, `pan`, `texture` and (for frames) `density`, the feature that drives it, its bounds, and the plain-language text shown to users.

Data features available: `value`, `trend`, `change`, `progress`. Frame features: `brightness`, `colorAmount`, `centroidX`, `warmth`, `change`.

## Team split

- **Frontend:** `index.html`, `styles.css`, `visualizer.js`.
- **NASA data:** `data/`, `tools/`, source documentation in `catalog.json`.
- **Sonification and processing:** `processing.js`, `sonification.js`, `tests/`.

## Credits and sources

- GISTEMP Team, 2026: GISS Surface Temperature Analysis (GISTEMP), version 4. NASA Goddard Institute for Space Studies. <https://data.giss.nasa.gov/gistemp/>
- "Global Temperature Anomalies from 1880 to 2025", NASA's Scientific Visualization Studio, visualization 5603. <https://svs.gsfc.nasa.gov/5603/>
- "Spread of the Dixie Fire - 2021", NASA's Scientific Visualization Studio, visualization 4993. <https://svs.gsfc.nasa.gov/4993/>
- "Global Sea Surface Currents and Temperature", NASA/Goddard Space Flight Center Scientific Visualization Studio, visualization 3912. <https://svs.gsfc.nasa.gov/3912/>
- "Lightning Events Detected from the International Space Station (ISS) 2017-2023", NASA's Scientific Visualization Studio, visualization 5011. <https://svs.gsfc.nasa.gov/5011/>
- NOAA Global Monitoring Laboratory, Trends in Atmospheric Carbon Dioxide, Mauna Loa Observatory. <https://gml.noaa.gov/ccgg/trends/>
- National Snow and Ice Data Center, Sea Ice Index (G02135). <https://nsidc.org/data/g02135>
- NASA Earth Information Center gallery. <https://svs.gsfc.nasa.gov/gallery/earth-information-center/>
- NASA, "Electromagnetic Math". <https://science.nasa.gov/wp-content/uploads/2023/09/Electromagnetic_Math.pdf>
- NASA data sonifications. <https://www.nasa.gov/data-sonifications>
- Sonic Field, "Sonification". <https://sonicfield.org/topics/sonification>
- MDN, Web Audio API. <https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API>

This project is not endorsed by NASA.
