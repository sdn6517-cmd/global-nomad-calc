/* Head-less DOM harness: runs the real browser code path of app.js against a
   minimal document built from index.html, then asserts what it rendered.
   Called by tests/dom-run.py, which supplies __fixture. */
(function () {
  var log = function (s) { console.log(s); };
  var fixture = __fixture;
  var REG = {};
  var ALL = [];

  function Elements() {}

  function El(tag, id, cls, value) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.id = id || '';
    this.className = cls || '';
    this.value = value === undefined ? '' : value;
    this.children = [];
    this._text = '';
    this._html = '';
    this._attrs = {};
    this._listeners = {};
    this.hidden = false;
    this.selected = false;
    var self = this;
    this.classList = {
      toggle: function (name, force) {
        var on = force === undefined ? !self._hasClass(name) : !!force;
        if (on) self.className = (self.className ? self.className + ' ' : '') + name;
        else self.className = self.className.split(/\s+/).filter(function (c) { return c && c !== name; }).join(' ');
        return on;
      },
      add: function (name) { if (!self._hasClass(name)) self.className += (self.className ? ' ' : '') + name; },
      remove: function (name) { self.className = self.className.split(/\s+/).filter(function (c) { return c && c !== name; }).join(' '); },
      contains: function (name) { return self._hasClass(name); }
    };
    ALL.push(this);
  }

  El.prototype._hasClass = function (name) {
    return this.className.split(/\s+/).indexOf(name) !== -1;
  };
  Object.defineProperty(El.prototype, 'textContent', {
    get: function () { return this._text; },
    set: function (v) { this._text = String(v); this._html = ''; this.children = []; }
  });
  Object.defineProperty(El.prototype, 'innerHTML', {
    get: function () { return this._html; },
    set: function (v) { this._html = String(v); this.children = []; }
  });
  El.prototype.appendChild = function (child) {
    this.children.push(child);
    if (this.tagName === 'SELECT' && child.selected) this.value = child.value;
    return child;
  };
  El.prototype.setAttribute = function (k, v) { this._attrs[k] = String(v); };
  El.prototype.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; };
  El.prototype.addEventListener = function (type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  };
  El.prototype.fire = function (type) {
    var list = this._listeners[type] || [];
    for (var i = 0; i < list.length; i++) list[i].call(this, { type: type, preventDefault: function () {} });
  };
  El.prototype.focus = function () {};
  El.prototype.querySelector = function (sel) { return matchOne(sel, this); };
  El.prototype.querySelectorAll = function (sel) { return matchAll(sel, this); };

  function matchOne(sel, root) {
    if (!sel) return null;
    if (/^[a-zA-Z]+$/.test(sel)) {
      var want = sel.toUpperCase();
      var scope = root || { children: ALL };
      for (var c = 0; c < scope.children.length; c++) if (scope.children[c].tagName === want) return scope.children[c];
      if (root) { var made = new El(want); root.appendChild(made); return made; }
      return null;
    }
    if (sel.charAt(0) === '#') {
      var parts = sel.slice(1).split(/\s+/);
      var node = REG[parts[0]];
      if (!node) return null;
      for (var i = 1; i < parts.length; i++) {
        var tag = parts[i].toUpperCase();
        var found = null;
        for (var j = 0; j < node.children.length; j++) if (node.children[j].tagName === tag) found = node.children[j];
        if (!found) { found = new El(tag); node.appendChild(found); }
        node = found;
      }
      return node;
    }
    if (sel.charAt(0) === '.') {
      var cls = sel.slice(1);
      for (var k = 0; k < ALL.length; k++) if (ALL[k]._hasClass(cls)) return ALL[k];
      return null;
    }
    var m = /^\[([a-zA-Z-]+)(?:="([^"]*)")?\]$/.exec(sel);
    if (m) {
      for (var n = 0; n < ALL.length; n++) {
        var v = ALL[n].getAttribute(m[1]);
        if (v === null) continue;
        if (m[2] !== undefined && v !== m[2]) continue;
        return ALL[n];
      }
      return null;
    }
    return null;
  }

  function matchAll(sel, root) {
    var out = [];
    if (sel.charAt(0) === '.') {
      var cls = sel.slice(1);
      for (var i = 0; i < ALL.length; i++) if (ALL[i]._hasClass(cls)) out.push(ALL[i]);
      return out;
    }
    var m = /^\[([a-zA-Z-]+)(?:="([^"]*)")?\]$/.exec(sel);
    if (m) {
      for (var j = 0; j < ALL.length; j++) {
        var val = ALL[j].getAttribute(m[1]);
        if (val === null) continue;
        if (m[2] !== undefined && val !== m[2]) continue;
        out.push(ALL[j]);
      }
      return out;
    }
    return out;
  }

  /* Build the fixture document */
  fixture.elements.forEach(function (spec) {
    var el = new El(spec.tag, spec.id, spec.cls, spec.value);
    if (spec.hidden) el.hidden = true;
    if (spec.attrs) Object.keys(spec.attrs).forEach(function (k) { el.setAttribute(k, spec.attrs[k]); });
    REG[spec.id] = el;
  });

  /* Unbound elements that app.js queries by selector */
  ['data-vendor', 'role-tab'].forEach(function () {});

  function makeSelectorOnly(cls, attrs) {
    var e = new El('button', '', cls);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
  }

  /* vendor buttons and tab buttons that only have attributes in the HTML */
  fixture.selectorElements.forEach(function (spec) {
    var e = new El(spec.tag, spec.id, spec.cls, spec.value);
    if (spec.attrs) Object.keys(spec.attrs).forEach(function (k) { e.setAttribute(k, spec.attrs[k]); });
    if (spec.id) REG[spec.id] = e;
  });

  global.document = {
    readyState: 'complete',
    body: new El('body', '', 'js-loading'),
    createElement: function (tag) { return new El(tag); },
    querySelector: function (sel) { return matchOne(sel); },
    querySelectorAll: function (sel) { return matchAll(sel); },
    addEventListener: function () {}
  };

  global.URLSearchParams = function (search) {
    var map = {};
    String(search || '').replace(/^\?/, '').split('&').forEach(function (pair) {
      if (!pair) return;
      var i = pair.indexOf('=');
      var k = i === -1 ? pair : pair.slice(0, i);
      var v = i === -1 ? '' : pair.slice(i + 1);
      if (k) map[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
    });
    this.get = function (k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; };
    this.set = function (k, v) { map[k] = String(v); };
    this.delete = function (k) { delete map[k]; };
    this.toString = function () {
      return Object.keys(map).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(map[k]); }).join('&');
    };
  };
  global.location = { search: '', pathname: '/index.html', hash: '' };
  global.history = { replaceState: function () {} };
  global.window.history = global.history;
  global.window.location = global.location;
  global.window.URLSearchParams = global.URLSearchParams;
  global.window.document = global.document;
})();
