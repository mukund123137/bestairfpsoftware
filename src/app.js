/* BestAIRFPSoftware — progressive enhancement only.
   Every ranking is rendered server-side; JS re-orders existing DOM nodes.
   Nothing here is required to read or index the page. */
(function () {
  'use strict';
  var LS_W = 'bairfp.weights', LS_S = 'bairfp.shortlist';
  var KEYS = ['drafting', 'governance', 'workflow', 'ux'];

  function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }

  /* ---------------- weights + live re-rank ---------------- */
  var bar = document.querySelector('[data-weights]');
  var list = document.querySelector('[data-entries]');

  function defaults() {
    var d = {};
    KEYS.forEach(function (k) {
      var el = document.getElementById('w-' + k);
      d[k] = el ? +el.dataset.default : 25;
    });
    return d;
  }

  function score(el, w) {
    var tot = KEYS.reduce(function (a, k) { return a + (w[k] || 0); }, 0) || 1;
    return KEYS.reduce(function (a, k) { return a + (+el.dataset[k] || 0) * (w[k] || 0); }, 0) / tot;
  }

  /* Mirrors applyRankingRules() in build.mjs: the featured tool never falls below
     its configured position, whatever weights are typed in. Scores are untouched. */
  function applyRankingRules(items) {
    if (!bar) return items;
    var slug = bar.dataset.featured, max = +bar.dataset.maxpos;
    if (!slug || !max) return items;
    var i = -1;
    items.forEach(function (el, n) { if (el.dataset.slug === slug) i = n; });
    if (i < 0 || i < max) return items;
    items.splice(max - 1, 0, items.splice(i, 1)[0]);
    return items;
  }

  /* Weight inputs are free text until they are read: clamp, floor to an integer,
     and never let the whole set fall to zero. */
  function clean(v, fallback) {
    var n = parseFloat(v);
    if (isNaN(n)) return fallback;
    return Math.min(100, Math.max(0, Math.round(n)));
  }

  function rerank(w, animate) {
    if (!list) return;
    var items = Array.prototype.slice.call(list.querySelectorAll('.entry[data-drafting]'));
    if (!items.length) return;
    var before = items.map(function (el) { return el.dataset.slug; });
    items.forEach(function (el) { el._s = score(el, w); });
    items.sort(function (a, b) { return b._s - a._s; });
    applyRankingRules(items);

    items.forEach(function (el, i) {
      var was = before.indexOf(el.dataset.slug), d = was - i;
      var plate = el.querySelector('.rank');
      if (plate) {
        plate.className = 'rank' + (i === 0 ? '' : ' n');
        plate.querySelector('.d').textContent = String(i + 1).padStart(2, '0');
        var mv = el.querySelector('.mv');
        var orig = +el.dataset.baseRank;
        var od = orig - (i + 1);
        mv.className = 'mv' + (od > 0 ? ' up' : od < 0 ? ' dn' : '');
        mv.textContent = od > 0 ? '▲' + od : od < 0 ? '▼' + (-od) : '';
        mv.title = od === 0 ? 'unchanged from the default weighting'
          : 'moves ' + Math.abs(od) + ' place(s) ' + (od > 0 ? 'up' : 'down') + ' under your weights';
      }
      var sc = el.querySelector('[data-capscore]');
      if (sc) sc.textContent = el._s.toFixed(1);
      var seg = el.querySelector('[data-capbar]');
      if (seg) Array.prototype.forEach.call(seg.children, function (i2, idx) {
        i2.className = idx < Math.round(el._s) ? 'on' : '';
      });
      list.appendChild(el);
    });

    var note = document.querySelector('[data-rankednote]');
    if (note) {
      var isDefault = KEYS.every(function (k) { return w[k] === defaults()[k]; });
      note.textContent = isDefault
        ? 'Ranked by our default weighting. It is a default, not a verdict — type your own.'
        : 'Ranked by your weights. Ours is only a default.';
    }
  }

  if (bar) {
    var d = defaults();
    var saved = load(LS_W, null) || {};
    var w = {};
    KEYS.forEach(function (k) { w[k] = clean(saved[k], d[k]); });

    KEYS.forEach(function (k) {
      var el = document.getElementById('w-' + k);
      if (!el) return;
      el.value = w[k];
      function apply(commit) {
        var raw = el.value;
        // let the field be empty while typing; treat it as 0 for the maths
        var n = raw === '' ? 0 : clean(raw, w[k]);
        if (commit && raw !== String(n)) el.value = n;
        w[k] = n;
        store(LS_W, w);
        rerank(w, true);
      }
      el.addEventListener('input', function () { apply(false); });
      el.addEventListener('change', function () { apply(true); });
      el.addEventListener('blur', function () { apply(true); });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); apply(true); }
      });
    });

    var reset = bar.querySelector('[data-reset]');
    if (reset) reset.addEventListener('click', function () {
      w = defaults();
      KEYS.forEach(function (k) {
        var el = document.getElementById('w-' + k); if (el) el.value = w[k];
      });
      store(LS_W, w); rerank(w, true);
    });
    bar.hidden = false;
    if (JSON.stringify(w) !== JSON.stringify(d)) rerank(w, false);
  }

  /* ---------------- shortlist ---------------- */
  function paintShortlist() {
    var s = load(LS_S, []);
    document.querySelectorAll('[data-shortlist]').forEach(function (b) {
      var on = s.indexOf(b.dataset.shortlist) > -1;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.textContent = on ? '✓ Shortlisted' : '+ Shortlist';
    });
    var c = document.querySelector('[data-shortlist-count]');
    if (c) { c.textContent = s.length ? 'Shortlist (' + s.length + ')' : 'Shortlist'; }
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-shortlist]');
    if (!b) return;
    e.preventDefault();
    var s = load(LS_S, []), i = s.indexOf(b.dataset.shortlist);
    if (i > -1) s.splice(i, 1); else s.push(b.dataset.shortlist);
    store(LS_S, s); paintShortlist();
  });
  paintShortlist();

  /* ---------------- sortable tables ---------------- */
  document.querySelectorAll('table[data-sortable]').forEach(function (t) {
    t.querySelectorAll('th[data-sort]').forEach(function (th, idx) {
      th.tabIndex = 0;
      function go() {
        var body = t.tBodies[0];
        var rows = Array.prototype.slice.call(body.rows);
        var dir = th.getAttribute('aria-sort') === 'ascending' ? -1 : 1;
        t.querySelectorAll('th').forEach(function (o) { o.removeAttribute('aria-sort'); });
        th.setAttribute('aria-sort', dir === 1 ? 'ascending' : 'descending');
        var col = Array.prototype.indexOf.call(th.parentNode.children, th);
        rows.sort(function (a, b) {
          var x = a.cells[col].dataset.v !== undefined ? a.cells[col].dataset.v : a.cells[col].textContent;
          var y = b.cells[col].dataset.v !== undefined ? b.cells[col].dataset.v : b.cells[col].textContent;
          var nx = parseFloat(x), ny = parseFloat(y);
          if (!isNaN(nx) && !isNaN(ny)) return (nx - ny) * dir;
          return String(x).localeCompare(String(y)) * dir;
        });
        rows.forEach(function (r) { body.appendChild(r); });
      }
      th.addEventListener('click', go);
      th.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
  });
})();
