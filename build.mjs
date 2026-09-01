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

/* ------------------------------------------------------------------ utils */
const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const words = (s = '') => String(s).trim().split(/\s+/).filter(Boolean).length;
const pad = (n) => String(n).padStart(2, '0');
const scored = tools.filter(t => t.status === 'scored');
const notScored = tools.filter(t => t.status !== 'scored');
const bySlug = Object.fromEntries(tools.map(t => [t.slug, t]));
const RUB = site.rubric;

function capability(t, weights) {
  if (!t.scores) return null;
  const w = weights || Object.fromEntries(RUB.map(r => [r.key, r.weight]));
  const tot = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  return RUB.reduce((a, r) => a + (t.scores[r.key] || 0) * w[r.key], 0) / tot;
}
function rank(list, weights) {
  return list.filter(t => t.scores)
    .map(t => ({ t, v: capability(t, weights) }))
    .sort((a, b) => b.v - a.v);
}
const evidenceOf = (t) => (t.evidence?.verified || 0);
const claimedOf  = (t) => (t.evidence?.verified || 0) + (t.evidence?.claimed || 0);
const money = (n) => n == null ? null : '$' + (n >= 1000 ? (n / 1000).toFixed(n % 1000 ? 1 : 0) + 'k' : n);
const priceLabel = (t) => {
  const p = t.pricing || {};
  if (p.paidLow && p.paidHigh) return money(p.paidLow) + '–' + money(p.paidHigh);
  if (p.list) return money(p.list);
  return 'Not disclosed';
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
      `<span>${esc(r.label.toLowerCase())} <b>${t.scores[r.key].toFixed(1)}</b></span>`).join('')}</div>
  </div>`;
}

function verdict(t, pos) {
  const best = [...RUB].sort((a, b) => t.scores[b.key] - t.scores[a.key])[0];
  const worst = [...RUB].sort((a, b) => t.scores[a.key] - t.scores[b.key])[0];
  return `It ranks ${pos === 1 ? 'first' : pos === 2 ? 'second' : pos === 3 ? 'third' : `${pos}th`} on the default rubric, with its strongest showing in <b>${esc(best.label.toLowerCase())}</b> and its weakest in <b>${esc(worst.label.toLowerCase())}</b>. ${evidenceOf(t) === 0
    ? 'No part of this rating has been verified first-hand yet — it carries an evidence score of zero until a reviewer completes a hands-on run, and you should read the position accordingly.'
    : 'Evidence strength is ' + evidenceOf(t) + ' of 100, so ' + (100 - evidenceOf(t)) + '% of this rating still rests on unverified vendor material.'}`;
}

function entryCard(t, pos, baseRank) {
  const cap = capability(t);
  const alts = (t.alternatives || []).map(s => bySlug[s]).filter(Boolean);
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
    <div class="ft"><span class="k">Price</span><span>${esc(priceLabel(t))}${t.pricing?.n
      ? ` (n=${t.pricing.n} buyer reports)` : ' &mdash; vendor does not publish list pricing'}</span></div>
  </div>
  <div class="foot">
    <a class="btn" href="/tools/${esc(t.slug)}/">Read the full file</a>
    <button class="btn quiet sm" data-shortlist="${esc(t.slug)}" aria-pressed="false">+ Shortlist</button>
    ${alts[0] ? `<a class="btn quiet sm" href="/vs/${esc(t.slug)}-vs-${esc(alts[0].slug)}/">vs ${esc(alts[0].name)}</a>` : ''}
    <a class="btn quiet sm" href="${esc(t.url)}" rel="nofollow noopener" target="_blank">Visit site &#8599;</a>
  </div>
  <p class="byline lbl">Reviewer ${esc(reviewerName(t.reviewer))} &middot; access: ${esc(t.access)} &middot; last verified ${esc(t.lastVerified)}${t.disputes?.length
    ? ' &middot; <span style="color:var(--contest)">' + t.disputes.length + ' open dispute</span>' : ''}</p>
</article>`;
}

const reviewerName = (id) => (site.reviewers.find(r => r.id === id) || {}).name || 'unassigned';

function glanceTable(ranked) {
  return `<div class="tw"><table data-sortable data-glance>
  <thead><tr>
    <th>#</th><th data-sort>Tool</th><th data-sort>Capability</th><th data-sort>Evidence</th>
    <th data-sort>Best for</th><th data-sort>Price paid</th><th data-sort>Verified</th>
  </tr></thead><tbody>
  ${ranked.map(({ t, v }, i) => `<tr data-slug="${esc(t.slug)}">
    <td class="mono" data-pos>${pad(i + 1)}</td>
    <td><a href="#${esc(t.slug)}"><strong>${esc(t.name)}</strong></a></td>
    <td class="mono num" data-v="${v.toFixed(1)}"><strong data-cap>${v.toFixed(1)}</strong></td>
    <td class="mono num" data-v="${evidenceOf(t)}">${evidenceOf(t)}</td>
    <td>${esc((t.goodFor || [])[0] || '—')}</td>
    <td class="mono num">${esc(priceLabel(t))}</td>
    <td class="mono">${esc(t.lastVerified)}</td>
  </tr>`).join('')}
  </tbody></table></div>`;
}

function weightsBar(weights) {
  return `<div class="weights" data-weights hidden>
  <div class="wrap">
    ${RUB.map(r => `<div class="sl">
      <label for="w-${r.key}">${esc(r.label)} <span id="wv-${r.key}" class="num">${weights[r.key]}</span></label>
      <input type="range" id="w-${r.key}" min="0" max="60" step="5" value="${weights[r.key]}" data-default="${weights[r.key]}">
    </div>`).join('')}
    <div class="meta">
      <span class="lbl" data-rankednote>Ranked by our default rubric. It is a default, not a verdict — drag the weights.</span>
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
<link rel="stylesheet" href="/theme.css">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</head><body>
<a class="skip" href="#main">Skip to content</a>
${site.draft ? `<div class="draft"><div class="wrap"><b>DRAFT BUILD</b><span>${esc(site.draftNote)}</span></div></div>` : ''}
<div class="disc"><div class="wrap">
  <span class="t"><strong>Independence:</strong> ${esc(site.operator.disclosure)}</span>
  <a class="btn quiet sm" href="/ledger/">Read the ledger</a>
</div></div>
<header class="site"><div class="wrap">
  <a class="mark" href="/">${esc(site.name)}</a>
  <nav class="main">
    <a href="/">Rankings</a>
    <a href="/best/security-questionnaire-automation/">Security questionnaires</a>
    <a href="/best/proposal-management/">Proposal management</a>
    <a href="/compare/">Compare</a>
    <a href="/pricing/">Pricing</a>
    <a href="/methodology/">Methodology</a>
  </nav>
  <div class="hdr-actions"><a class="btn ghost sm" href="/shortlist/" data-shortlist-count>Shortlist</a></div>
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
      <li><a href="/ledger/">Independence ledger</a></li>
      <li><a href="/reviewers/">Reviewers</a></li>
      <li><a href="/corrections/">Corrections</a></li>
      <li><a href="/editorial-policy/">Editorial policy</a></li>
    </ul></div>
    <div><h4>Take part</h4><ul>
      <li><a href="/contribute/">Add a verified review</a></li>
      <li><a href="/contribute/#price">Submit a price you paid</a></li>
      <li><a href="/vendors/">Vendors: claim or dispute</a></li>
      <li><a href="/about/">About</a></li>
    </ul></div>
  </div>
  <div class="fnote lbl">
    ${esc(site.name)} &middot; independent, evidence-first rankings &middot; last built ${esc(updated)}<br>
    No payment changes any score, rank or inclusion decision. Every commercial relationship is published on the <a href="/ledger/">independence ledger</a>.
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
${crumbs([{ name: 'Home', url: '/' }])}
<div class="hero"><div class="wrap">
  <h1>${esc(h.h1)}</h1>
  <p class="sub">${esc(h.sub)}</p>
  <div class="byline">
    <span class="lbl">Updated ${esc(NOW)}</span>
    <span class="lbl">Reviewed by ${site.reviewers.map(r => esc(r.name)).join(' &amp; ')}</span>
    <span class="lbl"><a href="/methodology/">How we score</a></span>
  </div>
  <div class="counters">
    <div><b class="num">${scored.length}</b><span class="lbl">tools ranked</span></div>
    <div><b class="num">${tools.reduce((a, t) => a + (t.claims?.length || 0), 0)}</b><span class="lbl">dated claims</span></div>
    <div><b class="num">${tools.filter(t => t.bench).length}</b><span class="lbl">bench-tested</span></div>
    <div><b class="num">${notScored.length}</b><span class="lbl">not scored</span></div>
  </div>
  <div class="hero-cta">
    <a class="btn" href="#table">See the table</a>
    <a class="btn ghost" href="#weights">Set your weights</a>
  </div>
</div></div>

${weightsBar(defW)}

<section id="table"><div class="wrap">
  <div class="shead"><h2>At a glance</h2><span class="lbl">Sort any column</span></div>
  ${glanceTable(ranked)}
</div></section>

<section><div class="wrap">
  <div class="shead"><h2>How we ranked them</h2></div>
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
    <p style="color:var(--graphite);margin-top:6px">${esc(t.notScoredReason)}</p>
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
  const alts = (t.alternatives || []).map(s => bySlug[s]).filter(Boolean);
  const body = `
${crumbs([{ name: 'Home', url: '/' }, { name: 'Tools', url: '/compare/' }, { name: t.name }])}
<div class="hero"><div class="wrap">
  <h1>${esc(t.name)} Review</h1>
  <p class="sub">${esc(t.oneLiner)}</p>
  <div class="byline">
    <span class="lbl">Reviewer ${esc(reviewerName(t.reviewer))}</span>
    <span class="lbl">Access: ${esc(t.access)}</span>
    <span class="lbl">Last verified ${esc(t.lastVerified)}</span>
    ${t.affiliated ? `<span class="tier t4">Affiliated with operator</span>` : ''}
  </div>
</div></div>

<section><div class="wrap">
  ${t.scores ? `<div class="panel scorepanel">${scoreBlock(t, cap)}</div>` : `
  <div class="panel"><strong>Not scored.</strong><p style="color:var(--graphite);margin-top:6px">${esc(t.notScoredReason)}</p></div>`}
</div></section>

<section><div class="wrap">
  <div class="shead"><h2>What ${esc(t.name)} is</h2></div>
  <div class="prose book"><p>${esc(t.oneLiner)} ${t.scores
    ? esc(`On our default rubric it places ${pos} of ${ranked.length}.`) : ''}</p></div>
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
    <p style="color:var(--graphite);margin-top:6px;font-size:.9rem">${esc(a.oneLiner)}</p>
    <p style="margin-top:10px"><a class="btn quiet sm" href="/vs/${t.slug}-vs-${a.slug}/">${esc(t.name)} vs ${esc(a.name)}</a></p>
  </div>`).join('')}</div>
</div></section>` : ''}

<section><div class="wrap">
  <div class="shead"><h2>Disputes &amp; changelog</h2></div>
  <div class="empty">${t.disputes?.length ? t.disputes.length + ' open' : 'No disputes filed.'}
  ${t.changelog?.length ? '' : ' No score changes recorded yet — this file has not been revised since first publication.'}
  Vendors can contest any claim on this page: <a href="/vendors/">right of reply</a>.</div>
</div></section>`;

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
    `${x.label.toLowerCase()} ${c.weights[x.key]}%`).join(', ')}.</p>
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
  <div class="shead"><h2>At a glance</h2></div>
  ${glanceTable(r)}
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
const vsPairs = [
  ...copy.vs.map(v => ({ a: v.a, b: v.b, info: v })),
  ...copy.vsUngated.map(([a, b]) => ({ a, b, info: null }))
];
for (const { a, b, info } of vsPairs) {
  const A = bySlug[a], B = bySlug[b];
  if (!A || !B || !A.scores || !B.scores) continue;
  const gateOk = !!(info && words(info.intro) >= 120 && info.faq?.length);
  const path = `/vs/${a}-vs-${b}/`;
  const rows = RUB.map(r => `<tr><td><strong>${esc(r.label)}</strong> <span class="lbl">${r.weight}%</span></td>
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
    <tr><td><strong>Price paid</strong></td><td>${esc(priceLabel(A))}</td><td>${esc(priceLabel(B))}</td></tr>
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
    desc: `${A.name} and ${B.name} compared on drafting, governance, workflow and evidence strength.`,
    body, jsonld: ld, index: gateOk }), { index: gateOk });
  addUrl(path, gateOk);
}

/* ---- compare + pricing ---- */
{
  const body = `
${crumbs([{ name: 'Home', url: '/' }, { name: 'Compare' }])}
<div class="hero"><div class="wrap">
  <h1>Compare all ${scored.length} tools</h1>
  <p class="sub">Every dimension, every evidence score, in one sortable matrix. The order is not a popularity ranking — it is our rubric, and you can change it.</p>
</div></div>
${weightsBar(defW)}
<section><div class="wrap">
  <div class="tw"><table data-sortable><thead><tr>
    <th>#</th><th data-sort>Tool</th><th data-sort>Capability</th><th data-sort>Evidence</th>
    ${RUB.map(r => `<th data-sort>${esc(r.label)}</th>`).join('')}
    <th data-sort>Price</th><th data-sort>Bench</th>
  </tr></thead><tbody>
  ${ranked.map(({ t, v }, i) => `<tr>
    <td class="mono">${pad(i + 1)}</td>
    <td><a href="/tools/${t.slug}/"><strong>${esc(t.name)}</strong></a></td>
    <td class="mono num" data-v="${v.toFixed(1)}"><strong>${v.toFixed(1)}</strong></td>
    <td class="mono num" data-v="${evidenceOf(t)}">${evidenceOf(t)}</td>
    ${RUB.map(r => `<td class="mono num" data-v="${t.scores[r.key]}">${t.scores[r.key].toFixed(1)}</td>`).join('')}
    <td class="mono">${esc(priceLabel(t))}</td>
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
    <th data-sort>Tool</th><th data-sort>Model</th><th data-sort>Published</th>
    <th data-sort>Actually paid</th><th data-sort>Reports</th><th data-sort>Billing</th><th data-sort>Trial</th>
  </tr></thead><tbody>
  ${tools.map(t => `<tr>
    <td><a href="/tools/${t.slug}/"><strong>${esc(t.name)}</strong></a></td>
    <td>${esc(t.pricing?.model || '—')}</td>
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
  <div class="prose"><p>Four weighted criteria, combined into a single capability score from 0 to 10, rounded to one decimal. The formula is published because a score you cannot recompute is a score you cannot check.</p></div>
  <div class="tw" style="margin-top:12px"><table><thead><tr><th>Criterion</th><th>Weight</th><th>What it measures</th></tr></thead><tbody>
  ${RUB.map(r => `<tr><td><strong>${esc(r.label)}</strong></td><td class="mono num">${r.weight}%</td><td>${esc(r.desc)}</td></tr>`).join('')}
  </tbody></table></div>
  <div class="prose"><p style="margin-top:12px">That weighting is an editorial position, not a fact. Every ranking on this site carries a weights bar that recomputes the order against your own priorities, and your weights persist as you move around the site.</p></div>

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
    <li><b>No payment changes a score.</b> Every commercial relationship is on the <a href="/ledger/">independence ledger</a>.</li>
  </ul></div>
</div></section>`],

  ['/ledger/', 'Independence Ledger', 'Every commercial relationship we have with every vendor listed on this site.', `
<section><div class="wrap narrow">
  <div class="prose book"><p>${esc(site.operator.disclosure)}</p></div>
  <div class="shead" style="margin-top:26px"><h2>Relationships</h2></div>
  <div class="tw"><table><thead><tr><th>Tool</th><th>Relationship</th><th>Affects score?</th></tr></thead><tbody>
  ${tools.map(t => `<tr><td><a href="/tools/${t.slug}/"><strong>${esc(t.name)}</strong></a></td>
    <td>${t.affiliated ? 'Affiliated with the site operator' : 'None'}</td>
    <td class="mono">No</td></tr>`).join('')}
  </tbody></table></div>
  <div class="shead" style="margin-top:30px"><h2>The four rules</h2></div>
  <div class="prose"><ol>
    <li><b>No payment changes any score, rank or inclusion decision.</b> Enforced in the data model: a relationship record cannot contribute to a score.</li>
    <li><b>Affiliated tools are scored by an outside reviewer</b>, flagged permanently, and excludable from every ranking in one click.</li>
    <li><b>Every commercial relationship appears above</b> before you see the score it might have influenced.</li>
    <li><b>Corrections are published, never silently edited.</b></li>
  </ol></div>
</div></section>`],

  ['/reviewers/', 'Our Reviewers', 'Who scores the tools on this site, what they have access to, and what they declare.', `
<section><div class="wrap narrow">
  <div class="prose"><p>Anonymous scoring is the norm in this category. We think a name, an hour count and a declared conflict is the cheapest credibility a directory can buy, so every file on this site carries all three.</p></div>
  ${site.reviewers.map(r => `<div class="panel" style="margin-top:14px">
    <strong>${esc(r.name)}</strong> <span class="lbl">${esc(r.role)}</span>
    <p style="color:var(--graphite);margin-top:8px">${esc(r.bio)}</p>
    <p class="lbl" style="margin-top:8px">Conflicts: ${esc(r.conflicts)}</p>
  </div>`).join('')}
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
    <p>Corrections are published on the <a href="/corrections/">corrections page</a> and linked from the affected file. Vendors have a public right of reply through the <a href="/vendors/">vendor portal</a>; disputes are shown on the tool's own page with our ruling and its date.</p>
    <h3>How we make money</h3>
    <p>Flat-fee vendor profiles that do not affect scores, flat-fee buyer introductions identical across vendors and disclosed at the point of click, research and data licensing, and clearly labelled placement that never appears inside a ranked list. Percentage-based referral fees are refused because they create ranking pressure.</p>
    <h3>Badges</h3>
    <p>Badges are earned by test result, never sold, and revoked when the evidence changes.</p>
  </div>
</div></section>`],

  ['/vendors/', 'Vendors: Claim Your File or Dispute a Claim', 'How vendors correct the record, supply evidence and exercise a public right of reply.', `
<section><div class="wrap narrow">
  <div class="prose">
    <p>If your product is listed here, you can do three things, none of which cost anything and none of which change your score by themselves.</p>
    <h3>1. Claim the file</h3><p>Verify you represent the vendor and keep specifications, integrations and pricing current. Claimed files show a badge; the badge means the vendor is answering, not that the vendor is endorsed.</p>
    <h3>2. Supply evidence</h3><p>The fastest way to raise an evidence score is to give us something testable — trial access, a sandbox, a reference customer willing to be verified. Vendor claims are recorded at T4; a hands-on run is T1.</p>
    <h3>3. Dispute a claim</h3><p>Any statement on your file can be contested. Disputes are public: the claim, your response, the evidence supplied, our ruling and the date all appear on your tool page. We publish the ones we lose.</p>
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
    <p>This site is built the other way round. Each tool carries a capability score and, beside it, an evidence score that says how much of that rating we actually verified. Claims are tiered and dated. Sources are archived so a vendor cannot quietly edit a page out from under a citation. Reviewers sign their work. Vendors can dispute anything in public, and when they are right we publish that too.</p>
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
await cp(R('src/theme.css'), join(OUT, 'theme.css'));
await cp(R('src/app.js'), join(OUT, 'app.js'));

await writeFile(join(OUT, 'sitemap.xml'),
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map(u => `  <url><loc>${site.origin}${u}</loc><lastmod>${NOW}</lastmod></url>`).join('\n')}
</urlset>`);

await writeFile(join(OUT, 'robots.txt'), site.draft
  ? `User-agent: *\nDisallow: /\n# Draft build — set "draft": false in data/site.json before launch.\n`
  : `User-agent: *\nAllow: /\n\nSitemap: ${site.origin}/sitemap.xml\n`);

await writeFile(join(OUT, 'llms.txt'),
`# ${site.name}

> ${site.description}

Independent, evidence-first rankings of AI RFP response, proposal and security-questionnaire software.
Every score carries a separate evidence score showing how much of it was verified first-hand.

## How to cite this site
Each tool page carries a capability score (0-10, weighted rubric) and an evidence score (0-100).
Cite both. A capability score without its evidence score misrepresents what we published.

## Key pages
- [Rankings](${site.origin}/): the full ranked list
- [Methodology](${site.origin}/methodology/): rubric, weights, evidence tiers, decay schedule
- [Independence ledger](${site.origin}/ledger/): every commercial relationship
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
