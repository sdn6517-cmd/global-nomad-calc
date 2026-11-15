/*!
 * Nomad Number Lab — AI API cost / freelance rate / timezone overlap engines
 * Price data checked 2026-11-15 (provider list prices, USD per 1M tokens).
 *
 * Every calculation is a pure function on the NOMAD object, so the whole
 * engine can be tested without a browser (tests/run-tests.js).
 */
(function (global) {
  'use strict';

  /* ================================================================== *
   * 0. Price data
   * ================================================================== */

  /* USD per 1M tokens. `cached` = cached-input read price where the vendor
     publishes one. `note` carries the caveat that changes the real bill. */
  var MODELS = [
    /* OpenAI — https://developers.openai.com/api/docs/pricing */
    { id: 'gpt-6-astra', vendor: 'OpenAI', name: 'GPT-6 Astra', in: 10, out: 50, cached: 1, note: 'Context above 272K tokens bills at 2× input and 1.5× output.' },
    { id: 'gpt-6.1-sol', vendor: 'OpenAI', name: 'GPT-6.1 Sol', in: 2, out: 10, cached: 0.1 },
    { id: 'gpt-5.2', vendor: 'OpenAI', name: 'GPT-5.2', in: 1.75, out: 14, cached: 0.175 },
    { id: 'gpt-5.2-pro', vendor: 'OpenAI', name: 'GPT-5.2 pro', in: 21, out: 168 },
    { id: 'gpt-5.1', vendor: 'OpenAI', name: 'GPT-5.1', in: 1.25, out: 10, cached: 0.125 },
    { id: 'gpt-5', vendor: 'OpenAI', name: 'GPT-5', in: 1.25, out: 10, cached: 0.125, note: 'Deprecated 11 Dec 2026 — plan a migration.' },
    { id: 'gpt-5-mini', vendor: 'OpenAI', name: 'GPT-5 mini', in: 0.25, out: 2, cached: 0.025 },
    { id: 'gpt-5-nano', vendor: 'OpenAI', name: 'GPT-5 nano', in: 0.05, out: 0.4, cached: 0.005 },

    /* Anthropic — https://platform.claude.com/docs/en/about-claude/pricing */
    { id: 'fable-5.2', vendor: 'Anthropic', name: 'Claude Fable 5.2', in: 8, out: 40, cached: 0.2 },
    { id: 'opus-5.5', vendor: 'Anthropic', name: 'Claude Opus 5.5', in: 4, out: 20, cached: 0.2 },
    { id: 'opus-5', vendor: 'Anthropic', name: 'Claude Opus 5', in: 5, out: 25, cached: 0.5 },
    { id: 'sonnet-5.5', vendor: 'Anthropic', name: 'Claude Sonnet 5.5', in: 2, out: 10, cached: 0.1 },
    { id: 'sonnet-4.6', vendor: 'Anthropic', name: 'Claude Sonnet 4.6', in: 3, out: 15, cached: 0.3 },
    { id: 'haiku-5.5', vendor: 'Anthropic', name: 'Claude Haiku 5.5', in: 0.1, out: 0.5, cached: 0.01, note: 'Prompts over 100K tokens bill at $0.50 / $2.50.' },
    { id: 'haiku-4.5', vendor: 'Anthropic', name: 'Claude Haiku 4.5', in: 1, out: 5, cached: 0.1 },

    /* Google — https://ai.google.dev/gemini-api/docs/pricing */
    { id: 'gemini-4-argon', vendor: 'Google', name: 'Gemini 4 Argon', in: 2, out: 10, cached: 0.1, note: 'Intro price. $4 / $20 from 1 Dec 2026.' },
    { id: 'gemini-3.8-flash', vendor: 'Google', name: 'Gemini 3.8 Flash', in: 0.75, out: 3.75, cached: 0.075, note: 'Intro price. $1.50 / $7.50 from 1 Jan 2027.' },
    { id: 'gemini-3.1-pro', vendor: 'Google', name: 'Gemini 3.1 Pro', in: 2, out: 12, cached: 0.2, note: 'Prompts over 200K tokens bill at $4 / $18.' },
    { id: 'gemini-3.1-flash-lite', vendor: 'Google', name: 'Gemini 3.1 Flash-Lite', in: 0.25, out: 1.5, cached: 0.025 },
    { id: 'gemini-3-flash', vendor: 'Google', name: 'Gemini 3 Flash', in: 0.5, out: 3, cached: 0.05 }
  ];

  /* ================================================================== *
   * 1. Small helpers
   * ================================================================== */

  function toNum(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback;
    var n = Number(String(value).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : fallback;
  }

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  function round(n, digits) {
    var f = Math.pow(10, digits === undefined ? 2 : digits);
    return Math.round((n + Number.EPSILON) * f) / f;
  }

  function money(n, digits) {
    var d = digits === undefined ? 2 : digits;
    var neg = n < 0;
    var s = Math.abs(n).toFixed(d);
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-$' : '$') + parts.join('.');
  }

  /* Money that stays readable from $0.0004 to $1,200,000 */
  function smartMoney(n) {
    var v = Math.abs(n);
    if (v === 0) return '$0';
    if (v < 0.01) return money(n, 4);
    if (v < 1) return money(n, 3);
    if (v < 1000) return money(n, 2);
    return money(n, 0);
  }

  function pct(n, digits) {
    return (n * 100).toFixed(digits === undefined ? 1 : digits) + '%';
  }

  /* ================================================================== *
   * 2. AI API & token cost
   * ================================================================== */

  /**
   * Cost of one prompt, in USD.
   * @param {object} model  entry from MODELS
   * @param {number} inTok  input tokens per prompt
   * @param {number} outTok output tokens per prompt (reasoning tokens included)
   * @param {number} cachedShare 0..1 share of input tokens read from cache
   */
  function promptCost(model, inTok, outTok, cachedShare) {
    var share = clamp(cachedShare || 0, 0, 1);
    inTok = Math.max(0, Number(inTok) || 0);
    outTok = Math.max(0, Number(outTok) || 0);
    var inPrice = model.in;
    var cachedPrice = (model.cached === null || model.cached === undefined) ? model.in : model.cached;
    var fresh = inTok * (1 - share);
    var cached = inTok * share;
    return (fresh / 1e6) * inPrice + (cached / 1e6) * cachedPrice + (outTok / 1e6) * model.out;
  }

  /**
   * Full comparison across every model in the catalogue.
   * @param {object} input {inTok, outTok, promptsPerDay, teamSize, daysPerMonth, cachedShare}
   */
  function tokenCost(input) {
    var inTok = clamp(toNum(input && input.inTok, 1500), 0, 2000000);
    var outTok = clamp(toNum(input && input.outTok, 500), 0, 2000000);
    var promptsPerDay = clamp(toNum(input && input.promptsPerDay, 30), 0, 100000);
    var teamSize = clamp(toNum(input && input.teamSize, 5), 0, 100000);
    var daysPerMonth = clamp(toNum(input && input.daysPerMonth, 22), 0, 31);
    var cachedShare = clamp(toNum(input && input.cachedShare, 0), 0, 0.95);

    var perUserMonthPrompts = promptsPerDay * daysPerMonth;

    var rows = MODELS.map(function (m) {
      var perPrompt = promptCost(m, inTok, outTok, cachedShare);
      var perUserMonth = perPrompt * perUserMonthPrompts;
      return {
        id: m.id,
        vendor: m.vendor,
        name: m.name,
        note: m.note || '',
        in: m.in,
        out: m.out,
        cached: (m.cached === undefined ? null : m.cached),
        perPrompt: perPrompt,
        perUserMonth: perUserMonth,
        teamMonth: perUserMonth * teamSize,
        teamYear: perUserMonth * teamSize * 12,
        per1kPrompts: perPrompt * 1000
      };
    });

    var sorted = rows.slice().sort(function (a, b) { return a.teamMonth - b.teamMonth; });
    var cheapest = sorted[0];
    var dearest = sorted[sorted.length - 1];
    var baseline = cheapest.teamMonth > 0 ? cheapest.teamMonth : 1;

    rows.forEach(function (r) {
      r.vsCheapest = r.teamMonth / baseline;
      r.bar = dearest.teamMonth > 0 ? (r.teamMonth / dearest.teamMonth) : 0;
    });

    var totalPromptsMonth = promptsPerDay * daysPerMonth * teamSize;

    return {
      ok: true,
      input: {
        inTok: inTok, outTok: outTok, promptsPerDay: promptsPerDay, teamSize: teamSize,
        daysPerMonth: daysPerMonth, cachedShare: cachedShare
      },
      tokensPerPrompt: inTok + outTok,
      tokensMonth: totalPromptsMonth * (inTok + outTok),
      promptsMonth: totalPromptsMonth,
      rows: rows,
      sorted: sorted,
      cheapest: cheapest,
      dearest: dearest,
      spread: cheapest.teamMonth > 0 ? dearest.teamMonth / cheapest.teamMonth : 0
    };
  }

  /* ================================================================== *
   * 3. Freelance hourly rate
   * ================================================================== */

  /**
   * Turn a take-home target into an hourly rate you can quote.
   * @param {object} input {target, taxRate, buffer, hoursPerWeek, weeksOff, hoursPerDay, projectHours}
   */
  function rateCalc(input) {
    var target = clamp(toNum(input && input.target, 90000), 0, 1e9);
    var taxRate = clamp(toNum(input && input.taxRate, 25) / 100, 0, 0.95);
    var buffer = clamp(toNum(input && input.buffer, 10) / 100, 0, 0.9);
    var hoursPerWeek = clamp(toNum(input && input.hoursPerWeek, 25), 0, 80);
    var weeksOff = clamp(toNum(input && input.weeksOff, 4), 0, 52);
    var hoursPerDay = clamp(toNum(input && input.hoursPerDay, 8), 1, 16);
    var projectHours = clamp(toNum(input && input.projectHours, 40), 0, 5000);

    var weeksWorked = 52 - weeksOff;
    var billableHours = hoursPerWeek * weeksWorked;

    if (billableHours <= 0) {
      return { ok: false, error: 'Billable hours per week and weeks worked cannot both be zero — there is no hour to sell.' };
    }
    if (target <= 0) {
      return { ok: false, error: 'Enter the annual take-home you want to reach.' };
    }

    var gross = target / (1 - taxRate);
    var revenue = gross / (1 - buffer);
    var hourly = revenue / billableHours;
    var dayRate = hourly * hoursPerDay;
    var weekRate = hourly * hoursPerWeek;
    var monthRate = revenue / 12;
    var projectQuote = hourly * projectHours;
    var effectiveHourly = target / billableHours;
    var overheadRate = (revenue - target) / revenue;

    return {
      ok: true,
      input: {
        target: target, taxRate: taxRate, buffer: buffer, hoursPerWeek: hoursPerWeek,
        weeksOff: weeksOff, hoursPerDay: hoursPerDay, projectHours: projectHours
      },
      weeksWorked: weeksWorked,
      billableHours: billableHours,
      gross: gross,
      revenue: revenue,
      taxes: gross - target,
      overhead: revenue - gross,
      hourly: hourly,
      dayRate: dayRate,
      weekRate: weekRate,
      monthRate: monthRate,
      projectQuote: projectQuote,
      effectiveHourly: effectiveHourly,
      overheadRate: overheadRate,
      breakEvenHours: hourly > 0 ? target / hourly : 0,
      takeHomePerDay: target / (weeksWorked * 5)
    };
  }

  /* ================================================================== *
   * 4. Timezone overlap
   * ================================================================== */

  /* offset rules: 'fixed' = standard offset only; 'us' | 'eu' | 'au' | 'nz' = DST rules */
  var CITIES = [
    { id: 'seoul', name: 'Seoul', region: 'South Korea', rule: 'fixed', std: 9 },
    { id: 'tokyo', name: 'Tokyo', region: 'Japan', rule: 'fixed', std: 9 },
    { id: 'singapore', name: 'Singapore', region: 'Singapore', rule: 'fixed', std: 8 },
    { id: 'bali', name: 'Bali', region: 'Indonesia (WITA)', rule: 'fixed', std: 8 },
    { id: 'bangkok', name: 'Bangkok', region: 'Thailand', rule: 'fixed', std: 7 },
    { id: 'hcmc', name: 'Ho Chi Minh City', region: 'Vietnam', rule: 'fixed', std: 7 },
    { id: 'jakarta', name: 'Jakarta', region: 'Indonesia (WIB)', rule: 'fixed', std: 7 },
    { id: 'dubai', name: 'Dubai', region: 'UAE', rule: 'fixed', std: 4 },
    { id: 'bangalore', name: 'Bengaluru', region: 'India', rule: 'fixed', std: 5.5 },
    { id: 'istanbul', name: 'Istanbul', region: 'Türkiye', rule: 'fixed', std: 3 },
    { id: 'berlin', name: 'Berlin', region: 'Germany', rule: 'eu', std: 1 },
    { id: 'amsterdam', name: 'Amsterdam', region: 'Netherlands', rule: 'eu', std: 1 },
    { id: 'lisbon', name: 'Lisbon', region: 'Portugal', rule: 'eu', std: 0 },
    { id: 'london', name: 'London', region: 'United Kingdom', rule: 'eu', std: 0 },
    { id: 'newyork', name: 'New York', region: 'United States (ET)', rule: 'us', std: -5 },
    { id: 'toronto', name: 'Toronto', region: 'Canada (ET)', rule: 'us', std: -5 },
    { id: 'chicago', name: 'Chicago', region: 'United States (CT)', rule: 'us', std: -6 },
    { id: 'denver', name: 'Denver', region: 'United States (MT)', rule: 'us', std: -7 },
    { id: 'losangeles', name: 'Los Angeles', region: 'United States (PT)', rule: 'us', std: -8 },
    { id: 'vancouver', name: 'Vancouver', region: 'Canada (PT)', rule: 'us', std: -8,
      /* British Columbia stopped falling back on 1 Nov 2026: permanent UTC-7 */
      switch: { at: Date.UTC(2026, 10, 1, 9), after: -7 } },
    { id: 'mexicocity', name: 'Mexico City', region: 'Mexico', rule: 'fixed', std: -6 },
    { id: 'saopaulo', name: 'São Paulo', region: 'Brazil', rule: 'fixed', std: -3 },
    { id: 'buenosaires', name: 'Buenos Aires', region: 'Argentina', rule: 'fixed', std: -3 },
    { id: 'sydney', name: 'Sydney', region: 'Australia (AET)', rule: 'au', std: 10 },
    { id: 'melbourne', name: 'Melbourne', region: 'Australia (AET)', rule: 'au', std: 10 },
    { id: 'auckland', name: 'Auckland', region: 'New Zealand', rule: 'nz', std: 12 },
    { id: 'honolulu', name: 'Honolulu', region: 'United States (HST)', rule: 'fixed', std: -10 },
    { id: 'nairobi', name: 'Nairobi', region: 'Kenya', rule: 'fixed', std: 3 },
    { id: 'capetown', name: 'Cape Town', region: 'South Africa', rule: 'fixed', std: 2 }
  ];

  var HOUR = 3600000;
  var DAY = 86400000;

  function cityById(id) {
    for (var i = 0; i < CITIES.length; i++) {
      if (CITIES[i].id === id) return CITIES[i];
    }
    return null;
  }

  /** Day number of the n-th (1-based) Sunday of a month. */
  function nthSundayUTC(year, month, n) {
    var first = new Date(Date.UTC(year, month, 1));
    var firstDow = first.getUTCDay();
    var day = 1 + ((7 - firstDow) % 7) + (n - 1) * 7;
    return day;
  }

  /** Day number of the last Sunday of a month. */
  function lastSundayUTC(year, month) {
    var last = new Date(Date.UTC(year, month + 1, 0));
    var dow = last.getUTCDay();
    return last.getUTCDate() - dow;
  }

  /**
   * UTC offset in hours for a city at a given UTC instant.
   * Rules are the published ones: US (2nd Sun Mar / 1st Sun Nov),
   * EU (last Sun Mar / last Sun Oct, 01:00 UTC), AU and NZ (spring/autumn Sundays).
   */
  function offsetHours(city, utcMs) {
    if (!city) return 0;
    if (city.switch && utcMs >= city.switch.at) return city.switch.after;
    if (city.rule === 'fixed') return city.std;

    var year = new Date(utcMs).getUTCFullYear();

    if (city.rule === 'us') {
      var startUS = Date.UTC(year, 2, nthSundayUTC(year, 2, 2), 2 - city.std);
      var endUS = Date.UTC(year, 10, nthSundayUTC(year, 10, 1), 2 - (city.std + 1));
      return (utcMs >= startUS && utcMs < endUS) ? city.std + 1 : city.std;
    }
    if (city.rule === 'eu') {
      var startEU = Date.UTC(year, 2, lastSundayUTC(year, 2), 1);
      var endEU = Date.UTC(year, 9, lastSundayUTC(year, 9), 1);
      return (utcMs >= startEU && utcMs < endEU) ? city.std + 1 : city.std;
    }
    if (city.rule === 'au') {
      /* DST runs from the first Sunday of October 02:00 to the first Sunday of April 03:00 */
      var startAU = Date.UTC(year, 9, nthSundayUTC(year, 9, 1), 2 - city.std);
      var endAU = Date.UTC(year, 3, nthSundayUTC(year, 3, 1), 3 - (city.std + 1));
      return (utcMs >= startAU || utcMs < endAU) ? city.std + 1 : city.std;
    }
    if (city.rule === 'nz') {
      var startNZ = Date.UTC(year, 8, lastSundayUTC(year, 8), 2 - city.std);
      var endNZ = Date.UTC(year, 3, nthSundayUTC(year, 3, 1), 3 - (city.std + 1));
      return (utcMs >= startNZ || utcMs < endNZ) ? city.std + 1 : city.std;
    }
    return city.std;
  }

  /** Local calendar parts for an instant and an offset. */
  function localParts(utcMs, offsetH) {
    var shifted = new Date(utcMs + offsetH * HOUR);
    return {
      y: shifted.getUTCFullYear(),
      m: shifted.getUTCMonth(),
      d: shifted.getUTCDate(),
      hh: shifted.getUTCHours(),
      mm: shifted.getUTCMinutes(),
      wd: shifted.getUTCDay()
    };
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function isoDate(y, m, d) {
    return y + '-' + pad2(m + 1) + '-' + pad2(d);
  }

  function parseISODate(str) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || ''));
    if (!m) return null;
    var y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
    var probe = new Date(Date.UTC(y, mo, d));
    if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo || probe.getUTCDate() !== d) return null;
    return { y: y, m: mo, d: d };
  }

  /** UTC instant for a wall-clock time in a city (two passes handle DST edges). */
  function instantFromLocal(city, y, m, d, hour) {
    var guess = Date.UTC(y, m, d, hour) - city.std * HOUR;
    var off = offsetHours(city, guess);
    var utc = Date.UTC(y, m, d, hour) - off * HOUR;
    var off2 = offsetHours(city, utc);
    if (off2 !== off) utc = Date.UTC(y, m, d, hour) - off2 * HOUR;
    return utc;
  }

  function weekdayName(wd) {
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][wd];
  }

  /**
   * Build the 24-hour overlap grid for a home city and up to five partners.
   * @param {object} input {home:'seoul', members:['losangeles','london'], date:'2026-11-15', start:9, end:18}
   */
  function overlap(input) {
    var home = cityById(input && input.home) || cityById('seoul');
    var memberIds = (input && input.members) || [];
    var members = [];
    memberIds.forEach(function (id) {
      var c = cityById(id);
      if (c && c.id !== home.id && members.indexOf(c) === -1) members.push(c);
    });
    members = members.slice(0, 5);

    var start = clamp(toNum(input && input.start, 9), 0, 23);
    var end = clamp(toNum(input && input.end, 18), 1, 24);
    if (end <= start) end = Math.min(24, start + 1);

    var dateStr = (input && input.date) || isoDate(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
    var dateParts = parseISODate(dateStr);
    if (!dateParts) {
      return { ok: false, error: 'Pick a valid date (YYYY-MM-DD).' };
    }

    var cities = [home].concat(members);
    var rows = [];
    for (var h = 0; h < 24; h++) {
      var utcMs = instantFromLocal(home, dateParts.y, dateParts.m, dateParts.d, h);
      var cells = cities.map(function (c) {
        var off = offsetHours(c, utcMs);
        var p = localParts(utcMs, off);
        var dayDelta = Math.round((Date.UTC(p.y, p.m, p.d) - Date.UTC(dateParts.y, dateParts.m, dateParts.d)) / DAY);
        var dstShift = offsetHours(c, utcMs) - offsetHours(c, utcMs - HOUR);
        return {
          cityId: c.id,
          hour: p.hh,
          minute: p.mm,
          dayDelta: dayDelta,
          inWindow: p.hh >= start && p.hh < end,
          dstShift: dstShift
        };
      });
      rows.push({
        homeHour: h,
        utcMs: utcMs,
        cells: cells,
        allIn: cells.every(function (x) { return x.inWindow; })
      });
    }

    /* Contiguous runs where everyone is inside the working window */
    var windows = [];
    var current = null;
    rows.forEach(function (row) {
      if (row.allIn) {
        if (!current) current = { from: row.homeHour, to: row.homeHour + 1 };
        else current.to = row.homeHour + 1;
      } else if (current) {
        windows.push(current);
        current = null;
      }
    });
    if (current) windows.push(current);

    /* A run that touches both midnight ends is really one overnight window */
    if (windows.length > 1 && windows[0].from === 0 && windows[windows.length - 1].to === 24) {
      var head = windows.shift();
      var tail = windows.pop();
      windows.push({ from: tail.from, to: 24, wraps: true, fromAlt: 0, toAlt: head.to });
    } else if (windows.length === 1 && windows[0].from === 0 && windows[0].to === 24) {
      windows[0].wraps = true;
    }

    windows.forEach(function (w) {
      w.hours = w.to - w.from;
      var startRow = rows[w.from];
      var endRow = rows[(w.to - 1) % 24];
      w.localRanges = cities.map(function (c, i) {
        var a = startRow.cells[i];
        var b = endRow.cells[i];
        return {
          cityId: c.id,
          from: a.hour,
          to: (b.hour + 1) % 24,
          dayDelta: a.dayDelta
        };
      });
    });

    windows.sort(function (a, b) { return b.hours - a.hours; });

    var best = windows[0] || null;

    return {
      ok: true,
      home: home,
      members: members,
      cities: cities,
      date: isoDate(dateParts.y, dateParts.m, dateParts.d),
      start: start,
      end: end,
      rows: rows,
      windows: windows,
      best: best,
      overlapHours: windows.reduce(function (sum, w) { return sum + w.hours; }, 0),
      memberCount: members.length
    };
  }

  /** "Your 09:00 is 16:00 the previous day for them" summary. */
  function offsetLabel(city, home, utcMs) {
    var off = offsetHours(city, utcMs);
    var homeOff = offsetHours(home, utcMs);
    var diff = off - homeOff;
    var sign = diff > 0 ? '+' : '';
    var hrs = Math.abs(diff);
    var whole = Math.floor(hrs);
    var mins = Math.round((hrs - whole) * 60);
    return sign + (diff < 0 ? '-' : '') + String(whole) + (mins ? ':' + pad2(mins) : '');
  }

  /* ================================================================== *
   * 5. Export
   * ================================================================== */

  global.NOMAD = {
    version: '1.0.0',
    pricesChecked: '2026-11-15',
    MODELS: MODELS,
    CITIES: CITIES,
    promptCost: promptCost,
    tokenCost: tokenCost,
    rateCalc: rateCalc,
    overlap: overlap,
    offsetHours: offsetHours,
    localParts: localParts,
    instantFromLocal: instantFromLocal,
    cityById: cityById,
    isoDate: isoDate,
    offsetLabel: offsetLabel,
    money: money,
    smartMoney: smartMoney,
    pct: pct,
    toNum: toNum
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* ==================================================================== *
 * 6. Browser UI (skipped when the engine is loaded outside a browser)
 * ==================================================================== */
(function () {
  'use strict';
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  var N = window.NOMAD;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  /* Thousands separators without depending on the browser's locale */
  function group(n) {
    var v = String(Math.round(n));
    return v.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function setText(sel, value) {
    var node = $(sel);
    if (node) node.textContent = value;
  }

  function todayISO() {
    var d = new Date();
    return N.isoDate(d.getFullYear(), d.getMonth(), d.getDate());
  }

  /* ---------------- tabs ---------------- */

  function initTabs() {
    var buttons = $$('[role="tab"]');
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        activateTab(btn.getAttribute('data-tab'));
      });
      btn.addEventListener('keydown', function (e) {
        var i = buttons.indexOf(btn);
        var next = null;
        if (e.key === 'ArrowRight') next = buttons[(i + 1) % buttons.length];
        if (e.key === 'ArrowLeft') next = buttons[(i - 1 + buttons.length) % buttons.length];
        if (next) { e.preventDefault(); next.focus(); activateTab(next.getAttribute('data-tab')); }
      });
    });
  }

  function activateTab(id) {
    $$('[role="tab"]').forEach(function (btn) {
      var on = btn.getAttribute('data-tab') === id;
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      btn.setAttribute('tabindex', on ? '0' : '-1');
      btn.classList.toggle('is-active', on);
    });
    $$('[role="tabpanel"]').forEach(function (panel) {
      panel.hidden = panel.id !== 'panel-' + id;
    });
    if (window.history && history.replaceState) {
      var params = new URLSearchParams(location.search);
      params.set('tab', id);
      history.replaceState(null, '', location.pathname + '?' + params.toString() + location.hash);
    }
  }

  /* ---------------- tab 1: AI cost ---------------- */

  var aiVendorFilter = 'all';

  function readAI() {
    return {
      inTok: $('#ai-in').value,
      outTok: $('#ai-out').value,
      promptsPerDay: $('#ai-prompts').value,
      teamSize: $('#ai-team').value,
      daysPerMonth: $('#ai-days').value,
      cachedShare: Number($('#ai-cache').value) / 100
    };
  }

  function renderAI() {
    var input = readAI();
    var result = N.tokenCost(input);

    setText('#ai-cache-label', Math.round(result.input.cachedShare * 100) + '% of input read from cache');
    setText('#ai-tokens', group(result.tokensPerPrompt) + ' tokens per prompt');
    setText('#ai-prompts-month', group(result.promptsMonth) + ' prompts per month across the team');

    var cheapest = result.cheapest;
    var html = '';
    html += '<p class="headline-cost">' + N.smartMoney(cheapest.teamMonth) + ' <span>/ month</span></p>';
    html += '<p class="headline-note">Cheapest on these numbers: <strong>' + cheapest.name +
      '</strong> for ' + result.input.teamSize + ' seat' + (result.input.teamSize === 1 ? '' : 's') +
      '. The most expensive option in the table costs <strong>' +
      (result.spread ? result.spread.toFixed(0) + '×' : '—') + '</strong> that.</p>';
    $('#ai-headline').innerHTML = html;

    var body = $('#ai-table tbody');
    body.innerHTML = '';
    result.sorted.forEach(function (row) {
      if (aiVendorFilter !== 'all' && row.vendor !== aiVendorFilter) return;
      var tr = el('tr');
      if (row.id === cheapest.id) tr.className = 'is-best';
      var tdName = el('td', 'model-cell');
      tdName.appendChild(el('strong', null, row.name));
      tdName.appendChild(el('span', 'vendor', row.vendor));
      if (row.note) tdName.appendChild(el('span', 'note', row.note));
      tr.appendChild(tdName);
      tr.appendChild(el('td', 'num', '$' + row.in.toFixed(2) + ' / $' + row.out.toFixed(2)));
      tr.appendChild(el('td', 'num', N.smartMoney(row.perPrompt)));
      tr.appendChild(el('td', 'num', N.smartMoney(row.perUserMonth)));
      tr.appendChild(el('td', 'num strong', N.smartMoney(row.teamMonth)));
      tr.appendChild(el('td', 'num', row.vsCheapest ? '×' + row.vsCheapest.toFixed(1) : '—'));
      body.appendChild(tr);
    });

    var spread = $('#ai-spread');
    if (spread) {
      spread.textContent = 'Same workload, ' + N.smartMoney(result.cheapest.teamMonth) + ' to ' +
        N.smartMoney(result.dearest.teamMonth) + ' a month. That gap is the whole reason this page exists.';
    }
    saveState();
  }

  function initAI() {
    var ids = ['ai-in', 'ai-out', 'ai-prompts', 'ai-team', 'ai-days', 'ai-cache'];
    ids.forEach(function (id) {
      var node = $('#' + id);
      if (node) node.addEventListener('input', renderAI);
    });
    $$('[data-vendor]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        aiVendorFilter = btn.getAttribute('data-vendor');
        $$('[data-vendor]').forEach(function (b) { b.classList.toggle('is-active', b === btn); });
        renderAI();
      });
    });
  }

  /* ---------------- tab 2: freelance rate ---------------- */

  function readRate() {
    return {
      target: $('#rate-target').value,
      taxRate: $('#rate-tax').value,
      buffer: $('#rate-buffer').value,
      hoursPerWeek: $('#rate-hours').value,
      weeksOff: $('#rate-weeks').value,
      hoursPerDay: $('#rate-day').value,
      projectHours: $('#rate-project').value
    };
  }

  function renderRate() {
    var r = N.rateCalc(readRate());
    var box = $('#rate-result');
    if (!r.ok) {
      box.innerHTML = '<p class="error">' + r.error + '</p>';
      return;
    }
    setText('#rate-hours-note', group(r.billableHours) + ' billable hours this year (' +
      r.input.hoursPerWeek + '/week × ' + r.weeksWorked + ' weeks)');

    var html = '';
    html += '<div class="hero-number"><span class="label">Quote this hourly rate</span>' +
      '<span class="value">' + N.money(r.hourly, 0) + '<small>/hr</small></span></div>';
    html += '<div class="rate-grid">';
    html += card('Day rate (' + r.input.hoursPerDay + ' h)', N.money(r.dayRate, 0));
    html += card('Week rate', N.money(r.weekRate, 0));
    html += card('Monthly revenue', N.money(r.monthRate, 0));
    html += card('Project · ' + r.input.projectHours + ' h', N.money(r.projectQuote, 0));
    html += card('Gross you must invoice', N.money(r.revenue, 0));
    html += card('Tax set aside', N.money(r.taxes, 0));
    html += card('Business costs', N.money(r.overhead, 0));
    html += card('Take-home per billable hour', N.money(r.effectiveHourly, 0));
    html += '</div>';
    html += '<p class="fineprint">Of every dollar you invoice, ' + N.pct(r.overheadRate, 0) +
      ' goes to tax and business costs before it reaches you. A working day at this rate invoices ' +
      N.money(r.dayRate, 0) + '; the take-home behind that day is about ' +
      N.money(r.takeHomePerDay, 0) + '.</p>';
    box.innerHTML = html;
    saveState();
  }

  function card(label, value) {
    return '<div class="stat"><span class="stat-label">' + label + '</span><span class="stat-value">' + value + '</span></div>';
  }

  function initRate() {
    ['rate-target', 'rate-tax', 'rate-buffer', 'rate-hours', 'rate-weeks', 'rate-day', 'rate-project'].forEach(function (id) {
      var node = $('#' + id);
      if (node) node.addEventListener('input', renderRate);
    });
  }

  /* ---------------- tab 3: timezone ---------------- */

  var MAX_MEMBERS = 5;

  function buildCityOptions(select, selected, allowNone) {
    select.innerHTML = '';
    if (allowNone) {
      var none = el('option', null, '—');
      none.value = '';
      select.appendChild(none);
    }
    N.CITIES.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (c) {
      var opt = el('option', null, c.name + ' · ' + c.region);
      opt.value = c.id;
      if (c.id === selected) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function readTZ() {
    return {
      home: $('#tz-home').value,
      date: $('#tz-date').value,
      start: $('#tz-start').value,
      end: $('#tz-end').value,
      members: $$('.tz-member').map(function (s) { return s.value; }).filter(Boolean)
    };
  }

  function hourLabel(h) {
    var suffix = h < 12 ? 'am' : 'pm';
    var base = h % 12;
    if (base === 0) base = 12;
    return base + suffix;
  }

  function renderTZ() {
    var input = readTZ();
    var r = N.overlap(input);
    var box = $('#tz-result');
    if (!r.ok) {
      box.innerHTML = '<p class="error">' + r.error + '</p>';
      return;
    }
    var nowMs = Date.now();
    var html = '';

    if (r.best) {
      var bestHome = r.best.wraps
        ? hourLabel(r.best.from) + ' – ' + hourLabel(r.best.to % 24)
        : hourLabel(r.best.from) + ' – ' + hourLabel(r.best.to);
      html += '<div class="hero-number"><span class="label">Longest window where everyone is at work</span>' +
        '<span class="value">' + r.best.hours + '<small>h</small></span></div>';
      html += '<p class="headline-note">In ' + r.home.name + ' that is <strong>' + bestHome + '</strong> on ' +
        r.date + '. ' + (r.overlapHours > r.best.hours
          ? 'There are ' + r.windows.length + ' windows in total, ' + r.overlapHours + ' hours combined.'
          : 'That is the only window that works for all ' + (r.cities.length) + ' cities.') + '</p>';
    } else {
      html += '<div class="hero-number"><span class="label">No overlap</span><span class="value">0<small>h</small></span></div>';
      html += '<p class="headline-note">On these working hours nobody shares a slot. Widen the window, drop a city, ' +
        'or move the meeting to someone\'s evening on purpose — alternating who takes the awkward hour is the usual fix.</p>';
    }

    /* per-city quick facts */
    var utcNoon = N.instantFromLocal(r.home, Number(r.date.slice(0, 4)), Number(r.date.slice(5, 7)) - 1, Number(r.date.slice(8, 10)), 12);
    html += '<ul class="city-facts">';
    r.cities.forEach(function (c) {
      var p = N.localParts(utcNoon, N.offsetHours(c, utcNoon));
      var off = N.offsetHours(c, utcNoon);
      var sign = off >= 0 ? '+' : '-';
      var abs = Math.abs(off);
      var offTxt = sign + Math.floor(abs) + (abs % 1 ? ':30' : '');
      var tail = (c.id === r.home.id)
        ? 'your reference clock'
        : 'noon in ' + r.home.name + ' is ' + pad(p.hh) + ':' + pad(p.mm) + ' there' +
          (p.d !== Number(r.date.slice(8, 10)) ? ' (another day)' : '');
      html += '<li><strong>' + c.name + '</strong> <span class="muted">' + c.region + '</span><br>' +
        'UTC' + offTxt + ' · ' + tail + '</li>';
    });
    html += '</ul>';

    /* grid */
    html += '<div class="tz-scroll"><table class="tz-table"><thead><tr><th scope="col">' + r.home.name + '</th>';
    r.members.forEach(function (c) { html += '<th scope="col">' + c.name + '</th>'; });
    html += '<th scope="col">All at work</th></tr></thead><tbody>';
    r.rows.forEach(function (row) {
      html += '<tr' + (row.allIn ? ' class="is-overlap"' : '') + '>';
      html += '<th scope="row">' + pad(row.homeHour) + ':00</th>';
      row.cells.forEach(function (cell) {
        var cls = 'tz-cell' + (cell.inWindow ? ' in' : '') + (cell.dstShift ? ' dst' : '');
        var mark = cell.dayDelta > 0 ? ' <sup>+1</sup>' : (cell.dayDelta < 0 ? ' <sup>−1</sup>' : '');
        html += '<td class="' + cls + '">' + pad(cell.hour) + mark + '</td>';
      });
      html += '<td class="mark">' + (row.allIn ? '✓' : '') + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    html += '<p class="fineprint">Green cells are inside ' + pad(r.start) + ':00–' + pad(r.end) + ':00 local time. ' +
      'Hover a cell with a dotted border to see the moment a country changes its clocks — those are the weeks when a recurring meeting silently moves an hour.</p>';
    box.innerHTML = html;
    saveState();
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function initTZ() {
    var home = $('#tz-home');
    buildCityOptions(home, 'seoul', false);
    var slots = $$('.tz-member');
    var defaults = ['tokyo', 'singapore', 'sydney'];
    slots.forEach(function (slot, i) {
      buildCityOptions(slot, defaults[i] || '', true);
      slot.addEventListener('change', renderTZ);
    });
    if (!$('#tz-date').value) $('#tz-date').value = todayISO();
    ['tz-home', 'tz-date', 'tz-start', 'tz-end'].forEach(function (id) {
      var node = $('#' + id);
      if (node) node.addEventListener('input', renderTZ);
      if (node) node.addEventListener('change', renderTZ);
    });
    var add = $('#tz-add');
    if (add) {
      add.addEventListener('click', function () {
        var empty = slots.filter(function (s) { return !s.value; })[0];
        if (!empty) return;
        var pick = N.CITIES.filter(function (c) {
          return !slots.some(function (s) { return s.value === c.id; }) && c.id !== home.value;
        })[0];
        if (pick) { empty.value = pick.id; renderTZ(); }
      });
    }
  }

  /* ---------------- shareable state ---------------- */

  function saveState() {
    if (!window.history || !history.replaceState) return;
    var params = new URLSearchParams(location.search);
    params.set('in', $('#ai-in').value);
    params.set('out', $('#ai-out').value);
    params.set('prompts', $('#ai-prompts').value);
    params.set('team', $('#ai-team').value);
    params.set('days', $('#ai-days').value);
    params.set('cache', $('#ai-cache').value);
    params.set('target', $('#rate-target').value);
    params.set('tax', $('#rate-tax').value);
    params.set('buffer', $('#rate-buffer').value);
    params.set('hours', $('#rate-hours').value);
    params.set('weeks', $('#rate-weeks').value);
    params.set('home', $('#tz-home').value);
    params.set('date', $('#tz-date').value);
    params.set('from', $('#tz-start').value);
    params.set('to', $('#tz-end').value);
    var members = $$('.tz-member').map(function (s) { return s.value; }).filter(Boolean);
    if (members.length) params.set('cities', members.join(','));
    else params.delete('cities');
    history.replaceState(null, '', location.pathname + '?' + params.toString() + location.hash);
  }

  function loadState() {
    var params = new URLSearchParams(location.search);
    var map = {
      'ai-in': params.get('in'), 'ai-out': params.get('out'), 'ai-prompts': params.get('prompts'),
      'ai-team': params.get('team'), 'ai-days': params.get('days'), 'ai-cache': params.get('cache'),
      'rate-target': params.get('target'), 'rate-tax': params.get('tax'), 'rate-buffer': params.get('buffer'),
      'rate-hours': params.get('hours'), 'rate-weeks': params.get('weeks'),
      'tz-date': params.get('date'), 'tz-start': params.get('from'), 'tz-end': params.get('to')
    };
    Object.keys(map).forEach(function (id) {
      if (map[id]) { var node = $('#' + id); if (node) node.value = map[id]; }
    });
    if (params.get('home')) {
      var home = $('#tz-home');
      if (home) home.value = params.get('home');
    }
    var cities = params.get('cities');
    if (cities) {
      var ids = cities.split(',').slice(0, MAX_MEMBERS);
      $$('.tz-member').forEach(function (slot, i) { if (ids[i]) slot.value = ids[i]; });
    }
    var tab = params.get('tab');
    if (tab && $('#panel-' + tab)) activateTab(tab);
  }

  /* ---------------- boot ---------------- */

  function boot() {
    initTabs();
    initAI();
    initRate();
    initTZ();
    loadState();
    if (!$('#tz-date').value) $('#tz-date').value = todayISO();
    renderAI();
    renderRate();
    renderTZ();
    var year = $('#year');
    if (year) year.textContent = new Date().getFullYear();
    if (document.body.classList.contains('js-loading')) document.body.classList.remove('js-loading');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
