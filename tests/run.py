#!/usr/bin/env python3
"""Run the engine tests in QuickJS (no browser, no Node needed).

    python3 tests/run.py
"""
import pathlib
import re
import sys

try:
    import quickjs
except ImportError:
    sys.exit("quickjs is required: pip install quickjs")

ROOT = pathlib.Path(__file__).resolve().parent.parent
app = (ROOT / "app.js").read_text(encoding="utf-8")
tests = (ROOT / "tests" / "run-tests.js").read_text(encoding="utf-8")

ctx = quickjs.Context()
ctx.add_callable("__log", lambda s: print(s))
ctx.eval("globalThis.console = { log: function (s) { __log(String(s)); } };")
ctx.eval(app)
try:
    ctx.eval(tests)
except Exception as exc:  # noqa: BLE001
    print("JS error:", exc)
    sys.exit(1)
