#!/usr/bin/env python3
"""Sync Atlas's data/ from a gex-replay-basic data source.

Atlas consumes gex-replay-basic's published data verbatim (same manifest.json,
same per-day .json.gz bundles). This script copies that folder in — from a
local checkout or a live deployment — so the two repos never drift:

    python scripts/pull_data.py --source ../gex-replay-basic
    python scripts/pull_data.py --source https://shurwatrader.github.io/gex-replay-basic

Bars under data/bars/ are Atlas's own addition and are left untouched.
(You can also skip syncing entirely: open the app with
?source=<gex-replay-basic url> to read its data live, no copy at all.)
"""

import argparse
import json
import pathlib
import shutil
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent


def fetch(source: str, rel: str) -> bytes:
    if source.startswith(("http://", "https://")):
        with urllib.request.urlopen(f"{source.rstrip('/')}/{rel}") as r:
            return r.read()
    return (pathlib.Path(source) / rel).read_bytes()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source", default="../gex-replay-basic",
                    help="gex-replay-basic checkout path or deployment URL")
    args = ap.parse_args()

    raw = fetch(args.source, "data/manifest.json")
    manifest = json.loads(raw)

    (ROOT / "data").mkdir(exist_ok=True)
    (ROOT / "data" / "manifest.json").write_bytes(raw)

    # Drop slug folders no longer in the manifest so deletions propagate too.
    keep = {s["slug"] for s in manifest["series"]}
    for p in (ROOT / "data").iterdir():
        if p.is_dir() and p.name != "bars" and p.name not in keep:
            shutil.rmtree(p)
            print(f"removed stale {p.relative_to(ROOT)}")

    n = 0
    for series in manifest["series"]:
        for day in series["dates"]:
            rel = day["file"]  # e.g. data/MU_GEXOI/2026-07-05.json.gz
            dest = ROOT / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(fetch(args.source, rel))
            n += 1
            print(f"synced {rel}")
    print(f"done — manifest + {n} bundles from {args.source}")


if __name__ == "__main__":
    main()
