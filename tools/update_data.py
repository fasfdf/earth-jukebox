#!/usr/bin/env python3
"""Refreshes data/gistemp_annual.json directly from NASA GISS.

Usage, from the project folder:   python3 tools/update_data.py

Source file: https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv
(Global-mean monthly, seasonal and annual means; the J-D column is the annual mean.)
"""
import csv
import datetime
import io
import json
import pathlib
import shutil
import subprocess
import urllib.request

URL = "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv"
OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "gistemp_annual.json"


def download(url):
    """Fetch a URL as text. Tries curl first: the Python bundled with macOS uses an
    old TLS library that NASA's servers reject, while the system curl works."""
    if shutil.which("curl"):
        result = subprocess.run(["curl", "-L", "--fail", "--silent", "--show-error", "--max-time", "60", url],
                                capture_output=True)
        if result.returncode == 0:
            return result.stdout.decode("utf-8")
        print("curl failed:", result.stderr.decode("utf-8", "replace").strip())
    request = urllib.request.Request(url, headers={"User-Agent": "earth-jukebox (NASA Space Apps project)"})
    return urllib.request.urlopen(request, timeout=60).read().decode("utf-8")


def main():
    text = download(URL)
    lines = text.splitlines()
    start = next(i for i, line in enumerate(lines) if line.startswith("Year,"))
    labels, values = [], []
    for row in csv.DictReader(io.StringIO("\n".join(lines[start:]))):
        try:
            year, annual = int(row["Year"]), float(row["J-D"])
        except (ValueError, TypeError, KeyError):
            continue  # incomplete years are marked *** in the file
        labels.append(year)
        values.append(annual)
    if len(labels) < 100:
        raise SystemExit("Unexpected file format: fewer than 100 complete years found. Nothing was changed.")
    today = datetime.date.today()
    data = {
        "meta": {
            "title": "Global mean surface temperature anomaly, annual (GISTEMP v4, Land-Ocean Temperature Index)",
            "unit": "°C relative to the 1951-1980 mean",
            "source": f"GISTEMP Team, {today.year}: GISS Surface Temperature Analysis (GISTEMP), version 4. "
                      "NASA Goddard Institute for Space Studies. https://data.giss.nasa.gov/gistemp/",
            "retrieved": today.isoformat(),
            "retrievedVia": URL,
            "note": "Annual (J-D) means. The most recent years can change slightly as NASA updates the analysis.",
        },
        "labels": labels,
        "values": values,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Wrote {len(labels)} years ({labels[0]}-{labels[-1]}) to {OUT}")
    print("If the first or last year changed, update the title, description and keyMoments in data/catalog.json.")


if __name__ == "__main__":
    main()
