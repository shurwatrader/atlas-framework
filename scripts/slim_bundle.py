"""Convert a gex-replay day bundle (plain or .gz) into Atlas' slim sample format.

The full bundles carry display strings, colors, and wall badges per cell —
~128MB raw for a 450-frame day. Atlas only needs numeric GEX per strike/expiry
plus the king flags, so this strips a day down to a few MB:

  { "slim": true, "slug": ..., "date": ...,
    "frames": [ { "t": epochSec, "price": 975.37, "net": -582100000,
                  "expiries": ["07-10-2026", ...],
                  "kingOI": 1000, "kingVol": 950,
                  "rows": [[strike, vK1, vK2, ...], ...] } ] }

Values are integers in $K (multiply by 1e3 for dollars). Rows that are zero
across every expiry in a frame are dropped (they carry no signal).

Usage: python scripts/slim_bundle.py <bundle.json[.gz]> <out.json>
"""
import gzip, json, re, sys
from datetime import datetime, timezone

MULT = {'': 1, 'K': 1e3, 'M': 1e6, 'B': 1e9, 'T': 1e12}
VAL = re.compile(r'^(-?[\d.]+)\s*([KMBT]?)$', re.I)

def parse_value(text):
    if not text:
        return 0
    m = VAL.match(str(text).strip())
    if not m:
        return 0
    return float(m.group(1)) * MULT[m.group(2).upper()]

def slim(path):
    opener = gzip.open if path.endswith('.gz') else open
    with opener(path, 'rt', encoding='utf-8') as f:
        bundle = json.load(f)
    frames = []
    for fr in bundle['frames']:
        king_oi = king_vol = None
        rows = []
        for row in fr['rows']:
            vals = [round(parse_value(v['text']) / 1e3) for v in row['values']]
            if any(v.get('oiKing') for v in row['values']):
                king_oi = row['strike']
            if any(v.get('volKing') for v in row['values']):
                king_vol = row['strike']
            if any(vals):
                rows.append([row['strike'], *vals])
        t = int(datetime.fromisoformat(fr['capturedAt'].replace('Z', '+00:00'))
                .astimezone(timezone.utc).timestamp())
        frames.append({
            't': t, 'price': float(fr['price']),
            'net': fr.get('netExposureValue'),
            'expiries': fr['expiries'],
            'kingOI': king_oi, 'kingVol': king_vol,
            'rows': rows,
        })
    return {'slim': True, 'slug': bundle.get('slug'), 'date': bundle.get('date'), 'frames': frames}

if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    out = slim(src)
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'))
    print(f'{src} -> {dst}: {len(out["frames"])} frames')
