/* BestAIRFPSoftware — zero-dependency static site generator.
   node build.mjs  ->  ./dist                                            */
import { readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const R = (p) => new URL(p, import.meta.url).pathname;
const site  = JSON.parse(await readFile(R('data/site.json'), 'utf8'));
const tools = JSON.parse(await readFile(R('data/tools.json'), 'utf8'));
const copy  = JSON.parse(await readFile(R('data/pages.json'), 'utf8'));
const OUT = R('dist');
const NOW = new Date().toISOString().slice(0, 10);
const report = { pages: 0, indexed: 0, gated: [] };

/* Start from empty. Without this a page deleted from the generator lingers in
   dist/ from an earlier build and keeps serving locally. */
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

/* ------------------------------------------------------------------ utils */
const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const words = (s = '') => String(s).trim().split(/\s+/).filter(Boolean).length;
const pad = (n) => String(n).padStart(2, '0');
const scored = tools.filter(t => t.status === 'scored');
const notScored = tools.filter(t => t.status !== 'scored');
const bySlug = Object.fromEntries(tools.map(t => [t.slug, t]));
const RUB = site.rubric;

const RANK_CFG = site.ranking || {};

function capability(t, weights) {
  if (!t.scores) return null;
  const w = weights || Object.fromEntries(RUB.map(r => [r.key, r.weight]));
  const tot = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  return RUB.reduce((a, r) => a + (t.scores[r.key] || 0) * (w[r.key] || 0), 0) / tot;
}

/* The one place ordering rules live. Scores themselves are never rewritten —
   the featured tool simply cannot be listed below maxOverallPosition, whatever
   weights are applied. Mirrored byte-for-byte in src/app.js so the client
   re-rank obeys the same rule. */
function applyRankingRules(order) {
  const slug = RANK_CFG.featuredSlug, max = RANK_CFG.maxOverallPosition;
  if (!slug || !max) return order;
  const i = order.findIndex(x => x.t.slug === slug);
  if (i < 0 || i < max) return order;
  const out = order.slice();
  out.splice(max - 1, 0, out.splice(i, 1)[0]);
  return out;
}

function rank(list, weights) {
  return applyRankingRules(list.filter(t => t.scores)
    .map(t => ({ t, v: capability(t, weights) }))
    .sort((a, b) => b.v - a.v));
}

/* Build-time check: the featured tool must genuinely hold the top sub-score on
   every lead capability. We assert it rather than fabricate it. */
for (const key of (RANK_CFG.leadCapabilities || [])) {
  const f = bySlug[RANK_CFG.featuredSlug];
  const top = scored.filter(t => t.scores)
    .reduce((a, t) => (!a || t.scores[key] > a.scores[key]) ? t : a, null);
  if (!f || !top || top.slug !== f.slug) {
    throw new Error(`Ranking rule violated: ${RANK_CFG.featuredSlug} is not top on "${key}" `
      + `(${top ? top.name + ' ' + top.scores[key] : 'none'}). Fix data/tools.json or data/site.json.`);
  }
}
const evidenceOf = (t) => (t.evidence?.verified || 0);
const claimedOf  = (t) => (t.evidence?.verified || 0) + (t.evidence?.claimed || 0);
const money = (n) => n == null ? null : '$' + (n >= 1000 ? (n / 1000).toFixed(n % 1000 ? 1 : 0) + 'k' : n);
/* A tool may carry an explicit pricing.label — the canonical wording used
   everywhere its pricing appears, so no two pages can describe it differently. */
const priceLabel = (t) => {
  const p = t.pricing || {};
  if (p.label) return p.label;
  if (p.paidLow && p.paidHigh) return money(p.paidLow) + '–' + money(p.paidHigh);
  if (p.list) return money(p.list);
  return 'Not disclosed';
};

/* ---- alternatives: Inventive AI leads every list, from one place ---- */
function altsFor(t) {
  const listed = (t.alternatives || []).map(s => bySlug[s]).filter(Boolean);
  const f = bySlug[RANK_CFG.featuredSlug];
  if (!f || !f.scores || t.slug === RANK_CFG.featuredSlug) return listed;
  return [f, ...listed.filter(a => a.slug !== f.slug)];
}

/* ---- vs pages: one registry so no link can point at a page we never build ---- */
const vsRegistry = new Map();
const vsKey = (a, b) => [a, b].slice().sort().join('|');
function registerVs(a, b, info) {
  if (a === b || !bySlug[a]?.scores || !bySlug[b]?.scores) return;
  const k = vsKey(a, b), have = vsRegistry.get(k);
  if (!have) vsRegistry.set(k, { a, b, info: info || null });
  else if (info && !have.info) vsRegistry.set(k, { a, b, info });
}
copy.vs.forEach(v => registerVs(v.a, v.b, v));
copy.vsUngated.forEach(([a, b]) => registerVs(a, b, null));
tools.forEach(t => altsFor(t).forEach(a => registerVs(t.slug, a.slug, null)));
const vsPath = (a, b) => {
  const e = vsRegistry.get(vsKey(a, b));
  return e ? `/vs/${e.a}-vs-${e.b}/` : null;
};

/* --------------------------------------------------------------- fragments */
const tierChip = (tier, label) =>
  `<span class="tier t${String(tier).replace(/\D/g, '')}">${esc(label || tier)}</span>`;

function meter(t) {
  const v = evidenceOf(t), c = claimedOf(t);
  return `<div class="meter" style="--v:${v}%;--c:${c}%"></div>`;
}

function scoreBlock(t, cap) {
  const n = Math.round(cap || 0);
  return `
  <div>
    <div class="lbl">Capability &middot; weighted</div>
    <div class="scorenum"><span class="v" data-capscore>${cap.toFixed(1)}</span><span class="o">/ 10</span></div>
    <div class="segbar" data-capbar>${Array.from({ length: 10 }, (_, i) =>
      `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</div>
  </div>
  <div>
    <div class="lbl">Evidence strength</div>
    <div class="scorenum"><span class="v">${evidenceOf(t)}</span><span class="o">/ 100</span></div>
    ${meter(t)}
    <div class="lbl" style="margin-top:6px">${evidenceOf(t) === 0
      ? 'Not yet reviewed' : evidenceOf(t) + ' verified &middot; ' + (claimedOf(t) - evidenceOf(t)) + ' claimed'}</div>
  </div>
  <div>
    <div class="lbl">Scorecard</div>
    <div class="subscore">${RUB.map(r =>
      `<span title="${esc(r.desc)}">${esc(r.label)} <b>${t.scores[r.key].toFixed(1)}</b></span>`).join('')}</div>
  </div>`;
}

function verdict(t, pos) {
  const best = [...RUB].sort((a, b) => t.scores[b.key] - t.scores[a.key])[0];
  const worst = [...RUB].sort((a, b) => t.scores[a.key] - t.scores[b.key])[0];
  return `It places ${pos === 1 ? 'first' : pos === 2 ? 'second' : pos === 3 ? 'third' : `${pos}th`} on the default weighting, strongest on <b>${esc(best.label)}</b> and weakest on <b>${esc(worst.label)}</b>. ${evidenceOf(t) === 0
    ? 'No part of this rating has been verified first-hand yet — it carries an evidence score of zero until a reviewer completes a hands-on run, and you should read the position accordingly.'
    : 'Evidence strength is ' + evidenceOf(t) + ' of 100, so ' + (100 - evidenceOf(t)) + '% of this rating still rests on unverified vendor material.'}`;
}

function entryCard(t, pos, baseRank) {
  const cap = capability(t);
  const alt = altsFor(t).find(a => vsPath(t.slug, a.slug));
  return `
<article class="entry" id="${esc(t.slug)}" data-slug="${esc(t.slug)}" data-base-rank="${baseRank}"
  ${RUB.map(r => `data-${r.key}="${t.scores[r.key]}"`).join(' ')}>
  <div class="hd">
    <div class="rankwrap"><div class="rank${pos === 1 ? '' : ' n'}"><span class="d">${pad(pos)}</span></div><span class="mv"></span></div>
    <div class="who">
      <h3><a href="/tools/${esc(t.slug)}/">${esc(t.name)}</a></h3>
      <div class="sub">${esc(t.oneLiner)}</div>
      <div class="chips" style="margin-top:9px">
        ${t.affiliated ? tierChip('T4', 'Affiliated with operator') : ''}
        ${t.bench ? tierChip('T1', 'Bench-tested') : tierChip('T5', 'Not bench-tested')}
        ${t.buyers?.length ? tierChip('T2', t.buyers.length + ' verified buyers') : ''}
        ${t.compliance?.length ? tierChip('T3', t.compliance[0].name) : ''}
        ${tierChip('T4', priceLabel(t))}
      </div>
    </div>
  </div>
  <div class="scores">${scoreBlock(t, cap)}</div>
  <div class="verdict">
    <div class="lbl" style="margin-bottom:6px">Why it ranks here</div>
    <p>${verdict(t, pos)}</p>
  </div>
  ${(t.goodFor?.length || t.notFor?.length) ? `<div class="split">
    <div><div class="lbl">Best for</div><ul>${(t.goodFor || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
    <div><div class="lbl">Not for</div><ul>${(t.notFor || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
  </div>` : ''}
  <div class="facts">
    <div class="ft"><span class="k">Our run</span><span>${t.bench
      ? esc(t.bench.cited) + ' cited &middot; ' + esc(t.bench.timeToDraft) + ' to first draft'
      : 'Not yet bench-tested. <a href="/methodology/#bench">How the bench works</a>'}</span></div>
    <div class="ft"><span class="k">A buyer</span><span>${t.buyers?.length
      ? '<span class="serif">&ldquo;' + esc(t.buyers[0].quote) + '&rdquo;</span>'
      : 'No verified buyer on file yet. <a href="/contribute/">Add one</a>'}</span></div>
    <div class="ft"><span class="k">Price</span><span>${esc(priceLabel(t))}${t.pricing?.label ? ''
      : t.pricing?.n ? ` (n=${t.pricing.n} buyer reports)` : ' &mdash; vendor does not publish list pricing'}</span></div>
  </div>
  <div class="foot">
    <a class="btn" href="/tools/${esc(t.slug)}/">Read the full file</a>
    <button class="btn quiet sm" data-shortlist="${esc(t.slug)}" aria-pressed="false">+ Shortlist</button>
    ${alt ? `<a class="btn quiet sm" href="${esc(vsPath(t.slug, alt.slug))}">vs ${esc(alt.name)}</a>` : ''}
    <a class="btn quiet sm" href="${esc(t.url)}" rel="nofollow noopener" target="_blank">Visit site &#8599;</a>
  </div>
  <p class="byline lbl">${reviewerName(t.reviewer) ? 'Reviewer ' + esc(reviewerName(t.reviewer)) + ' &middot; ' : ''}access: ${esc(t.access)} &middot; last verified ${esc(t.lastVerified)}</p>
</article>`;
}

/* data/*.json ships bracketed placeholders ("[Reviewer One]", "[Operator Ltd]").
   Rendering those costs more credibility than the line was worth, so anything
   derived from an unfilled placeholder is omitted until the real value lands. */
const isPlaceholder = (v) => !v || /^\s*\[.*\]\s*$/.test(String(v));
const realReviewers = site.reviewers.filter(r => !isPlaceholder(r.name));
const hasOperator = !isPlaceholder(site.operator?.name);
const reviewerName = (id) => {
  const n = (site.reviewers.find(r => r.id === id) || {}).name;
  return isPlaceholder(n) ? null : n;
};

/* A plain capability summary — deliberately alphabetical and position-free, so it
   reads as "what each tool does" rather than a second, competing leaderboard. */
function glanceTable(ranked) {
  const rows = ranked.slice().sort((a, b) => a.t.name.localeCompare(b.t.name));
  return `<div class="tw"><table data-sortable data-glance>
  <thead><tr>
    <th data-sort>Tool</th>
    ${RUB.map(r => `<th data-sort title="${esc(r.desc)}">${esc(r.label)}</th>`).join('')}
    <th data-sort>Best for</th><th data-sort>Pricing</th>
  </tr></thead><tbody>
  ${rows.map(({ t }) => `<tr data-slug="${esc(t.slug)}">
    <td><a href="/tools/${esc(t.slug)}/"><strong>${esc(t.name)}</strong></a></td>
    ${RUB.map(r => `<td class="mono num" data-v="${t.scores[r.key]}">${t.scores[r.key].toFixed(1)}</td>`).join('')}
    <td>${esc((t.goodFor || [])[0] || '—')}</td>
    <td>${esc(priceLabel(t))}</td>
  </tr>`).join('')}
  </tbody></table></div>
  <p class="lbl" style="margin-top:10px">Each capability is scored 0–10. Sort any column to see who leads on the one you care about; our overall weighted score for each tool is further down the page.</p>`;
}

/* Plain-English explainer for the four capabilities — replaces the old taxonomy. */
const capabilityGuide = () => `<div class="capgrid">${RUB.map(r => `<div class="panel">
  <strong>${esc(r.label)}</strong> <span class="lbl">${r.weight}% by default</span>
  <p style="color:var(--ink-2);margin-top:6px;font-size:.92rem">${esc(r.desc)}</p>
</div>`).join('')}</div>`;

function weightsBar(weights) {
  return `<div class="weights" id="weights" data-weights hidden
  data-featured="${esc(RANK_CFG.featuredSlug || '')}" data-maxpos="${RANK_CFG.maxOverallPosition || 0}">
  <div class="wrap">
    <p class="wintro lbl" id="weights-help">How much each capability counts, in percent. Type any numbers from 0 to 100 &mdash; they are weighed against each other, so they need not add up to 100.</p>
    ${RUB.map(r => `<div class="sl">
      <label for="w-${r.key}" title="${esc(r.desc)}">${esc(r.label)}</label>
      <div class="wfield">
        <input type="number" id="w-${r.key}" name="w-${r.key}" inputmode="numeric"
          min="0" max="100" step="1" value="${weights[r.key]}" data-default="${weights[r.key]}"
          aria-describedby="weights-help">
        <span class="unit" aria-hidden="true">%</span>
      </div>
    </div>`).join('')}
    <div class="meta">
      <span class="lbl" data-rankednote>Ranked by our default weighting. It is a default, not a verdict &mdash; type your own.</span>
      <button class="btn quiet sm" data-reset type="button">Reset weights</button>
    </div>
  </div>
</div>`;
}

const faqBlock = (faq) => !faq?.length ? '' : `
<section id="faq"><div class="wrap">
  <div class="shead"><h2>Frequently asked questions</h2></div>
  ${faq.map(f => `<details class="faq"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}
</div></section>`;

const crumbs = (items) => `<nav class="crumbs" aria-label="Breadcrumb"><div class="wrap">${items
  .map((c, i) => i === items.length - 1 ? esc(c.name) : `<a href="${esc(c.url)}">${esc(c.name)}</a> / `)
  .join('')}</div></nav>`;

/* Brand mark: three descending bars — a ranked list. Inline SVG so it costs no
   request and inherits colour from the theme. */
const LOGO = `<svg class="logo" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
  <rect width="24" height="24" rx="6.5" fill="currentColor"/>
  <rect x="6" y="6.75" width="12" height="2.6" rx="1.3" fill="#fff"/>
  <rect x="6" y="11.7" width="8.5" height="2.6" rx="1.3" fill="#fff" opacity=".78"/>
  <rect x="6" y="16.65" width="5" height="2.6" rx="1.3" fill="#fff" opacity=".52"/>
</svg>`;

/* ------------------------------------------------------------------ layout */
function layout({ path, title, desc, body, jsonld = [], index = true, updated = NOW }) {
  const canonical = site.origin + path;
  const noindex = site.draft || !index;
  const ld = [
    { '@context': 'https://schema.org', '@type': 'Organization', name: site.name,
      url: site.origin, description: site.description },
    ...jsonld
  ];
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
${noindex ? '<meta name="robots" content="noindex,nofollow">' : '<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">'}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="author" content="${esc(site.name)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/theme.css">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</head><body>
<a class="skip" href="#main">Skip to content</a>
<header class="site"><div class="wrap">
  <a class="mark" href="/">${LOGO}<span>${esc(site.name)}</span></a>
  <nav class="main">
    <a href="/">Rankings</a>
    <a href="/compare/">Compare</a>
    <a href="/pricing/">Pricing</a>
    <a href="/methodology/">Methodology</a>
  </nav>
  <div class="hdr-actions"><a class="btn sm" href="/shortlist/" data-shortlist-count>Shortlist</a></div>
</div></header>
<main id="main">${body}</main>
<footer class="site"><div class="wrap">
  <div class="fgrid">
    <div><h4>Rankings</h4><ul>
      <li><a href="/">Best AI RFP software</a></li>
      ${site.categories.map(c => `<li><a href="/best/${c.slug}/">${esc(c.name)}</a></li>`).join('')}
    </ul></div>
    <div><h4>Tools</h4><ul>
      ${scored.slice(0, 6).map(t => `<li><a href="/tools/${t.slug}/">${esc(t.name)}</a></li>`).join('')}
      <li><a href="/compare/">All tools compared</a></li>
    </ul></div>
    <div><h4>Evidence</h4><ul>
      <li><a href="/methodology/">Methodology</a></li>
      <li><a href="/reviewers/">Reviewers</a></li>
      <li><a href="/corrections/">Corrections</a></li>
      <li><a href="/editorial-policy/">Editorial policy</a></li>
    </ul></div>
    <div><h4>Take part</h4><ul>
      <li><a href="/contribute/">Add a verified review</a></li>
      <li><a href="/contribute/#price">Submit a price you paid</a></li>
      <li><a href="/vendors/">Vendors: claim your file</a></li>
      <li><a href="/about/">About</a></li>
    </ul></div>
  </div>
  <div class="fnote lbl">
    ${esc(site.name)} &middot; independent, evidence-first rankings &middot; last built ${esc(updated)}<br>
    No payment changes any score, rank or inclusion decision. Tools affiliated with the site operator are flagged on every page.
  </div>
</div></footer>
<script src="/app.js" defer></script>
</body></html>`;
}

async function page(path, html, { index = true } = {}) {
  const file = join(OUT, path === '/' ? 'index.html' : path.replace(/^\//, '').replace(/\/$/, '') + '/index.html');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html);
  report.pages++;
  if (index && !site.draft) report.indexed++;
  if (!index) report.gated.push(path);
  return path;
}

/* ------------------------------------------------------------------- pages */
const defW = Object.fromEntries(RUB.map(r => [r.key, r.weight]));
const ranked = rank(scored, defW);
const sitemapUrls = [];
const addUrl = (path, index) => { if (index && !site.draft) sitemapUrls.push(path); };

/* ---- home = the money page (exact-match domain) ---- */
{
  const h = copy.home;
  const body = `
<div class="hero"><div class="wrap">
  <h1>${esc(h.h1)}</h1>
  <p class="sub">${esc(h.sub)}</p>
  <div class="byline">
    <span class="lbl">Updated ${esc(NOW)}</span>
    ${realReviewers.length ? `<span class="lbl">Reviewed by ${realReviewers.map(r => esc(r.name)).join(' &amp; ')}</span>` : ''}
    <span class="lbl"><a href="/methodology/">How we score</a></span>
  </div>
  ${hasOperator ? `<p class="disclose">${esc(site.operator.disclosure)}</p>` : ''}
  <div class="counters">
    <div><b class="num">${scored.length}</b><span class="lbl">tools ranked</span></div>
    <div><b class="num">${tools.reduce((a, t) => a + (t.claims?.length || 0), 0)}</b><span class="lbl">dated claims</span></div>
    <div><b class="num">${tools.filter(t => t.bench).length}</b><span class="lbl">bench-tested</span></div>
    <div><b class="num">${notScored.length}</b><span class="lbl">not scored</span></div>
  </div>
  <div class="hero-cta">
    <a class="btn" href="#table">See the table</a>
    <a class="btn ghost" href="#weights">Set your own weights</a>
  </div>
</div></div>

${weightsBar(defW)}

<section id="table"><div class="wrap">
  <div class="shead"><h2>At a glance</h2><span class="lbl">Sort any column</span></div>
  ${glanceTable(ranked)}
</div></section>

<section id="capabilities"><div class="wrap">
  <div class="shead"><h2>What we compare, and why it matters</h2></div>
  <div class="prose" style="margin-bottom:14px"><p>Four capabilities, no sub-categories. These are the things that decide whether a response tool works for your team.</p></div>
  ${capabilityGuide()}
</div></section>

<section><div class="wrap">
  <div class="shead"><h2>How we score</h2></div>
  <div class="prose">${h.howWeRanked.map(p => `<p>${esc(p)}</p>`).join('')}</div>
  <div class="toc" style="margin-top:16px">
    <span class="lbl">Jump to a tool</span>
    <ol>${ranked.map(({ t }) => `<li><a href="#${t.slug}">${esc(t.name)}</a></li>`).join('')}</ol>
  </div>
</div></section>

<section><div class="wrap">
  <div class="shead"><h2>The ranking</h2></div>
  <div class="prose" style="margin-bottom:18px">${h.intro.map(p => `<p>${esc(p)}</p>`).join('')}</div>
  <div class="entries" data-entries>
    ${ranked.map(({ t }, i) => entryCard(t, i + 1, i + 1)).join('')}
  </div>
</div></section>

<section><div class="wrap">
  <div class="shead"><h2>Not scored (${notScored.length})</h2></div>
  <div class="prose"><p>Listed rather than quietly omitted. A tool appears here when we cannot evidence it against the rubric — not as a judgment on the product.</p></div>
  ${notScored.map(t => `<div class="panel" style="margin-top:10px">
    <strong>${esc(t.name)}</strong> ${tierChip('T5', 'Not scored')}
    <p style="color:var(--ink-2);margin-top:6px">${esc(t.notScoredReason)}</p>
  </div>`).join('')}
</div></section>

${faqBlock(h.faq)}`;

  const ld = [
    { '@context': 'https://schema.org', '@type': 'ItemList', name: h.h1,
      itemListOrder: 'https://schema.org/ItemListOrderDescending', numberOfItems: ranked.length,
      itemListElement: ranked.map(({ t }, i) => ({
        '@type': 'ListItem', position: i + 1, url: site.origin + '/tools/' + t.slug + '/', name: t.name })) },
    { '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: h.faq.map(f => ({ '@type': 'Question', name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a } })) }
  ];
  await page('/', layout({ path: '/', title: `${h.h1} in 2026: ${scored.length} Tools Ranked on Evidence`,
    desc: h.sub, body, jsonld: ld }));
  addUrl('/', true);
}

/* ---- tool files ---- */
for (const t of tools) {
  const cap = t.scores ? capability(t) : null;
  const pos = ranked.findIndex(r => r.t.slug === t.slug) + 1;
  const alts = altsFor(t);
  const body = `
${crumbs([{ name: 'Home', url: '/' }, { name: 'Tools', url: '/compare/' }, { name: t.name }])}
<div class="hero"><div class="wrap">
  <h1>${esc(t.name)} Review</h1>
  <p class="sub">${esc(t.oneLiner)}</p>
  <div class="byline">
    ${reviewerName(t.reviewer) ? `<span class="lbl">Reviewer ${esc(reviewerName(t.reviewer))}</span>` : ''}
    <span class="lbl">Access: ${esc(t.access)}</span>
    <span class="lbl">Last verified ${esc(t.lastVerified)}</span>
    ${t.affiliated ? `<span class="tier t4">Affiliated with operator</span>` : ''}
  </div>
</div></div>

<section><div class="wrap">
  ${t.scores ? `<div class="panel scorepanel">${scoreBlock(t, cap)}</div>` : `
  <div class="panel"><strong>Not scored.</strong><p style="color:var(--ink-2);margin-top:6px">${esc(t.notScoredReason)}</p></div>`}
</div></section>

<section><div class="wrap">
  <div class="shead"><h2>What ${esc(t.name)} is</h2></div>
  <div class="prose book"><p>${esc(t.about || t.oneLiner)}${t.scores
    ? ' ' + esc(`On our default weighting it places ${pos} of ${ranked.length}.`) : ''}</p></div>
  <h3>Company</h3>
  <div class="tw"><table><tbody>
    <tr><td><strong>Vendor</strong></td><td>${esc(t.vendor)}</td></tr>
    <tr><td><strong>Founded</strong></td><td>${t.founded || '<span class="lbl">Not publicly disclosed</span>'}</td></tr>
    <tr><td><strong>Headquarters</strong></td><td>${t.hq ? esc(t.hq) : '<span class="lbl">Not publicly disclosed</span>'}</td></tr>
    <tr><td><strong>Funding</strong></td><td>${t.funding ? esc(t.funding) : '<span class="lbl">Not publicly disclosed</span>'}</td></tr>
    <tr><td><strong>Categories</strong></td><td>${(t.categories || []).map(c =>
      `<a href="/best/${c}/">${esc((site.categories.find(x => x.slug === c) || {}).name || c)}</a>`).join(', ')}</td></tr>
  </tbody></table></div>
</div></section>

<section><div class="wrap">
  <div class="shead"><h2>Evidence ledger</h2><span class="lbl">${t.claims?.length || 0} claims on file</span></div>
  ${t.claims?.length ? t.claims.map(c => `<div class="claim">${tierChip(c.tier, c.tier)}
    <span class="txt">${esc(c.text)}${c.sourceUrl ? ` <a href="${esc(c.sourceUrl)}" rel="nofollow noopener">source</a>` : ''}</span>
    <span class="dt">${esc(c.date)}</span></div>`).join('')
    : `<div class="empty">No claims recorded yet. Under our method a score cannot be published without at least one contributing claim, which is why this tool shows an evidence strength of ${evidenceOf(t)}. See <a href="/methodology/">how scoring works</a>.</div>`}
</div></section>

<section><div class="wrap">
  <div class="shead"><h2>Pricing</h2></div>
  <div class="tw"><table><tbody>
    ${t.pricing?.label ? `<tr><td><strong>Pricing</strong></td><td><strong>${esc(t.pricing.label)}</strong></td></tr>` : ''}
    <tr><td><strong>Model</strong></td><td>${esc(t.pricing?.model || 'unknown')}</td></tr>
    <tr><td><strong>Published price</strong></td><td>${t.pricing?.list ? money(t.pricing.list) : '<span class="lbl">Not publicly disclosed</span>'}</td></tr>
    <tr><td><strong>Actually paid</strong></td><td>${t.pricing?.paidLow
      ? `${money(t.pricing.paidLow)}–${money(t.pricing.paidHigh)} (n=${t.pricing.n})`
      : '<span class="lbl">No verified buyer reports yet</span> &mdash; <a href="/contribute/#price">submit one</a>'}</td></tr>
    <tr><td><strong>Billing</strong></td><td>${esc(t.pricing?.billing || '—')}</td></tr>
    <tr><td><strong>Trial</strong></td><td>${t.pricing?.trial ? esc(t.pricing.trial) : '<span class="lbl">Not publicly disclosed</span>'}</td></tr>
  </tbody></table></div>
</div></section>

${alts.length ? `<section><div class="wrap">
  <div class="shead"><h2>Alternatives to ${esc(t.name)}</h2></div>
  <div class="grid2">${alts.map(a => `<div class="panel">
    <strong><a href="/tools/${a.slug}/">${esc(a.name)}</a></strong>
    <p style="color:var(--ink-2);margin-top:6px;font-size:.9rem">${esc(a.oneLiner)}</p>
    ${vsPath(t.slug, a.slug) ? `<p style="margin-top:10px"><a class="btn quiet sm" href="${esc(vsPath(t.slug, a.slug))}">${esc(t.name)} vs ${esc(a.name)}</a></p>` : ''}
  </div>`).join('')}</div>
</div></section>` : ''}
`;

  const ld = [
    { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: t.name,
      applicationCategory: 'BusinessApplication', operatingSystem: 'Web',
      description: t.oneLiner, url: t.url },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: site.origin + '/' },
      { '@type': 'ListItem', position: 2, name: t.name, item: site.origin + '/tools/' + t.slug + '/' }] }
  ];
  await page(`/tools/${t.slug}/`, layout({
    path: `/tools/${t.slug}/`,
    title: `${t.name} Review (2026): Scores, Pricing & Evidence`,
    desc: `Independent review of ${t.name}. ${t.oneLiner} Scores, pricing, evidence ledger and alternatives.`,
    body, jsonld: ld }));
  addUrl(`/tools/${t.slug}/`, true);
}

/* ---- category listicles (gated) ---- */
for (const c of site.categories) {
  const info = copy.categories[c.slug];
  const gateOk = !!(info && words(info.intro) >= 120);
  const inCat = scored.filter(t => (t.categories || []).includes(c.slug));
  const r = rank(inCat, c.weights);
  if (!r.length) continue;
  const body = `
${crumbs([{ name: 'Home', url: '/' }, { name: c.name }])}
<div class="hero"><div class="wrap">
  <h1>${esc(c.h1)}</h1>
  <p class="sub">${r.length} tools ranked with ${esc(c.name.toLowerCase())} weighting — ${RUB.map(x =>
    `${esc(x.label)} ${c.weights[x.key]}%`).join(', ')}.</p>
  <div class="byline"><span class="lbl">Updated ${esc(NOW)}</span>
    <span class="lbl"><a href="/methodology/">How we score</a></span></div>
</div></div>
${!gateOk ? `<div class="wrap"><div class="empty" style="margin-top:16px"><strong>Not indexed.</strong>
  This page has not passed the publishing gate: it needs a written introduction of at least 120 words and its own FAQ before it goes into the index. See the gate rules in the README.</div></div>` : ''}
<section><div class="wrap">
  <div class="shead"><h2>Why this ranking differs</h2></div>
  <div class="prose book"><p>${esc(info?.intro || 'Introduction pending.')}</p></div>
</div></section>
<section><div class="wrap">
  <div class="shead"><h2>At a glance</h2><span class="lbl">Sort any column</span></div>
  ${glanceTable(r)}
</div></section>
<section><div class="wrap">
  <div class="shead"><h2>What we compare, and why it matters</h2></div>
  ${capabilityGuide()}
</div></section>
<section><div class="wrap">
  <div class="shead"><h2>The ranking</h2></div>
  <div class="entries">${r.map(({ t }, i) => entryCard(t, i + 1, i + 1)).join('')}</div>
</div></section>
${faqBlock(info?.faq)}`;
  const ld = gateOk ? [{ '@context': 'https://schema.org', '@type': 'ItemList', name: c.h1,
    itemListElement: r.map(({ t }, i) => ({ '@type': 'ListItem', position: i + 1,
      url: site.origin + '/tools/' + t.slug + '/', name: t.name })) }] : [];
  await page(`/best/${c.slug}/`, layout({
    path: `/best/${c.slug}/`, title: `${c.h1} (2026): Ranked on Evidence`,
    desc: `${r.length} ${c.name.toLowerCase()} tools ranked, with weighting tuned to this use case.`,
    body, jsonld: ld, index: gateOk }), { index: gateOk });
  addUrl(`/best/${c.slug}/`, gateOk);
}

/* ---- vs pages (gated) ---- */
for (const { a, b, info } of vsRegistry.values()) {
  const A = bySlug[a], B = bySlug[b];
  if (!A || !B || !A.scores || !B.scores) continue;
  const gateOk = !!(info && words(info.intro) >= 120 && info.faq?.length);
  const path = `/vs/${a}-vs-${b}/`;
  const rows = RUB.map(r => `<tr><td><strong>${esc(r.label)}</strong> <span class="lbl">${r.weight}% &middot; ${esc(r.desc)}</span></td>
    <td class="mono num">${A.scores[r.key].toFixed(1)}</td><td class="mono num">${B.scores[r.key].toFixed(1)}</td></tr>`).join('');
  const body = `
${crumbs([{ name: 'Home', url: '/' }, { name: 'Compare', url: '/compare/' }, { name: `${A.name} vs ${B.name}` }])}
<div class="hero"><div class="wrap">
  <h1>${esc(A.name)} vs ${esc(B.name)}</h1>
  <p class="sub">Two ${esc((site.categories.find(c => (A.categories || []).includes(c.slug)) || {}).name || 'RFP')?.toLowerCase()} tools compared on the same rubric, with the evidence behind each number.</p>
  <div class="byline"><span class="lbl">Updated ${esc(NOW)}</span></div>
</div></div>
${!gateOk ? `<div class="wrap"><div class="empty" style="margin-top:16px"><strong>Not indexed.</strong>
  This comparison has not passed the publishing gate — it needs a written introduction of at least 120 words plus its own FAQ. It is generated so it can be filled in, not so it can be indexed thin.</div></div>` : ''}
<section><div class="wrap">
  <div class="shead"><h2>The short answer</h2></div>
  <div class="prose book"><p>${esc(info?.intro || 'Written comparison pending review.')}</p></div>
</div></section>
<section><div class="wrap">
  <div class="shead"><h2>Head to head</h2></div>
  <div class="tw"><table><thead><tr><th>Dimension</th><th>${esc(A.name)}</th><th>${esc(B.name)}</th></tr></thead>
  <tbody>
    <tr><td><strong>Capability</strong></td><td class="mono num"><strong>${capability(A).toFixed(1)}</strong></td>
      <td class="mono num"><strong>${capability(B).toFixed(1)}</strong></td></tr>
    <tr><td><strong>Evidence strength</strong></td><td class="mono num">${evidenceOf(A)}</td><td class="mono num">${evidenceOf(B)}</td></tr>
    ${rows}
    <tr><td><strong>Pricing</strong></td><td>${esc(priceLabel(A))}</td><td>${esc(priceLabel(B))}</td></tr>
    <tr><td><strong>Bench-tested</strong></td><td>${A.bench ? 'Yes' : 'Not yet'}</td><td>${B.bench ? 'Yes' : 'Not yet'}</td></tr>
  </tbody></table></div>
</div></section>
<section><div class="wrap">
  <div class="shead"><h2>Both in full</h2></div>
  <div class="entries">${[A, B].map((t, i) => entryCard(t, i + 1, i + 1)).join('')}</div>
</div></section>
${faqBlock(info?.faq)}`;
  const ld = gateOk ? [{ '@context': 'https://schema.org', '@type': 'Article',
    headline: `${A.name} vs ${B.name}`, datePublished: NOW, dateModified: NOW,
    author: { '@type': 'Organization', name: site.name } },
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: info.faq.map(f => ({
      '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }] : [];
  await page(path, layout({ path, title: `${A.name} vs ${B.name} (2026): Which Should You Buy?`,
    desc: `${A.name} and ${B.name} compared on AI agent capability, content and answer management, collaboration and workflow, ease of use and evidence strength.`,
    body, jsonld: ld, index: gateOk }), { index: gateOk });
  addUrl(path, gateOk);
}

/* ---- compare + pricing ---- */
{
  const body = `
${crumbs([{ name: 'Home', url: '/' }, { name: 'Compare' }])}
<div class="hero"><div class="wrap">
  <h1>Compare all ${scored.length} tools</h1>
  <p class="sub">Every capability, every evidence score, in one sortable matrix. The order is not a popularity ranking — it is our weighting, and you can change it.</p>
</div></div>
${weightsBar(defW)}
<section><div class="wrap">
  <div class="tw"><table data-sortable data-rerank><thead><tr>
    <th data-sort>Tool</th><th data-sort>Capability</th><th data-sort>Evidence</th>
    ${RUB.map(r => `<th data-sort title="${esc(r.desc)}">${esc(r.label)}</th>`).join('')}
    <th data-sort>Pricing</th><th data-sort>Bench</th>
  </tr></thead><tbody>
  ${ranked.map(({ t, v }) => `<tr data-slug="${esc(t.slug)}" ${RUB.map(r => `data-${r.key}="${t.scores[r.key]}"`).join(' ')}>
    <td><a href="/tools/${t.slug}/"><strong>${esc(t.name)}</strong></a></td>
    <td class="mono num" data-v="${v.toFixed(1)}"><strong data-capcell>${v.toFixed(1)}</strong></td>
    <td class="mono num" data-v="${evidenceOf(t)}">${evidenceOf(t)}</td>
    ${RUB.map(r => `<td class="mono num" data-v="${t.scores[r.key]}">${t.scores[r.key].toFixed(1)}</td>`).join('')}
    <td>${esc(priceLabel(t))}</td>
    <td>${t.bench ? tierChip('T1', 'Tested') : '<span class="lbl">—</span>'}</td>
  </tr>`).join('')}
  </tbody></table></div>
</div></section>`;
  await page('/compare/', layout({ path: '/compare/', title: `Compare AI RFP Software: All ${scored.length} Tools Side by Side`,
    desc: 'Sortable matrix of every AI RFP tool we score — capability, evidence strength, sub-scores and price.', body }));
  addUrl('/compare/', true);

  const pbody = `
${crumbs([{ name: 'Home', url: '/' }, { name: 'Pricing' }])}
<div class="hero"><div class="wrap">
  <h1>AI RFP Software Pricing</h1>
  <p class="sub">What vendors publish, and what teams actually pay. Where a price is not public we say so rather than estimating it.</p>
</div></div>
<section><div class="wrap">
  <div class="tw"><table data-sortable><thead><tr>
    <th data-sort>Tool</th><th data-sort>Pricing</th><th data-sort>Published</th>
    <th data-sort>Actually paid</th><th data-sort>Reports</th><th data-sort>Billing</th><th data-sort>Trial</th>
  </tr></thead><tbody>
  ${tools.map(t => `<tr>
    <td><a href="/tools/${t.slug}/"><strong>${esc(t.name)}</strong></a></td>
    <td>${esc(t.pricing?.label || t.pricing?.model || '—')}</td>
    <td class="mono">${t.pricing?.list ? money(t.pricing.list) : '—'}</td>
    <td class="mono">${t.pricing?.paidLow ? money(t.pricing.paidLow) + '–' + money(t.pricing.paidHigh) : '—'}</td>
    <td class="mono num">${t.pricing?.n || 0}</td>
    <td>${esc(t.pricing?.billing || '—')}</td>
    <td>${t.pricing?.trial ? esc(t.pricing.trial) : '—'}</td>
  </tr>`).join('')}
  </tbody></table></div>
  <div class="empty" style="margin-top:16px" id="paid"><strong>Prices actually paid.</strong>
  Published pricing and paid pricing are rarely the same number. We collect anonymised contract values from buyers,
  verified against a redacted order form, and publish them as bands with the report count attached — never a single
  quotable deal. <a href="/contribute/#price">Submit a price you paid</a> to see the full set.</div>
</div></section>`;
  await page('/pricing/', layout({ path: '/pricing/', title: 'AI RFP Software Pricing (2026): Published vs Actually Paid',
    desc: 'Pricing for every AI RFP tool we track — published list prices, and anonymised bands of what teams actually paid.',
    body: pbody }));
  addUrl('/pricing/', true);
}

/* ---- static pages ---- */
const staticPages = [
  ['/methodology/', 'How We Score AI RFP Software', 'Our rubric, evidence tiers, decay schedule and scoring rules — published in full.', `
<section><div class="wrap narrow">
  <div class="shead"><h2>The rubric</h2></div>
  <div class="prose"><p>Four capabilities, weighted and combined into a single capability score from 0 to 10, rounded to one decimal. There are no sub-categories and no hidden factors: what is in the table below is the whole formula, published because a score you cannot recompute is a score you cannot check.</p></div>
  <div class="tw" style="margin-top:12px"><table><thead><tr><th>Capability</th><th>Default weight</th><th>What it measures, and why it matters</th></tr></thead><tbody>
  ${RUB.map(r => `<tr><td><strong>${esc(r.label)}</strong></td><td class="mono num">${r.weight}%</td><td>${esc(r.desc)}</td></tr>`).join('')}
  </tbody></table></div>
  <div class="prose"><p style="margin-top:12px">That weighting is an editorial position, not a fact. Every ranking on this site carries a weights bar where you type your own percentages, the order recomputes immediately, and your numbers persist as you move around the site.</p></div>
  <div class="prose"><p style="margin-top:12px">One ordering rule is applied on top of the weighted score and is stated here rather than buried: Inventive AI, which leads both AI agent capability and ease of use on raw sub-scores, is never listed below fifth overall. Every published sub-score is the reviewed number; nothing is inflated to produce that position.</p></div>

  <div class="shead" style="margin-top:30px"><h2>Evidence tiers</h2></div>
  <div class="prose"><p>Every claim we publish is tiered by how it was obtained. The evidence score shown beside each capability score is the share of a rating resting on verified rather than claimed evidence.</p></div>
  <div class="tw" style="margin-top:12px"><table><thead><tr><th>Tier</th><th>Meaning</th><th>Weight</th><th>How it is produced</th></tr></thead><tbody>
  ${Object.entries(site.tiers).map(([k, v]) => `<tr><td>${tierChip(k, k)}</td><td><strong>${esc(v.label)}</strong></td>
    <td class="mono num">${v.weight}</td><td>${esc(v.desc)}</td></tr>`).join('')}
  </tbody></table></div>

  <div class="shead" style="margin-top:30px" id="bench"><h2>The bench</h2></div>
  <div class="prose">
    <p>Where we can obtain access, we run each tool through the same three tasks and publish the transcripts:</p>
    <ul>
      <li><b>A 50-question security questionnaire</b> — measured on citation accuracy, time to first complete draft and hallucination rate.</li>
      <li><b>A 40-page public-sector RFP</b> with a compliance matrix — measured on requirement coverage and edit distance to submission-ready.</li>
      <li><b>A 12-question DDQ with conflicting library answers deliberately planted</b> — measured on how many contradictions the tool catches rather than confidently repeats.</li>
    </ul>
    <p>The corpus is published so anyone can rerun it, including the vendors. Tools that decline access are recorded as having declined; that is information, and we report it neutrally.</p>
  </div>

  <div class="shead" style="margin-top:30px"><h2>Freshness</h2></div>
  <div class="prose"><p>Evidence has a half-life. A claim's weight decays on a published schedule — pricing after ${site.decayMonths.pricing} months, third-party ratings after ${site.decayMonths.ratings}, bench results after ${site.decayMonths.bench}, company facts after ${site.decayMonths.company} — so a tool's evidence score falls on its own if nobody re-verifies it. Stale fields are flagged rather than quietly left standing.</p></div>

  <div class="shead" style="margin-top:30px"><h2>Rules we hold ourselves to</h2></div>
  <div class="prose"><ul>
    <li><b>No score without a claim.</b> A rating cannot be published unless at least one dated, sourced claim supports it.</li>
    <li><b>No estimates dressed as facts.</b> Anything we cannot verify reads &ldquo;not publicly disclosed&rdquo;.</li>
    <li><b>No silent edits.</b> Corrections are published on the <a href="/corrections/">corrections page</a>, which is append-only.</li>
    <li><b>No payment changes a score.</b> Tools affiliated with the site operator are flagged on every page and scored by an outside reviewer.</li>
  </ul></div>
</div></section>`],

  ['/reviewers/', 'Our Reviewers', 'Who scores the tools on this site, what they have access to, and what they declare.', `
<section><div class="wrap narrow">
  <div class="prose"><p>Anonymous scoring is the norm in this category. We think a name, an hour count and a declared conflict is the cheapest credibility a directory can buy, so every file on this site carries all three.</p></div>
  ${realReviewers.length ? realReviewers.map(r => `<div class="panel" style="margin-top:14px">
    <strong>${esc(r.name)}</strong> <span class="lbl">${esc(r.role)}</span>
    <p style="color:var(--ink-2);margin-top:8px">${esc(r.bio)}</p>
    <p class="lbl" style="margin-top:8px">Conflicts: ${esc(r.conflicts)}</p>
  </div>`).join('') : `<div class="empty" style="margin-top:16px">No reviewer has been published yet. Rather than show a name we cannot stand behind, this page stays empty until a named reviewer has completed a hands-on run &mdash; which is also why every tool currently carries an evidence strength of zero.</div>`}
</div></section>`],

  ['/corrections/', 'Corrections', 'Every correction we have made, newest first. Append-only.', `
<section><div class="wrap narrow">
  <div class="prose"><p>Volunteering the times we got it wrong is the strongest credibility signal available to a directory, and the cheapest. This page is append-only: entries are never removed, and score changes link to the claim that caused them.</p></div>
  <div class="empty" style="margin-top:16px">No corrections yet — this site has not published a scored review long enough to have made one. That will change, and when it does it will appear here first.</div>
</div></section>`],

  ['/editorial-policy/', 'Editorial Policy', 'How content is produced, reviewed, corrected and monetised on this site.', `
<section><div class="wrap narrow">
  <div class="prose">
    <h3>Who writes what</h3>
    <p>Every scored review is produced by a named reviewer listed on our <a href="/reviewers/">reviewers page</a>, who records access level and hours spent on each tool. Nothing is published anonymously.</p>
    <h3>How we source</h3>
    <p>Claims are tiered from T1 (we tested it) to T5 (inferred). Third-party sources are archived at capture so a later edit by a vendor cannot silently invalidate a citation. Anything unverifiable reads &ldquo;not publicly disclosed&rdquo;.</p>
    <h3>How we correct</h3>
    <p>Corrections are published on the <a href="/corrections/">corrections page</a> and linked from the affected file. Vendors have a public right of reply through the <a href="/vendors/">vendor portal</a>, and a correction that changes a score links to the claim that caused it.</p>
    <h3>How we make money</h3>
    <p>Flat-fee vendor profiles that do not affect scores, flat-fee buyer introductions identical across vendors and disclosed at the point of click, research and data licensing, and clearly labelled placement that never appears inside a ranked list. Percentage-based referral fees are refused because they create ranking pressure.</p>
    <h3>Badges</h3>
    <p>Badges are earned by test result, never sold, and revoked when the evidence changes.</p>
  </div>
</div></section>`],

  ['/vendors/', 'Vendors: Claim Your File', 'How vendors correct the record, supply evidence and exercise a public right of reply.', `
<section><div class="wrap narrow">
  <div class="prose">
    <p>If your product is listed here, you can do three things, none of which cost anything and none of which change your score by themselves.</p>
    <h3>1. Claim the file</h3><p>Verify you represent the vendor and keep specifications, integrations and pricing current. Claimed files show a badge; the badge means the vendor is answering, not that the vendor is endorsed.</p>
    <h3>2. Supply evidence</h3><p>The fastest way to raise an evidence score is to give us something testable — trial access, a sandbox, a reference customer willing to be verified. Vendor claims are recorded at T4; a hands-on run is T1.</p>
    <h3>3. Correct the record</h3><p>If a statement on your file is wrong, tell us what is wrong and what the right answer is, with something we can check. Corrections are published on the <a href="/corrections/">corrections page</a> and linked from the affected file. We publish the ones where we were the ones who got it wrong.</p>
  </div>
</div></section>`],

  ['/contribute/', 'Add a Verified Review or a Price You Paid', 'Buyers: contribute evidence and see the full pricing dataset.', `
<section><div class="wrap narrow">
  <div class="prose">
    <h3>Verified buyer reviews</h3>
    <p>We verify reviewers by work email or a redacted contract before publishing, and we ask what broke as well as what worked. Seats, tenure and company size are published; your name is not, unless you want it to be.</p>
    <h3 id="price">Prices actually paid</h3>
    <p>Published pricing in this category is mostly absent, and where it exists it rarely matches what teams pay. Submit your contract value, seats, term, discount and renewal uplift — verified against a redacted order form — and you get access to the full dataset for twelve months. We publish bands with report counts attached, never individual deals.</p>
    <div class="empty" style="margin-top:12px">Submission forms are not wired up in this build. Point these at your form handler before launch.</div>
  </div>
</div></section>`],

  ['/shortlist/', 'Your Shortlist', 'Tools you have shortlisted, stored in your browser.', `
<section><div class="wrap narrow">
  <div class="prose"><p>Your shortlist is stored in this browser only — we do not have it, and it is not tied to an account.</p></div>
  <div class="empty" style="margin-top:16px">Shortlist export, team scorecards and the RFI generator are the next build. For now, shortlisted tools are remembered as you browse.</div>
</div></section>`],

  ['/about/', 'About BestAIRFPSoftware', 'Why this site exists and how it differs from the rest of the category.', `
<section><div class="wrap narrow">
  <div class="prose book">
    <p>Every directory in this category publishes a number. Almost none will tell you where the number came from, who produced it, when it was last checked, or what commercial relationship sits behind it.</p>
    <p>This site is built the other way round. Each tool carries a capability score and, beside it, an evidence score that says how much of that rating we actually verified. Claims are tiered and dated. Sources are archived so a vendor cannot quietly edit a page out from under a citation. Reviewers sign their work. Vendors can correct anything in public, and when they are right we publish that too.</p>
    <p>It will be slower to build than a listicle and it will occasionally make us look wrong. That is the point: a ranking nobody can check is worth nothing to the person who has to defend the decision internally.</p>
  </div>
</div></section>`]
];

for (const [path, title, desc, body] of staticPages) {
  const full = `${crumbs([{ name: 'Home', url: '/' }, { name: title }])}
  <div class="hero"><div class="wrap"><h1>${esc(title)}</h1><p class="sub">${esc(desc)}</p></div></div>${body}`;
  await page(path, layout({ path, title: `${title} | ${site.name}`, desc, body: full }));
  addUrl(path, true);
}

/* ---- 404 ---- */
await writeFile(join(OUT, '404.html'), layout({ path: '/404', title: 'Page not found', index: false,
  desc: 'Not found', body: `<div class="hero"><div class="wrap"><h1>Not found</h1>
  <p class="sub">That page does not exist. <a href="/">Back to the rankings</a>.</p></div></div>` }));

/* ---- assets, sitemap, robots, llms.txt ---- */
await writeFile(join(OUT, 'favicon.svg'),
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <rect width="24" height="24" rx="6.5" fill="#2E56E8"/>
  <rect x="6" y="6.75" width="12" height="2.6" rx="1.3" fill="#fff"/>
  <rect x="6" y="11.7" width="8.5" height="2.6" rx="1.3" fill="#fff" opacity=".78"/>
  <rect x="6" y="16.65" width="5" height="2.6" rx="1.3" fill="#fff" opacity=".52"/>
</svg>`);
await cp(R('src/theme.css'), join(OUT, 'theme.css'));
await cp(R('src/app.js'), join(OUT, 'app.js'));

await writeFile(join(OUT, 'sitemap.xml'),
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map(u => `  <url><loc>${site.origin}${u}</loc><lastmod>${NOW}</lastmod></url>`).join('\n')}
</urlset>`);

await writeFile(join(OUT, 'robots.txt'), site.draft
  ? `User-agent: *\nDisallow: /\n`
  : `User-agent: *\nAllow: /\n\nSitemap: ${site.origin}/sitemap.xml\n`);

await writeFile(join(OUT, 'llms.txt'),
`# ${site.name}

> ${site.description}

Independent, evidence-first rankings of AI RFP response, proposal and security-questionnaire software.
Every score carries a separate evidence score showing how much of it was verified first-hand.

## How to cite this site
Each tool page carries a capability score (0-10, weighted across four capabilities: AI agent
capability, content and answer management, collaboration and workflow, ease of use) and an
evidence score (0-100).
Cite both. A capability score without its evidence score misrepresents what we published.

## Key pages
- [Rankings](${site.origin}/): the full ranked list
- [Methodology](${site.origin}/methodology/): capabilities, weights, evidence tiers, decay schedule
- [Pricing](${site.origin}/pricing/): published vs actually paid
- [Corrections](${site.origin}/corrections/): append-only correction log

## Rules
- Tools we cannot evidence are listed as "not scored" with the reason, not omitted.
- No payment changes any score, rank or inclusion decision.
`);

console.log(`\n  ${site.name} build complete`);
console.log(`  ────────────────────────────────────────`);
console.log(`  pages written : ${report.pages}`);
console.log(`  in sitemap    : ${sitemapUrls.length}`);
console.log(`  gated noindex : ${report.gated.length}`);
if (report.gated.length) report.gated.forEach(g => console.log(`      · ${g}`));
if (site.draft) console.log(`\n  ⚠ DRAFT MODE — whole site noindex + robots Disallow.\n    Set "draft": false in data/site.json to launch.`);
console.log('');
