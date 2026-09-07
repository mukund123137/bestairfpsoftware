# BestAIRFPSoftware

An evidence-first ranked directory of AI RFP, proposal and security-questionnaire software.
Static HTML, zero runtime dependencies, built from JSON.

    node build.mjs      # build to ./dist
    node server.mjs     # preview at http://localhost:4321

## The four capabilities

Everything is compared on four things, defined in `site.rubric` — AI Agent Capability,
Content & Answer Management, Collaboration & Workflow, Ease of Use. No sub-categories.
The keys in the data (`drafting`, `governance`, `workflow`, `ux`) are internal and
deliberately unchanged, so scores, URLs and saved reader weights survive a relabel.

## Ranking rules

`site.ranking` holds the only ordering rules, applied in `applyRankingRules()` in
`build.mjs` and mirrored in `src/app.js` so server and client agree:

* `leadCapabilities` — the featured tool must genuinely hold the top sub-score on each
  of these. This is **asserted at build time**, not manufactured: if the reviewed data
  stops supporting it the build fails rather than inflating a number.
* `maxOverallPosition` — the featured tool is never listed below this position under any
  reader weighting. Displayed scores are never rewritten; only the order is floored.

Across an exhaustive sweep of weight combinations the floor currently never has to fire,
so the published order is entirely data-driven.

## Pricing wording

A tool may carry `pricing.label`. When present it is the canonical wording used
*everywhere* that tool's pricing renders — cards, tables, comparisons, tool file — so no
two pages can describe the same product's pricing differently.

## Alternatives

`altsFor()` in `build.mjs` builds every alternatives list, placing `site.ranking.featuredSlug`
first. `vsRegistry` collects every pair any page links to and generates a page for each,
so no alternatives link can point at a comparison that was never built.

## The idea in one line

Every score carries a second score saying how much of it we actually verified.
Capability (0–10, weighted rubric) and Evidence strength (0–100) are shown side by
side and never blended.

## Layout

    data/site.json     capabilities + default weights, evidence tiers, decay schedule,
                       reviewers, categories, ranking rules, operator disclosure, draft flag
    data/tools.json    one record per tool — scores, claims, pricing, bench, buyers
    data/pages.json    hand-written copy: home, category intros, vs intros, FAQs
    src/theme.css      the design system
    src/app.js         progressive enhancement only (re-rank, shortlist, sort)
                       mirrors applyRankingRules() from build.mjs
    build.mjs          generator
    dist/              output — deploy this anywhere static

## Draft mode

`data/site.json` ships with `"draft": true`. While it is true:

* every page emits `noindex,nofollow`
* `robots.txt` disallows everything
* the sitemap is empty
* the build prints a warning in the terminal

Draft mode is invisible to visitors by design — no banner, no notice, nothing
in the markup. The only signal is in your build output, so check it before you
assume a deploy is indexable.

**All scores, prices and claims in `data/tools.json` are placeholders.** They exist so
the templates render. Do not set `draft: false` until real reviewers have produced real
claims, because the whole proposition of this site is that its numbers are checkable.

## The publishing gate

Derivative pages (category listicles, vs pages) are generated but only indexed when they
carry genuinely unique content: a hand-written intro of **120+ words** plus their own FAQ.
Anything short is built with `noindex` and a visible notice, and is excluded from the
sitemap. The build prints exactly what got gated.

This is deliberate. The `/best/` and `/vs/` families can mechanically produce hundreds of
URLs, which is the pattern Google's scaled-content policy targets. Fill the copy in, or
the page stays out of the index.

## SEO wiring already in place

* Per-page `<title>`, meta description, canonical, Open Graph
* JSON-LD: Organization sitewide, ItemList + FAQPage on rankings, SoftwareApplication +
  BreadcrumbList on tool files, Article + FAQPage on vs pages
* No Gartner / G2 / analyst citations anywhere: we have no verifiable links to attach to
  them, and an unlinked third-party endorsement is exactly the claim this site exists to
  refuse. Add real URLs to the data before naming any of them.
* No review or aggregate-rating markup while data is placeholder — self-serving rating
  markup is a real risk given the ownership disclosure
* `sitemap.xml` with `lastmod`, `robots.txt`, `llms.txt` for AI-search citation
* Server-rendered rankings — JS only reorders existing DOM, so nothing is hidden from
  crawlers. Collapsed content is collapsed visually, never withheld from the markup
* Hub-and-spoke internal linking: home → tool files → vs pages → categories → back

## Before launch

1. Replace every placeholder in `data/tools.json` with reviewed data and dated claims
2. Fill `site.operator` with the real operating entity and its affiliated tool slugs
3. Fill `site.reviewers` with real names, bios, conflicts and `sameAs` profile URLs
4. Wire the forms on `/contribute/` and `/vendors/` to a real handler
5. Write intros for the gated pages listed in the build output, or leave them noindex
6. Add `Person` schema for reviewers once they are real people
7. Set `"draft": false`, rebuild, submit the sitemap

## Deploy

`dist/` is plain static files. Netlify, Cloudflare Pages, Vercel, S3 — anything.
Build command `node build.mjs`, publish directory `dist`.
