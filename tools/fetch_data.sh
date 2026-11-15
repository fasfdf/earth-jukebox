#!/usr/bin/env bash
# Downloads the raw measurement files behind the "From NASA measurements" items
# into data/raw/. Run from the project folder:   bash tools/fetch_data.sh
#
# Sources:
#   Arctic and hemispheric temperature: NASA GISS, GISTEMP v4 zonal annual means
#     https://data.giss.nasa.gov/gistemp/
#   Atmospheric carbon dioxide at Mauna Loa: NOAA Global Monitoring Laboratory
#     https://gml.noaa.gov/ccgg/trends/
#   Arctic sea ice extent (September): NSIDC Sea Ice Index (NASA-supported data center)
#     https://nsidc.org/data/g02135
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/raw

fetch() {
  local out="data/raw/$1"; shift
  for url in "$@"; do
    echo "Downloading $url"
    if curl -L --fail --silent --show-error --max-time 60 -o "$out.part" "$url"; then
      mv "$out.part" "$out"
      echo "  saved $out ($(wc -l < "$out" | tr -d ' ') lines)"
      return 0
    fi
    echo "  failed, trying the next address if there is one"
  done
  rm -f "$out.part"
  echo "  COULD NOT DOWNLOAD $1"
}

fetch gistemp_zonal_annual.csv "https://data.giss.nasa.gov/gistemp/tabledata_v4/ZonAnn.Ts+dSST.csv"
fetch co2_annmean_mlo.csv "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_annmean_mlo.csv"
fetch arctic_sea_ice_september.csv \
  "https://noaadata.apps.nsidc.org/NOAA/G02135/north/monthly/data/N_09_extent_v4.0.csv" \
  "https://noaadata.apps.nsidc.org/NOAA/G02135/north/monthly/data/N_09_extent_v3.0.csv"
echo "Done."
