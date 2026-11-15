/* Engine verification for Nomad Number Lab.
   Runs in QuickJS (python3 tests/run.py), Node, or the browser (tests/test.html).
   Every assertion is independent of the DOM. */
(function () {
  var log = (typeof console !== 'undefined' && console.log) ? console.log : print;
  var N = (typeof window !== 'undefined' ? window : globalThis).NOMAD;
  if (!N) {
    log('FAIL: NOMAD engine not found. Load app.js first.');
    return;
  }

  var pass = 0, fail = 0, failures = [];

  function near(a, b, tol) {
    if (typeof a !== 'number' || typeof b !== 'number') return false;
    var scale = Math.max(1, Math.abs(b));
    return Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol) * scale;
  }

  function check(name, actual, expected, tol) {
    var ok;
    if (typeof expected === 'number' && typeof actual === 'number') ok = near(actual, expected, tol);
    else if (Array.isArray(expected)) ok = JSON.stringify(actual) === JSON.stringify(expected);
    else ok = actual === expected;
    if (ok) pass++;
    else { fail++; failures.push(name + ' → expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual)); }
    return ok;
  }

  function ok(name, condition) {
    if (condition) pass++;
    else { fail++; failures.push(name); }
  }

  function section(title) { log('\n— ' + title + ' —'); }

  var M = function (id) {
    for (var i = 0; i < N.MODELS.length; i++) if (N.MODELS[i].id === id) return N.MODELS[i];
    throw new Error('model missing: ' + id);
  };

  /* ================================================================= *
   * 1. Prompt-level token cost
   * ================================================================= */
  section('Prompt cost');

  var sonnet = M('sonnet-5.5');   // $2 in / $10 out
  check('Sonnet 5.5 · 1,000 in + 500 out = $0.007',
    N.promptCost(sonnet, 1000, 500, 0), 0.007, 1e-9);
  check('Sonnet 5.5 · 1M input tokens = $2',
    N.promptCost(sonnet, 1000000, 0, 0), 2, 1e-9);
  check('Sonnet 5.5 · 1M output tokens = $10',
    N.promptCost(sonnet, 0, 1000000, 0), 10, 1e-9);
  check('Fully cached input costs the cache-read price',
    N.promptCost(sonnet, 1000000, 0, 1), 0.1, 1e-9);
  check('50% cached 1,000 in + 500 out = $0.00605',
    N.promptCost(sonnet, 1000, 500, 0.5), 0.00605, 1e-9);
  ok('Caching never raises the price',
    N.promptCost(sonnet, 1500, 500, 0.9) < N.promptCost(sonnet, 1500, 500, 0));
  check('Zero tokens cost nothing', N.promptCost(sonnet, 0, 0, 0), 0);
  check('Negative tokens clamp to zero', N.promptCost(sonnet, -500, -500, 0), 0);
  check('Cache share above 100% clamps to 1',
    N.promptCost(sonnet, 1000000, 0, 3), 0.1, 1e-9);

  var astra = M('gpt-6-astra');   // $10 in / $50 out
  check('GPT-6 Astra · 1M in + 1M out = $60', N.promptCost(astra, 1e6, 1e6, 0), 60, 1e-9);
  check('Output costs 5× input on Astra',
    N.promptCost(astra, 0, 1e6, 0) / N.promptCost(astra, 1e6, 0, 0), 5, 1e-9);

  /* Every catalogue entry is internally consistent */
  var badModel = null;
  N.MODELS.forEach(function (m) {
    if (!(m.in >= 0) || !(m.out >= 0)) badModel = m.id;
    if (m.cached !== undefined && m.cached !== null && m.cached > m.in) badModel = m.id + ' (cache dearer than input)';
  });
  check('All models have sane prices', badModel, null);
  ok('Catalogue covers OpenAI, Anthropic and Google', (function () {
    var v = {};
    N.MODELS.forEach(function (m) { v[m.vendor] = true; });
    return v.OpenAI && v.Anthropic && v.Google;
  })());

  /* ================================================================= *
   * 2. Team / monthly projection
   * ================================================================= */
  section('Team cost projection');

  var t = N.tokenCost({ inTok: 1500, outTok: 500, promptsPerDay: 30, teamSize: 5, daysPerMonth: 22, cachedShare: 0 });
  check('Row per model', t.rows.length, N.MODELS.length);
  check('Prompts per month = 30 × 22 × 5', t.promptsMonth, 3300);
  check('Tokens per prompt = 2,000', t.tokensPerPrompt, 2000);
  check('Cheapest is the smallest team cost', t.cheapest.teamMonth, Math.min.apply(null, t.rows.map(function (r) { return r.teamMonth; })), 1e-9);
  check('Dearest is the largest team cost', t.dearest.teamMonth, Math.max.apply(null, t.rows.map(function (r) { return r.teamMonth; })), 1e-9);

  var sonnetRow = null, astraRow = null;
  t.rows.forEach(function (r) { if (r.id === 'sonnet-5.5') sonnetRow = r; if (r.id === 'gpt-6-astra') astraRow = r; });
  check('Sonnet per-prompt at 1,500/500 = $0.008',
    sonnetRow.perPrompt, 0.008, 1e-9);
  check('Sonnet team month = 0.008 × 30 × 22 × 5',
    sonnetRow.teamMonth, 0.008 * 30 * 22 * 5, 1e-9);
  check('Sonnet annual = 12 × monthly', sonnetRow.teamYear, sonnetRow.teamMonth * 12, 1e-9);
  check('Astra per-prompt at 1,500/500 = $0.04',
    astraRow.perPrompt, 0.04, 1e-9);
  check('Astra team month = 0.04 × 30 × 22 × 5',
    astraRow.teamMonth, 0.04 * 30 * 22 * 5, 1e-9);
  check('Spread = dearest ÷ cheapest', t.spread, t.dearest.teamMonth / t.cheapest.teamMonth, 1e-9);
  check('vs cheapest ratio of cheapest is 1', t.cheapest.vsCheapest, 1, 1e-9);
  check('per1kPrompts = 1,000 prompts', sonnetRow.per1kPrompts, 0.008 * 1000, 1e-9);
  check('Sorting is ascending by team cost',
    JSON.stringify(t.sorted.map(function (r) { return r.id; })),
    JSON.stringify(t.rows.slice().sort(function (a, b) { return a.teamMonth - b.teamMonth; }).map(function (r) { return r.id; })));

  var zero = N.tokenCost({ inTok: 0, outTok: 0, promptsPerDay: 30, teamSize: 5, daysPerMonth: 22 });
  check('Empty prompts cost nothing', zero.cheapest.teamMonth, 0);
  check('Zero-cost workload reports spread 0', zero.spread, 0);

  var cached = N.tokenCost({ inTok: 1500, outTok: 500, promptsPerDay: 30, teamSize: 5, daysPerMonth: 22, cachedShare: 0.8 });
  ok('80% caching lowers the team bill', cached.cheapest.teamMonth < t.cheapest.teamMonth);
  var capped = N.tokenCost({ inTok: 1500, outTok: 500, promptsPerDay: 30, teamSize: 5, daysPerMonth: 22, cachedShare: 5 });
  check('Cache share is clamped to 95%', capped.input.cachedShare, 0.95);

  /* The worked example on the landing page: 90,000 prompts a month */
  var saas = N.tokenCost({ inTok: 1500, outTok: 500, promptsPerDay: 3, teamSize: 1000, daysPerMonth: 30 });
  var saasAstra = null, saasSonnet = null, saasFlash = null;
  saas.rows.forEach(function (row) {
    if (row.id === 'gpt-6-astra') saasAstra = row;
    if (row.id === 'sonnet-5.5') saasSonnet = row;
    if (row.id === 'gemini-3.8-flash') saasFlash = row;
  });
  check('Editorial example: 90,000 prompts a month on Astra = $3,600',
    saasAstra.teamMonth, 3600, 1e-6);
  check('Editorial example: same workload on Sonnet 5.5 = $720',
    saasSonnet.teamMonth, 720, 1e-6);
  check('Editorial example: same workload on Gemini 3.8 Flash = $270',
    saasFlash.teamMonth, 270, 1e-6);
  check('Editorial example: 13× spread', saasAstra.teamMonth / saasFlash.teamMonth, 3600 / 270, 1e-9);

  /* ================================================================= *
   * 3. Freelance rate
   * ================================================================= */
  section('Freelance rate');

  var r = N.rateCalc({ target: 90000, taxRate: 25, buffer: 10, hoursPerWeek: 25, weeksOff: 4, hoursPerDay: 8, projectHours: 40 });
  check('Billable hours = 25 × 48', r.billableHours, 1200);
  check('Gross needed for $90k take-home at 25% = $120,000', r.gross, 120000, 1e-9);
  check('Revenue = gross ÷ 0.9 = $133,333', r.revenue, 120000 / 0.9, 1e-9);
  check('Hourly = revenue ÷ 1,200 = $111.11', r.hourly, 120000 / 0.9 / 1200, 1e-9);
  check('Day rate = hourly × 8', r.dayRate, r.hourly * 8, 1e-9);
  check('Week rate = hourly × 25', r.weekRate, r.hourly * 25, 1e-9);
  check('Month rate = revenue ÷ 12', r.monthRate, r.revenue / 12, 1e-9);
  check('40-hour project quote', r.projectQuote, r.hourly * 40, 1e-9);
  check('Take-home per billable hour = 90,000 ÷ 1,200', r.effectiveHourly, 75, 1e-9);
  check('Taxes = gross − target', r.taxes, 30000, 1e-9);
  check('Overhead = revenue − gross', r.overhead, r.revenue - r.gross, 1e-9);
  check('Tax + overhead share of revenue', r.overheadRate, (r.revenue - 90000) / r.revenue, 1e-9);

  /* Round trip: charging hourly for every billable hour yields the revenue */
  check('Hourly × billable hours = revenue', r.hourly * r.billableHours, r.revenue, 1e-9);
  /* Round trip: that revenue, taxed and buffered, gets you back to the target */
  check('Revenue → take-home returns the target',
    r.revenue * (1 - 0.1) * (1 - 0.25), 90000, 1e-6);

  var lowTax = N.rateCalc({ target: 90000, taxRate: 0, buffer: 0, hoursPerWeek: 25, weeksOff: 4 });
  check('No tax, no overhead: hourly = target ÷ hours', lowTax.hourly, 75, 1e-9);
  ok('Taxes raise the rate', r.hourly > lowTax.hourly);

  var moreHours = N.rateCalc({ target: 90000, taxRate: 25, buffer: 10, hoursPerWeek: 40, weeksOff: 4 });
  ok('More billable hours lower the rate', moreHours.hourly < r.hourly);
  check('40-hour week needs 1,920 hours', moreHours.billableHours, 1920);

  check('No billable hours is an error', N.rateCalc({ target: 90000, hoursPerWeek: 0 }).ok, false);
  check('Zero target is an error', N.rateCalc({ target: 0, hoursPerWeek: 25 }).ok, false);
  check('52 weeks off is an error', N.rateCalc({ target: 90000, hoursPerWeek: 25, weeksOff: 52 }).ok, false);
  var extremeTax = N.rateCalc({ target: 100000, taxRate: 120, hoursPerWeek: 25 });
  ok('Tax above 95% is clamped, not infinite', isFinite(extremeTax.hourly));

  /* ================================================================= *
   * 4. Timezones
   * ================================================================= */
  section('Timezone offsets');

  function offAt(cityId, iso, hourUTC) {
    var parts = iso.split('-');
    var ms = Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), hourUTC || 0);
    return N.offsetHours(N.cityById(cityId), ms);
  }

  check('Seoul is +9 in January', offAt('seoul', '2026-01-15'), 9);
  check('Seoul is +9 in July', offAt('seoul', '2026-07-15'), 9);
  check('Tokyo is +9 all year', offAt('tokyo', '2026-07-15'), 9);
  check('Singapore is +8 all year', offAt('singapore', '2026-07-15'), 8);
  check('Bali is +8 all year', offAt('bali', '2026-01-15'), 8);
  check('New York is −5 in January', offAt('newyork', '2026-01-15'), -5);
  check('New York is −4 in July', offAt('newyork', '2026-07-15'), -4);
  check('London is 0 in January', offAt('london', '2026-01-15'), 0);
  check('London is +1 in July', offAt('london', '2026-07-15'), 1);
  check('Berlin is +1 in January', offAt('berlin', '2026-01-15'), 1);
  check('Berlin is +2 in July', offAt('berlin', '2026-07-15'), 2);
  check('Sydney is +11 in January', offAt('sydney', '2026-01-15'), 11);
  check('Sydney is +10 in July', offAt('sydney', '2026-07-15'), 10);
  check('Auckland is +13 in January', offAt('auckland', '2026-01-15'), 13);
  check('Auckland is +12 in July', offAt('auckland', '2026-07-15'), 12);
  check('São Paulo never shifts', offAt('saopaulo', '2026-01-15'), -3);
  check('Bengaluru is +5:30', offAt('bangalore', '2026-07-15'), 5.5);
  check('Mexico City dropped DST', offAt('mexicocity', '2026-07-15'), -6);
  check('Istanbul stays +3', offAt('istanbul', '2026-07-15'), 3);

  /* US switch: 2026-03-08 02:00 EST = 07:00 UTC; 2026-11-01 02:00 EDT = 06:00 UTC */
  check('New York still −5 at 06:59 UTC on 8 Mar 2026', offAt('newyork', '2026-03-08', 6) + (59 / 60) * 0, -5);
  check('New York −4 from 07:00 UTC on 8 Mar 2026',
    N.offsetHours(N.cityById('newyork'), Date.UTC(2026, 2, 8, 7, 0)), -4);
  check('New York −4 one second before the November switch',
    N.offsetHours(N.cityById('newyork'), Date.UTC(2026, 10, 1, 5, 59)), -4);
  check('New York −5 from 06:00 UTC on 1 Nov 2026',
    N.offsetHours(N.cityById('newyork'), Date.UTC(2026, 10, 1, 6, 0)), -5);

  /* EU switch: last Sunday of March / October at 01:00 UTC */
  check('London 0 at 00:59 UTC on 29 Mar 2026',
    N.offsetHours(N.cityById('london'), Date.UTC(2026, 2, 29, 0, 59)), 0);
  check('London +1 at 01:00 UTC on 29 Mar 2026',
    N.offsetHours(N.cityById('london'), Date.UTC(2026, 2, 29, 1, 0)), 1);
  check('London +1 at 00:59 UTC on 25 Oct 2026',
    N.offsetHours(N.cityById('london'), Date.UTC(2026, 9, 25, 0, 59)), 1);
  check('London 0 at 01:00 UTC on 25 Oct 2026',
    N.offsetHours(N.cityById('london'), Date.UTC(2026, 9, 25, 1, 0)), 0);

  section('Local conversion');

  var seoul = N.cityById('seoul');
  var noonSeoul = N.instantFromLocal(seoul, 2026, 10, 15, 12);
  check('Seoul noon is 03:00 UTC', new Date(noonSeoul).getUTCHours(), 3);
  var bangaloreNoon = N.localParts(noonSeoul, N.offsetHours(N.cityById('bangalore'), noonSeoul));
  check('Seoul noon is 08:30 in Bengaluru', bangaloreNoon.hh + ':' + bangaloreNoon.mm, '8:30');

  var roundTripOk = true;
  N.CITIES.forEach(function (c) {
    var inst = N.instantFromLocal(c, 2026, 6, 10, 12);
    var p = N.localParts(inst, N.offsetHours(c, inst));
    if (p.hh !== 12) roundTripOk = false;
  });
  ok('Local noon round-trips in every city', roundTripOk);

  section('Overlap grid');

  var sameZone = N.overlap({ home: 'seoul', members: ['tokyo'], date: '2026-11-15', start: 9, end: 18 });
  check('24 rows', sameZone.rows.length, 24);
  check('Nine hours of overlap for Seoul + Tokyo', sameZone.overlapHours, 9);
  check('Single window', sameZone.windows.length, 1);
  check('Best window is 09:00–18:00', sameZone.best.from + '-' + sameZone.best.to, '9-18');

  var sfo = N.overlap({ home: 'seoul', members: ['losangeles'], date: '2026-11-15', start: 9, end: 18 });
  check('Seoul + Los Angeles overlap for 2 hours (16:00–18:00 in LA)', sfo.overlapHours, 2);
  check('One window only', sfo.windows.length, 1);
  check('Seoul 09:00 is the previous day in Los Angeles', sfo.rows[9].cells[1].dayDelta, -1);
  check('Seoul 09:00 is 16:00 in Los Angeles', sfo.rows[9].cells[1].hour, 16);

  var three = N.overlap({ home: 'seoul', members: ['tokyo', 'singapore', 'bali'], date: '2026-11-15', start: 9, end: 18 });
  check('Seoul + Tokyo + Singapore + Bali overlap 8 hours', three.overlapHours, 8);
  check('Member count', three.members.length, 3);

  var allDay = N.overlap({ home: 'seoul', members: ['tokyo'], date: '2026-11-15', start: 0, end: 24 });
  check('Full-day window is 24 hours', allDay.overlapHours, 24);
  check('Full-day window is one merged block', allDay.windows.length, 1);
  check('Full-day window is flagged as wrapping', allDay.windows[0].wraps, true);

  var dup = N.overlap({ home: 'seoul', members: ['seoul', 'seoul', 'tokyo', 'tokyo'], date: '2026-11-15', start: 9, end: 18 });
  check('Home and duplicate cities are dropped', dup.members.length, 1);

  var many = N.overlap({ home: 'seoul', members: ['tokyo', 'singapore', 'bali', 'bangkok', 'london', 'berlin', 'paris'], date: '2026-11-15', start: 9, end: 18 });
  check('Member list is capped at five', many.members.length, 5);

  var badDate = N.overlap({ home: 'seoul', members: ['tokyo'], date: '2026-02-30', start: 9, end: 18 });
  check('Impossible date is rejected', badDate.ok, false);

  var inverted = N.overlap({ home: 'seoul', members: ['tokyo'], date: '2026-11-15', start: 18, end: 9 });
  ok('Inverted working hours are repaired, not crashed', inverted.ok && inverted.end > inverted.start);

  var dstDate = N.overlap({ home: 'seoul', members: ['newyork'], date: '2026-03-08', start: 9, end: 18 });
  var dstFlagged = dstDate.rows.some(function (row) {
    return row.cells.some(function (c) { return c.dstShift !== 0; });
  });
  ok('A daylight-saving change is flagged in the grid', dstFlagged);

  var winter = N.overlap({ home: 'seoul', members: ['london'], date: '2026-01-15', start: 9, end: 18 });
  var summer = N.overlap({ home: 'seoul', members: ['london'], date: '2026-07-15', start: 9, end: 18 });
  check('London at noon in January', N.localParts(winter.rows[12].utcMs, N.offsetHours(N.cityById('london'), winter.rows[12].utcMs)).hh, 3);
  check('London at noon in July', N.localParts(summer.rows[12].utcMs, N.offsetHours(N.cityById('london'), summer.rows[12].utcMs)).hh, 4);

  check('Offset label Seoul→New York', N.offsetLabel(N.cityById('newyork'), seoul, noonSeoul), '-14');
  check('Offset label Seoul→Tokyo', N.offsetLabel(N.cityById('tokyo'), seoul, noonSeoul), '0');
  check('Offset label Seoul→Bengaluru', N.offsetLabel(N.cityById('bangalore'), seoul, noonSeoul), '-3:30');

  check('isoDate pads months and days', N.isoDate(2026, 0, 5), '2026-01-05');

  /* ================================================================= *
   * Summary
   * ================================================================= */
  log('');
  if (failures.length) {
    failures.forEach(function (f) { log('FAIL · ' + f); });
  }
  log('=== RESULT: PASS ' + pass + ' / FAIL ' + fail + ' (total ' + (pass + fail) + ') ===');
  if (typeof print === 'function' && typeof console === 'undefined') {
    print('SUMMARY ' + pass + ' ' + fail);
  }
})();
