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
  var matrices = Array.prototype.slice.call(document.querySelectorAll('table[data-rerank] tbody'));

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
  function clean(v, fallback, el) {
    var n = parseFloat(v);
    if (isNaN(n)) return fallback;
    var lo = el && el.min !== '' ? +el.min : 0;
    var hi = el && el.max !== '' ? +el.max : 100;
    return Math.min(hi, Math.max(lo, Math.round(n)));
  }

  /* Re-order any container of weighted rows: the ranked entry list, the compare
     matrix, or both. Same scores, same rules, one code path. */
  function reorder(container, sel, onEach) {
    if (!container) return null;
    var items = Array.prototype.slice.call(container.querySelectorAll(sel));
    if (!items.length) return null;
    items.forEach(function (el) { el._s = score(el, currentW); });
    items.sort(function (a, b) { return b._s - a._s; });
    applyRankingRules(items);
    items.forEach(function (el, i) {
      if (onEach) onEach(el, i);
      markMove(el, i);
      container.appendChild(el);
    });
    return items;
  }

  var currentW = null;

  /* A row that silently jumps two places reads as a row that did not move.
     Same up/down indicator the ranked cards carry, plus a brief highlight. */
  function markMove(el, i) {
    var mv = el.querySelector('.mv');
    var base = +el.dataset.baseRank;
    if (!mv || !base) return;
    var d = base - (i + 1);
    var was = mv.textContent;
    mv.className = 'mv' + (d > 0 ? ' up' : d < 0 ? ' dn' : '');
    mv.textContent = d > 0 ? '\u25B2' + d : d < 0 ? '\u25BC' + (-d) : '';
    mv.title = d === 0 ? 'unchanged from the default weighting'
      : 'moves ' + Math.abs(d) + ' place(s) ' + (d > 0 ? 'up' : 'down') + ' under your weights';
    if (was !== mv.textContent) {
      el.classList.remove('moved');
      void el.offsetWidth;            // restart the animation
      el.classList.add('moved');
    }
  }

  function rerank(w, animate) {
    currentW = w;

    matrices.forEach(function (tb) {
      reorder(tb, 'tr[data-slug]', function (row) {
        var c = row.querySelector('[data-capcell]');
        if (!c) return;                       // glance table shows sub-scores only
        c.textContent = row._s.toFixed(1);
        if (c.parentNode) c.parentNode.dataset.v = row._s.toFixed(1);
      });
    });

    if (!list) { note(w); return; }
    var items = Array.prototype.slice.call(list.querySelectorAll('.entry[data-drafting]'));
    if (!items.length) { note(w); return; }
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

    note(w, items[0]);
  }

  /* The ranked list sits below the fold, so the control has to say what changed
     or it reads as broken. */
  function note(w, top) {
    var el = document.querySelector('[data-rankednote]');
    if (!el) return;
    var d = defaults();
    var isDefault = KEYS.every(function (k) { return w[k] === d[k]; });
    if (isDefault) {
      el.textContent = 'Ranked by our default weighting. It is a default, not a verdict — drag to set your own.';
      return;
    }
    // only call out a new leader when the lead actually changed hands
    var changed = top && top.dataset.baseRank !== '1';
    var link = top && top.querySelector('h3 a');
    el.textContent = (changed && link)
      ? 'Ranked by your weights — ' + link.textContent + ' now leads. Ours is only a default.'
      : 'Ranked by your weights. Ours is only a default.';
  }

  if (bar) {
    var d = defaults();
    currentW = d;
    var saved = load(LS_W, null) || {};
    var w = {};
    KEYS.forEach(function (k) {
      w[k] = clean(saved[k], d[k], document.getElementById('w-' + k));
    });

    KEYS.forEach(function (k) {
      var el = document.getElementById('w-' + k);
      if (!el) return;
      el.value = w[k];
      var out = document.getElementById('wv-' + k);
      if (out) out.textContent = w[k] + '%';
      function apply() {
        w[k] = clean(el.value, w[k], el);
        if (out) out.textContent = w[k] + '%';
        store(LS_W, w);
        rerank(w, true);
      }
      el.addEventListener('input', apply);
      el.addEventListener('change', apply);
    });

    var reset = bar.querySelector('[data-reset]');
    if (reset) reset.addEventListener('click', function () {
      w = defaults();
      KEYS.forEach(function (k) {
        var el = document.getElementById('w-' + k); if (el) el.value = w[k];
        var out = document.getElementById('wv-' + k); if (out) out.textContent = w[k] + '%';
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
