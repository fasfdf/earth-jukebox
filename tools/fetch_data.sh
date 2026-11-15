#!/usr/bin/env bash
# Downloads the raw measurement files behind the "From NASA measurements" items
# into data/raw/. Run from the project folder:   bash tools/fetch_data.sh
# Each file is reported as saved or as COULD NOT DOWNLOAD; one failure does not stop the rest.
#
# Sources:
#   NASA GISS, GISTEMP v4                      https://data.giss.nasa.gov/gistemp/
#   NASA Ozone Watch                           https://ozonewatch.gsfc.nasa.gov/
#   NOAA Global Monitoring Laboratory          https://gml.noaa.gov/ccgg/trends/
#   NSIDC Sea Ice Index (G02135)               https://nsidc.org/data/g02135
#   NOAA NCEI ocean heat content               https://www.ncei.noaa.gov/access/global-ocean-heat-content/
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

N="https://noaadata.apps.nsidc.org/NOAA/G02135"
fetch gistemp_zonal_annual.csv "https://data.giss.nasa.gov/gistemp/tabledata_v4/ZonAnn.Ts+dSST.csv"
fetch gistemp_global_monthly.csv "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv"
fetch co2_annmean_mlo.csv "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_annmean_mlo.csv"
fetch co2_monthly_mlo.csv "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.csv"
fetch ch4_annmean_global.csv "https://gml.noaa.gov/webdata/ccgg/trends/ch4/ch4_annmean_gl.csv"
fetch arctic_sea_ice_september.csv "$N/north/monthly/data/N_09_extent_v4.0.csv" "$N/north/monthly/data/N_09_extent_v3.0.csv"
fetch arctic_sea_ice_march.csv "$N/north/monthly/data/N_03_extent_v4.0.csv" "$N/north/monthly/data/N_03_extent_v3.0.csv"
fetch antarctic_sea_ice_february.csv "$N/south/monthly/data/S_02_extent_v4.0.csv" "$N/south/monthly/data/S_02_extent_v3.0.csv"
fetch antarctic_sea_ice_september.csv "$N/south/monthly/data/S_09_extent_v4.0.csv" "$N/south/monthly/data/S_09_extent_v3.0.csv"
fetch ozone_hole_annual.txt "https://ozonewatch.gsfc.nasa.gov/statistics/annual_data.txt"
fetch ocean_heat_content_0-2000m.dat "https://www.ncei.noaa.gov/data/oceans/woa/DATA_ANALYSIS/3M_HEAT_CONTENT/DATA/basin/yearly/h22-w0-2000m.dat"
echo "Done."
