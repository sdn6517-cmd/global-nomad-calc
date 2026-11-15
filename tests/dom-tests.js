/* UI assertions: exercises the same code the browser runs (init → render → events).
   Loaded after tests/dom-harness.js and app.js by tests/dom-run.py. */
(function () {
  var pass = 0, fail = 0, failures = [];

  function ok(name, cond) {
    if (cond) pass++;
    else { fail++; failures.push(name); }
  }
  function eq(name, actual, expected) {
    if (String(actual) === String(expected)) pass++;
    else { fail++; failures.push(name + ' → expected ' + expected + ', got ' + actual); }
  }
  function q(id) { return document.querySelector('#' + id); }
  function html(id) { var n = q(id); return n ? (n.innerHTML || n.textContent || '') : ''; }
  function count(haystack, needle) { return String(haystack).split(needle).length - 1; }

  var N = window.NOMAD;
  ok('engine attached to window', !!N);

  /* boot() already ran while app.js was evaluated */
  ok('loading class removed after boot', !document.body.classList.contains('js-loading'));

  /* ---------------- tab 1 ---------------- */
  var headline = html('ai-headline');
  ok('AI headline rendered', headline.indexOf('Cheapest on these numbers') !== -1);
  ok('AI headline carries a dollar figure', headline.indexOf('$') !== -1);
  eq('AI table has one row per model', q('ai-table').querySelector('tbody').children.length, N.MODELS.length);
  eq('spread line filled', html('ai-spread').indexOf('a month') !== -1, true);
  eq('cache label rendered', html('ai-cache-label'), '0% of input read from cache');
  ok('tokens-per-prompt note rendered', html('ai-tokens').indexOf('2,000 tokens') !== -1);

  var best = q('ai-table').querySelector('tbody').children.filter(function (row) {
    return row.className === 'is-best';
  });
  eq('exactly one best row is marked', best.length, 1);

  /* vendor filter */
  var googleBtn = document.querySelectorAll('[data-vendor]').filter(function (b) {
    return b.getAttribute('data-vendor') === 'Google';
  })[0];
  ok('Google filter button exists', !!googleBtn);
  googleBtn.fire('click');
  var googleModels = N.MODELS.filter(function (m) { return m.vendor === 'Google'; }).length;
  eq('filtering to Google shows only Google models', q('ai-table').querySelector('tbody').children.length, googleModels);
  var allBtn = document.querySelectorAll('[data-vendor]').filter(function (b) {
    return b.getAttribute('data-vendor') === 'all';
  })[0];
  allBtn.fire('click');
  eq('clearing the filter restores every model', q('ai-table').querySelector('tbody').children.length, N.MODELS.length);

  /* changing an input re-renders */
  var before = html('ai-headline');
  q('ai-team').value = '50';
  q('ai-team').fire('input');
  ok('headline cost changes when seats change', html('ai-headline') !== before);
  q('ai-team').value = '5';
  q('ai-team').fire('input');

  /* ---------------- tab 2 ---------------- */
  var rate = html('rate-result');
  ok('rate result rendered', rate.indexOf('Quote this hourly rate') !== -1);
  ok('hourly number present', /\$\d/.test(rate));
  ok('eight stat cards rendered', count(rate, 'class="stat"') === 8);
  ok('hours note rendered', html('rate-hours-note').indexOf('1,200 billable hours') !== -1);

  q('rate-target').value = '180000';
  q('rate-target').fire('input');
  ok('doubling the target doubles the rate', html('rate-result').indexOf('$222') !== -1);
  q('rate-target').value = '90000';
  q('rate-target').fire('input');

  q('rate-hours').value = '0';
  q('rate-hours').fire('input');
  ok('zero billable hours shows an error, not a crash', html('rate-result').indexOf('class="error"') !== -1);
  q('rate-hours').value = '25';
  q('rate-hours').fire('input');

  /* ---------------- tab 3 ---------------- */
  var tz = html('tz-result');
  ok('timezone result rendered', tz.indexOf('Longest window') !== -1 || tz.indexOf('No overlap') !== -1);
  eq('grid has 24 body rows', count(tz, '<tr'), 25); // 24 hours + header row
  ok('five member selects exist', document.querySelectorAll('.tz-member').length === 5);
  ok('home city defaults to Seoul', q('tz-home').value === 'seoul');
  ok('three cities are pre-selected', document.querySelectorAll('.tz-member').filter(function (s) { return s.value; }).length === 3);
  ok('city facts list rendered', tz.indexOf('city-facts') !== -1);

  /* moving a team city updates the grid */
  var first = document.querySelectorAll('.tz-member')[0];
  first.value = 'newyork';
  first.fire('change');
  ok('grid re-renders for a new city', html('tz-result').indexOf('New York') !== -1);

  /* ---------------- tabs ---------------- */
  var rateTab = document.querySelectorAll('[role="tab"]').filter(function (b) { return b.getAttribute('data-tab') === 'rate'; })[0];
  rateTab.fire('click');
  eq('rate tab shows its panel', q('panel-rate').hidden, false);
  eq('ai panel hides', q('panel-ai').hidden, true);
  eq('active tab is marked', rateTab.getAttribute('aria-selected'), 'true');

  var tzTab = document.querySelectorAll('[role="tab"]').filter(function (b) { return b.getAttribute('data-tab') === 'tz'; })[0];
  tzTab.fire('click');
  eq('tz tab shows its panel', q('panel-tz').hidden, false);
  eq('rate panel hides again', q('panel-rate').hidden, true);

  /* ---------------- summary ---------------- */
  if (failures.length) failures.forEach(function (f) { console.log('FAIL · ' + f); });
  console.log('=== DOM: PASS ' + pass + ' / FAIL ' + fail + ' (total ' + (pass + fail) + ') ===');
  if (fail > 0) throw new Error('DOM tests failed');
})();
