#!/usr/bin/env bash
# Downloads the full-quality NASA visualization videos into assets/images/.
# Optional: web-sized copies are already included in assets/clips/ and are what
# the app uses by default.
#
# Usage, from the project folder:   bash tools/fetch_assets.sh
# Files that are already present are skipped.
#
# Sources (credit: NASA's Scientific Visualization Studio):
#   https://svs.gsfc.nasa.gov/5603/  Global Temperature Anomalies from 1880 to 2025
#   https://svs.gsfc.nasa.gov/4993/  Spread of the Dixie Fire - 2021
#   https://svs.gsfc.nasa.gov/5196/  DYAMOND Global Carbon Dioxide
#   https://svs.gsfc.nasa.gov/3912/  Global Sea Surface Currents and Temperature
#   https://svs.gsfc.nasa.gov/5011/  Lightning Events Detected from the ISS 2017-2023
#   https://svs.gsfc.nasa.gov/4960/  A 3D View of an Atmospheric River
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p assets/images

fetch() {
  local out="assets/images/$1" url="$2"
  if [ -s "$out" ]; then echo "Already have $out"; return; fi
  echo "Downloading $url"
  curl -L --fail --progress-bar -o "$out.part" "$url"
  mv "$out.part" "$out"
  echo "Saved $out ($(du -h "$out" | cut -f1))"
}

fetch GISTEMP_Map2025_HD_nosmoothing.mp4 "https://svs.gsfc.nasa.gov/vis/a000000/a005600/a005603/GISTEMP_Map2025_HD_nosmoothing.mp4"
fetch Dixie_fire_2021_4x_1080p30.mp4 "https://svs.gsfc.nasa.gov/vis/a000000/a004900/a004993/Dixie_fire_2021_4x_1080p30.mp4"
fetch dyamond_co2_globe_tilt_1080p30.mp4 "https://svs.gsfc.nasa.gov/vis/a000000/a005100/a005196/dyamondPointCloud_12-4-2023b_dyamond_co2_anim_globe_tilt_1080p30.mp4"
fetch ecco2_sst_flow_540p.webm "https://svs.gsfc.nasa.gov/vis/a000000/a003900/a003912/ecco2_sst_flow.webmhd.webm"
fetch iss_lightning_sphere_1080p.mp4 "https://svs.gsfc.nasa.gov/vis/a000000/a005000/a005011/iss_lightning_sphere_07312023.mp4"
fetch atmos_river_HD.webm "https://svs.gsfc.nasa.gov/vis/a000000/a004900/a004960/atmos_river_HD.webm"
echo "Done. The app uses assets/clips/ by default; see README.md to switch an item to an original."
