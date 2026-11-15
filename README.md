# Nomad Number Lab — AI cost · freelance rate · timezone overlap

An English, AdSense-ready static site with three calculators for location-independent
work. No framework, no build step, no network request after the page loads.

```text
index.html      three calculators + editorial guides + FAQ + 5 ad units
styles.css      one stylesheet, mobile-first, no web fonts
app.js          calculation engines (window.NOMAD) + the browser UI
about.html      methodology, sources, limits, disclaimer
privacy.html    privacy policy written for an AdSense site
sitemap.xml     3 URLs
robots.txt      allows Google + AdSense crawlers
og-image.png    1200×630 share card (tools/make_og.py renders it)
tests/          engine tests, DOM tests, structural smoke tests
```

Intended hosting: `https://sdn6517-cmd.github.io/global-nomad-calc/` (used by the
canonical tag, Open Graph tags, sitemap and robots). Change those four places if you host
somewhere else.

## The three calculators

1. **AI API & token cost** — 20 models from OpenAI, Anthropic and Google at their
   published list prices (checked 15 Nov 2026), priced for one prompt shape and a team's
   monthly volume, with an input-caching slider.
2. **Freelance hourly rate** — gross-up from a take-home target through tax and business
   cost rates, divided by genuinely billable hours: hourly, day, week, month, project quote.
3. **Timezone overlap** — 29 cities, working-hours window, 24-hour grid with per-hour
   daylight-saving rules, longest all-at-work window, day-shift markers.

Each tab stores its inputs in the query string, so any scenario can be bookmarked or sent
to a colleague.

## Run it locally

```bash
cd global-nomad-calc
python3 -m http.server 8000
# http://localhost:8000/
```

Opening `index.html` directly from disk also works; the page makes no requests.

## Tests

```bash
pip install quickjs          # once
python3 tests/run.py         # engine: token cost, rate gross-up, timezone rules
python3 tests/dom-run.py     # UI: boots the real page code against a minimal DOM
python3 tests/smoke.py       # HTML/CSS/SEO/links/ads/size structure
python3 tests/tz-crosscheck.py  # DST rules vs the IANA database, 2026-2027
```

Last run (2026-11-15):

| suite | result |
| --- | --- |
| `tests/run.py` | PASS 111 / FAIL 0 |
| `tests/dom-run.py` | PASS 31 / FAIL 0 |
| `tests/smoke.py` | PASS 127 / FAIL 0 |
| `tests/tz-crosscheck.py` | PASS 232,464 comparisons / 0 mismatches |

`tests/test.html` runs the engine suite in a browser for a quick visual check.

## Where the ad code goes

| slot | id | placement |
| --- | --- | --- |
| top | `#ad-slot-top` | under the hero |
| in-feed (tab 1) | `#ad-slot-infeed` | between results and guide |
| in-feed (tab 2) | `#ad-slot-infeed-rate` | between results and guide |
| in-feed (tab 3) | `#ad-slot-infeed-tz` | between results and guide |
| bottom | `#ad-slot-bottom` | above the footer |

Each `.ad-inner` currently holds a dashed placeholder. To go live:

1. In `index.html`, uncomment the AdSense loader in the `<head>` and replace
   `ca-pub-XXXXXXXXXXXXXXXX` with the real publisher id.
2. Paste the responsive `<ins class="adsbygoogle" …></ins>` unit into the matching
   `.ad-inner`, followed by `(adsbygoogle = window.adsbygoogle || []).push({});`.
3. Delete the `<span class="ad-placeholder">` line in that slot.
4. Only one panel is visible at a time, so at most three ad units are ever on screen.
5. Add `ads.txt` at the root once AdSense gives you the line to publish.

## Deploy (GitHub Pages)

```bash
cd global-nomad-calc
git init -b main
git add .
git commit -m "Nomad Number Lab: AI cost, freelance rate and timezone calculators"
gh repo create sdn6517-cmd/global-nomad-calc --public --source=. --remote=origin --push
gh api -X POST repos/sdn6517-cmd/global-nomad-calc/pages \
  -f build_type=legacy -f 'source[branch]=main' -f 'source[path]=/'
```

Then submit `https://sdn6517-cmd.github.io/global-nomad-calc/sitemap.xml` in Google Search
Console and apply for AdSense on the same property.

## Prices and sources

- OpenAI: <https://developers.openai.com/api/docs/pricing>
- Anthropic: <https://platform.claude.com/docs/en/about-claude/pricing>
- Google: <https://ai.google.dev/gemini-api/docs/pricing>

All prices are USD per 1M tokens, standard tier, short context, as published on
15 November 2026. Announced changes are noted in the model rows: Gemini 4 Argon rises to
$4/$20 on 1 Dec 2026, Gemini 3.8 Flash to $1.50/$7.50 on 1 Jan 2027, GPT-5 is deprecated
on 11 Dec 2026. Update `MODELS` in `app.js` when they move — one place, and the page,
the tests and the comparison table all follow.

## Notes

- Every figure is an estimate; the site says so in the footer, the about page and the FAQ.
- The calculators never send anything to a server. Inputs live in the URL only.
- British Columbia's move to permanent UTC−7 (from 1 Nov 2026) is encoded in the
  timezone data, along with US, EU, Australian and New Zealand daylight-saving rules.
