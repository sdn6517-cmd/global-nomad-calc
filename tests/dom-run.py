#!/usr/bin/env python3
"""Run the page's real UI code against a minimal DOM built from index.html.

    python3 tests/dom-run.py
"""
import json
import pathlib
import re
import sys

import quickjs

ROOT = pathlib.Path(__file__).resolve().parent.parent
html = (ROOT / "index.html").read_text(encoding="utf-8")

TAG_RE = re.compile(r"<(input|select|button|div|span|small|table|body|section|header|footer|nav|ul|ol|li|a|p|td|th|thead|tbody|form|label|pre|code|details|summary|h1|h2|h3|article|time)\b([^>]*)>", re.I)
ID_RE = re.compile(r'id="([^"]+)"')
ATTR_RE = re.compile(r'([a-zA-Z-]+)="([^"]*)"')

elements = []
selector_only = []
seen = set()

for match in TAG_RE.finditer(html):
    tag, attrs_text = match.group(1), match.group(2)
    attrs = dict(ATTR_RE.findall(attrs_text))
    ident = attrs.get("id")
    cls = attrs.get("class", "")
    spec = {
        "tag": tag,
        "id": ident or "",
        "cls": cls,
        "value": attrs.get("value", ""),
        "hidden": "hidden" in attrs,
        "attrs": {k: v for k, v in attrs.items() if k not in {"id", "class", "value", "hidden"}},
    }
    if ident:
        if ident in seen:
            continue
        seen.add(ident)
        elements.append(spec)
    elif "tz-member" in cls.split() or "data-vendor" in attrs or attrs.get("role") in {"tab", "tabpanel"}:
        selector_only.append(spec)

fixture = {"elements": elements, "selectorElements": selector_only}

ctx = quickjs.Context()
ctx.add_callable("__log", lambda s: print(s))
ctx.eval("globalThis.console = { log: function (s) { __log(String(s)); } };")
ctx.eval("globalThis.window = globalThis; globalThis.global = globalThis;")
ctx.eval("globalThis.__fixture = " + json.dumps(fixture) + ";")

ctx.eval((ROOT / "tests" / "dom-harness.js").read_text(encoding="utf-8"))
ctx.eval((ROOT / "app.js").read_text(encoding="utf-8"))
try:
    ctx.eval((ROOT / "tests" / "dom-tests.js").read_text(encoding="utf-8"))
except Exception as exc:  # noqa: BLE001
    print("JS error:", exc)
    sys.exit(1)

if not elements:
    print("no elements parsed from index.html")
    sys.exit(1)
print(f"fixture: {len(elements)} elements with ids, {len(selector_only)} selector-only")
