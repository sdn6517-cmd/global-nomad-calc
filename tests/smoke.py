#!/usr/bin/env python3
"""Structural smoke tests for the static site: files, links, ids, ads, SEO, size.

    python3 tests/smoke.py
"""
import json
import pathlib
import re
import sys
from html.parser import HTMLParser
from urllib.parse import urlparse
from xml.etree import ElementTree

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = "https://sdn6517-cmd.github.io/global-nomad-calc"

passes = 0
fails = []


def check(name, condition, detail=""):
    global passes
    if condition:
        passes += 1
    else:
        fails.append(name + ((" · " + str(detail)) if detail else ""))


def read(name):
    return (ROOT / name).read_text(encoding="utf-8")


index = read("index.html")
css = read("styles.css")
js = read("app.js")
privacy = read("privacy.html")
about = read("about.html")
robots = read("robots.txt")
sitemap = read("sitemap.xml")


class Doc(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids = []
        self.attrs = []
        self.stack = []
        self.text = []
        self.tags = []
        self.bad_nesting = []
        void = {"meta", "link", "br", "img", "input", "hr", "source", "area", "base", "col", "embed", "param", "track", "wbr"}

        self.void = void

    def handle_starttag(self, tag, attrs):
        self.tags.append(tag)
        d = dict(attrs)
        if "id" in d:
            self.ids.append(d["id"])
        self.attrs.append((tag, d))
        if tag not in self.void:
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.void and self.stack and self.stack[-1] == tag:
            self.stack.pop()

    def handle_endtag(self, tag):
        if tag in self.void:
            return
        if self.stack and self.stack[-1] == tag:
            self.stack.pop()
        elif tag in self.stack:
            while self.stack and self.stack[-1] != tag:
                self.bad_nesting.append(self.stack.pop())
            if self.stack:
                self.stack.pop()
        else:
            self.bad_nesting.append(tag)

    def handle_data(self, data):
        self.text.append(data)


doc = Doc()
doc.feed(index)
idx_ids = set(doc.ids)

# ---------------------------------------------------------------- files
for name in ["index.html", "styles.css", "app.js", "privacy.html", "about.html", "sitemap.xml", "robots.txt", "og-image.png", "README.md"]:
    check(f"file exists: {name}", (ROOT / name).is_file())

check("index.html is well nested", not doc.bad_nesting, doc.bad_nesting[:5])
check("index.html has no unclosed block tags", not doc.stack, doc.stack[:5])

# ---------------------------------------------------------------- head / SEO
title = re.search(r"<title>(.*?)</title>", index, re.S)
check("title present", bool(title))
check("title length 30-70", title and 30 <= len(title.group(1).strip()) <= 70, title and len(title.group(1).strip()))
desc = re.search(r'<meta name="description" content="(.*?)"', index, re.S)
check("meta description present", bool(desc))
check("description length 110-180", desc and 110 <= len(desc.group(1)) <= 185, desc and len(desc.group(1)))
check("canonical points at the site root", f'<link rel="canonical" href="{SITE}/"' in index)
check("og:title present", 'property="og:title"' in index)
check("og:description present", 'property="og:description"' in index)
check("og:image present", 'property="og:image"' in index)
check("twitter card present", 'name="twitter:card"' in index)
check("viewport meta present", 'name="viewport"' in index)
check("lang is en", '<html lang="en">' in index)
check("robots meta allows indexing", 'name="robots" content="index, follow' in index)
check("single h1", len(re.findall(r"<h1[ >]", index)) == 1, len(re.findall(r"<h1[ >]", index)))
check("five or more h2 sections", len(re.findall(r"<h2[ >]", index)) >= 5, len(re.findall(r"<h2[ >]", index)))
check("favicon declared", 'rel="icon"' in index)
check("theme-color declared", 'name="theme-color"' in index)

# JSON-LD
ld_blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', index, re.S)
check("JSON-LD present", len(ld_blocks) == 1, len(ld_blocks))
graph = {}
if ld_blocks:
    try:
        graph = json.loads(ld_blocks[0])
    except json.JSONDecodeError as exc:
        fails.append(f"JSON-LD parses · {exc}")
types = [n.get("@type") for n in graph.get("@graph", [])]
check("JSON-LD declares WebApplication", "WebApplication" in types, types)
check("JSON-LD declares FAQPage", "FAQPage" in types, types)
faq_ld = [n for n in graph.get("@graph", []) if n.get("@type") == "FAQPage"]
check("JSON-LD has 5+ questions", faq_ld and len(faq_ld[0]["mainEntity"]) >= 5,
      faq_ld and len(faq_ld[0]["mainEntity"]))
check("visible FAQ blocks match JSON-LD count",
      len(re.findall(r"<details>", index)) >= (len(faq_ld[0]["mainEntity"]) if faq_ld else 0),
      len(re.findall(r"<details>", index)))

# ---------------------------------------------------------------- ad slots
for slot in ["ad-slot-top", "ad-slot-infeed", "ad-slot-bottom"]:
    check(f"ad slot {slot} exists once", index.count(f'id="{slot}"') == 1, index.count(f'id="{slot}"'))
check("five advertisement labels (top, one per tab, bottom)", index.count('class="ad-label"') == 5, index.count('class="ad-label"'))
check("each ad unit has an inner container", index.count('class="ad-inner"') == index.count('class="ad-label"'), index.count('class="ad-inner"'))
for extra in ["ad-slot-infeed-rate", "ad-slot-infeed-tz"]:
    check(f"per-tab ad slot {extra} exists once", index.count(f'id="{extra}"') == 1)
check("AdSense instructions left in comments", index.count("AdSense:") >= 3)

# ---------------------------------------------------------------- assets
check("stylesheet linked", '<link rel="stylesheet" href="styles.css"' in index)
check("app.js loaded once, deferred", index.count('src="app.js"') == 1 and '<script src="app.js" defer>' in index)
check("no external stylesheet", not re.search(r'<link[^>]+rel="stylesheet"[^>]+href="https?://', index))
check("no external script", not re.search(r'<script[^>]+src="https?://', index))
check("no external font", "@import" not in css and "fonts.googleapis" not in css)
check("no external images", not re.search(r'<img[^>]+src="https?://', index))
check("styles.css is not empty", len(css) > 4000, len(css))
check("app.js is not empty", len(js) > 20000, len(js))

# ---------------------------------------------------------------- ids used by JS
js_ids = set(re.findall(r"\$\('#([a-zA-Z0-9_-]+)'\)", js))
missing = sorted(i for i in js_ids if i not in idx_ids)
check("every id app.js looks up exists in index.html", not missing, missing)

js_classes = set(re.findall(r"\$\$\('\.([a-zA-Z0-9_-]+)'\)", js))
missing_cls = sorted(c for c in js_classes if f'class="{c}"' not in index and f"{c} " not in index)
check("every class app.js queries exists in index.html", not missing_cls, missing_cls)

# tab wiring
tab_targets = re.findall(r'role="tab"[^>]*data-tab="([a-z]+)"', index)
check("three tabs", len(tab_targets) == 3, tab_targets)
for t in tab_targets:
    check(f"panel for tab '{t}' exists", f'id="panel-{t}"' in index)
    check(f"tab '{t}' controls its panel", f'aria-controls="panel-{t}"' in index)
check("two panels start hidden", index.count(" hidden>") == 2, index.count(" hidden>"))
check("tablist labelled", 'role="tablist" aria-label="Calculators"' in index)

# timezone selects
check("five member city slots", index.count('class="tz-member"') == 5, index.count('class="tz-member"'))

# ---------------------------------------------------------------- internal links & anchors
hrefs = re.findall(r'href="([^"]+)"', index + about + privacy)
local_files = set()
anchors = set(re.findall(r'id="([^"]+)"', index + about + privacy))
for href in hrefs:
    if href.startswith(("http://", "https://", "mailto:", "data:")):
        continue
    if href.startswith("#"):
        check(f"anchor {href} resolves", href[1:] in anchors)
        continue
    path, _, frag = href.partition("#")
    if path:
        target = (ROOT / path)
        check(f"link target exists: {path}", target.is_file())
        local_files.add(path)
    if frag:
        check(f"anchor {href} resolves", frag in anchors)

check("footer links to privacy", 'href="privacy.html"' in index)
check("footer links to about", 'href="about.html"' in index)
check("about links back to the calculators", 'href="index.html' in about)
check("privacy links back to the calculators", 'href="index.html' in privacy)

# ---------------------------------------------------------------- sitemap / robots
try:
    tree = ElementTree.fromstring(sitemap)
    ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    urls = [u.findtext("s:loc", namespaces=ns) for u in tree.findall("s:url", ns)]
    check("sitemap has 3 urls", len(urls) == 3, urls)
    check("sitemap urls live on the canonical host", all(u and u.startswith(SITE) for u in urls), urls)
    check("sitemap has lastmod", all(u.find("s:lastmod", ns) is not None for u in tree.findall("s:url", ns)))
    for u in urls or []:
        rel = u[len(SITE):].lstrip("/") or "index.html"
        target = ROOT / (rel if rel != "" else "index.html")
        check(f"sitemap url file exists: {rel or 'index.html'}", target.is_file())
except ElementTree.ParseError as exc:
    fails.append(f"sitemap parses · {exc}")

check("robots has Sitemap line", "Sitemap: " + SITE + "/sitemap.xml" in robots)
check("robots allows everything", "User-agent: *" in robots and "Disallow:" in robots)
check("robots allows AdSense crawler", "Mediapartners-Google" in robots)

# ---------------------------------------------------------------- content depth
text = re.sub(r"<script.*?</script>", " ", index, flags=re.S)
text = re.sub(r"<style.*?</style>", " ", text, flags=re.S)
text = re.sub(r"<[^>]+>", " ", text)
words = re.findall(r"[A-Za-z][A-Za-z'’-]+", text)
check("index has 1,200+ English words", len(words) >= 1200, len(words))
check("no lorem ipsum", "lorem ipsum" not in index.lower())
check("no TODO markers in shipped html", "TODO" not in index)
check("no console.log left in app.js", "console.log(" not in js, js.count("console.log("))
check("no debugger statement", "debugger" not in js)

# privacy / about content
for phrase in ["cookie", "AdSense", "third-party", "opt out", "GDPR", "CCPA"]:
    check(f"privacy mentions {phrase}", phrase.lower() in privacy.lower())
for phrase in ["list price", "formula", "daylight", "not financial advice"]:
    check(f"about mentions {phrase}", phrase.lower() in about.lower())
check("about lists the three vendors", all(v in about for v in ["OpenAI", "Anthropic", "Google"]))
check("about carries the price check date", "15 November 2026" in about)

# ---------------------------------------------------------------- size budget
kb = lambda s: len(s.encode("utf-8")) / 1024  # noqa: E731
kb_bytes = lambda b: len(b) / 1024  # noqa: E731
css_classes = set(re.findall(r"\.([a-zA-Z][\w-]*)", css))
unstyled = []
for name in ["index.html", "about.html", "privacy.html"]:
    body = read(name)
    for cls_attr in re.findall(r'class="([^"]+)"', body):
        for c in cls_attr.split():
            if c in {"adsbygoogle", "js-loading"}:
                continue
            if c not in css_classes and c not in unstyled:
                unstyled.append(c)
check("index.html under 45 KB", kb(index) < 45, round(kb(index), 1))
check("styles.css under 25 KB", kb(css) < 25, round(kb(css), 1))
check("app.js under 45 KB", kb(js) < 45, round(kb(js), 1))
check("og image is under 300 KB", kb_bytes((ROOT / "og-image.png").read_bytes()) < 300,
      round(kb_bytes((ROOT / "og-image.png").read_bytes()), 1))
check("every class used in the HTML is styled", not unstyled, unstyled)
check("total page weight under 120 KB", kb(index) + kb(css) + kb(js) < 120,
      round(kb(index) + kb(css) + kb(js), 1))

# css sanity
check("css braces balanced", css.count("{") == css.count("}"), (css.count("{"), css.count("}")))
check("css has mobile breakpoint", "@media (max-width: 720px)" in css)
check("css hides panels with [hidden]", "[role=\"tabpanel\"]" in css or "hidden" in css)

# ---------------------------------------------------------------- report
print(f"checks: {passes + len(fails)}")
if fails:
    for f in fails:
        print("FAIL ·", f)
print(f"=== SMOKE: PASS {passes} / FAIL {len(fails)} ===")
sys.exit(1 if fails else 0)
