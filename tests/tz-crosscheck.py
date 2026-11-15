#!/usr/bin/env python3
"""Cross-check the JavaScript daylight-saving rules against the IANA database.

The browser engine computes UTC offsets from published rules (US, EU, AU, NZ)
rather than Intl/ICU, so that the same numbers come out in every engine and can
be tested head-lessly. This script proves those rules against Python's zoneinfo
for every city and every third hour of 2026-2027.

    python3 tests/tz-crosscheck.py
"""
import datetime as dt
import json
import pathlib
import sys
from zoneinfo import ZoneInfo

import quickjs

ROOT = pathlib.Path(__file__).resolve().parent.parent

ZONES = {
    "seoul": "Asia/Seoul",
    "tokyo": "Asia/Tokyo",
    "singapore": "Asia/Singapore",
    "bali": "Asia/Makassar",
    "bangkok": "Asia/Bangkok",
    "hcmc": "Asia/Ho_Chi_Minh",
    "jakarta": "Asia/Jakarta",
    "dubai": "Asia/Dubai",
    "bangalore": "Asia/Kolkata",
    "istanbul": "Europe/Istanbul",
    "berlin": "Europe/Berlin",
    "amsterdam": "Europe/Amsterdam",
    "lisbon": "Europe/Lisbon",
    "london": "Europe/London",
    "newyork": "America/New_York",
    "toronto": "America/Toronto",
    "chicago": "America/Chicago",
    "denver": "America/Denver",
    "losangeles": "America/Los_Angeles",
    "vancouver": "America/Vancouver",
    "mexicocity": "America/Mexico_City",
    "saopaulo": "America/Sao_Paulo",
    "buenosaires": "America/Argentina/Buenos_Aires",
    "sydney": "Australia/Sydney",
    "melbourne": "Australia/Melbourne",
    "auckland": "Pacific/Auckland",
    "honolulu": "Pacific/Honolulu",
    "nairobi": "Africa/Nairobi",
    "capetown": "Africa/Johannesburg",
}

# Every third hour, 2026-01-01 .. 2027-12-31, plus every hour of the eight
# weeks a year when some country changes its clocks.
instants = []
t = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
end = dt.datetime(2028, 1, 1, tzinfo=dt.timezone.utc)
while t < end:
    instants.append(int(t.timestamp() * 1000))
    t += dt.timedelta(hours=3)

for month in ((3, 4, 9, 10, 11),):
    for year in (2026, 2027):
        for m, days in ((3, range(1, 32)), (4, range(1, 8)), (9, range(20, 31)), (10, range(20, 32)), (11, range(1, 8))):
            for d in days:
                for h in range(0, 24):
                    try:
                        ts = dt.datetime(year, m, d, h, tzinfo=dt.timezone.utc)
                    except ValueError:
                        continue
                    ms = int(ts.timestamp() * 1000)
                    if ms not in instants:
                        instants.append(ms)

instants.sort()

ctx = quickjs.Context()
ctx.eval((ROOT / "app.js").read_text(encoding="utf-8"))
buf = []
ctx.add_callable("__emit", lambda s: buf.append(s))

script = """
(function () {
  var out = {};
  var ids = %s;
  var inst = %s;
  for (var i = 0; i < ids.length; i++) {
    var city = NOMAD.cityById(ids[i]);
    var arr = [];
    for (var j = 0; j < inst.length; j++) arr.push(NOMAD.offsetHours(city, inst[j]));
    out[ids[i]] = arr;
  }
  __emit(JSON.stringify(out));
})()
""" % (json.dumps(list(ZONES)), json.dumps(instants))

ctx.eval(script)
js_offsets = json.loads(buf[-1])

checked = 0
mismatches = []
for city, zone in ZONES.items():
    tz = ZoneInfo(zone)
    got = js_offsets[city]
    for ms, offset in zip(instants, got):
        moment = dt.datetime.fromtimestamp(ms / 1000, tz=dt.timezone.utc).astimezone(tz)
        expected = moment.utcoffset().total_seconds() / 3600
        checked += 1
        if abs(expected - offset) > 1e-9:
            mismatches.append((city, dt.datetime.fromtimestamp(ms / 1000, tz=dt.timezone.utc).isoformat(), offset, expected))

print(f"instants per city: {len(instants)} · cities: {len(ZONES)} · comparisons: {checked}")
if mismatches:
    print(f"MISMATCHES: {len(mismatches)}")
    for city, when, got, want in mismatches[:25]:
        print(f"  {city:12s} {when}  js={got:+.2f}  iana={want:+.2f}")
    sys.exit(1)
print(f"=== DST CROSS-CHECK: PASS {checked} / FAIL 0 ===")
