# SEO Audit — Implementation Notes

Audit processed 2026-10-16. Items completed, deferred, and decisions still needed.

---

## Completed

| Item | Detail |
|------|--------|
| 4 broken collection 404s | URL redirects created: `publisher-hans-im-gluck`, `publisher-ravensburger`, `publisher-thunderworks-games` → `/pages/publishers`; `mechanic-victory-points-as-a-resource` → `/collections/all-games` |
| 183 double-branded SEO titles | Stripped `\| MP Games` suffix from all 183 collection SEO titles via API (audit found 34 due to crawl rate-limiting; actual count was 183) |
| 87 hidden line breaks | Fixed as part of the double-branding strip — trailing newlines were embedded in the `\| MP Games\n` suffix |
| 15 long titles (>60 chars) | Resolved — all 15 were caused by the `\| MP Games` suffix; 0 long titles remain after the strip |
| 13 thin meta descriptions | Rewrote descriptions for: `players-2`, `players-solo`, `players-2-plus`, `players-5-6`, `players-5-plus`, `players-coop`, `category-family`, `category-strategy`, `category-coop`, `complexity-gateway`, `complexity-midweight`, `complexity-heavy`, `expansions`, `new-releases`, `playtime-epic`, `top-rated`, `all-games`, `best-sellers`, `sale`, `pre-orders`, `pre-owned-games` |
| Homepage H1 | Updated first hero slide title to "Board games ranked by BoardGameGeek, delivered across the UK"; subtitle updated to "Shop by BGG score, player count and play time — next working day dispatch." |
| Section titles using H2 | Changed `<div>` → `<h2>` for title elements in: `mp-product-rail`, `mp-top-rated`, `mp-category-tiles`, `mp-publishers`, `mp-player-count`, `mp-editorial`, `mp-designers`, `mp-newsletter` |
| Noindex allowlist | Added force-index override in `theme.liquid` for 10 high-value collections below the 3-product threshold: `category-worker`, `sale`, `designer-matt-leacock`, `designer-wolfgang-kramer`, `mechanic-deck-construction`, `mechanic-closed-drafting`, `mechanic-auction-bidding`, `publisher-space-cowboys`, `publisher-lumberjacks-studio`, `publisher-cmyk` |
| Complexity metafield | Standardised `Medium-Light` → `Light-Medium` for 4 products (Courtisans, Leaders: The Vermillion Emperor, One Deck Dungeon: Relics of the Forge, Zenith) — updated locally and pushed to Shopify |

---

## Needs a Decision

### Co-op collection overlap

Three collections all target "co-op board games" and share near-identical H1/meta:

| Collection | Products | Notes |
|------------|----------|-------|
| `/collections/mechanic-cooperative-game` | — | The most semantically correct URL; mechanic-based |
| `/collections/category-coop` | — | Category-based; arguably the primary browsing URL |
| `/collections/players-coop` | — | Player-count section links here |

**Options:**
- **Redirect two to one** — pick one canonical URL (recommend `category-coop` or `mechanic-cooperative-game`) and 301 the others. Clean, consolidates link equity.
- **Set noindex on two** — keep all three live for navigation but only index one. Quick fix but wastes crawl budget.
- **Differentiate content** — give each a distinct angle (e.g. `players-coop` = "co-op games by player count", `category-coop` = "the best co-op games", `mechanic-cooperative-game` = "co-op mechanics explained"). More work but preserves all three URLs.

The `mp-player-count` section on the homepage currently links to `players-coop`. If that URL is redirected, update the `index.json` block to point to the chosen canonical.

---

### `/collections` all-collections page

The Shopify list-collections template (`/collections`) has no H1 and no meta description. Fixing this requires editing the theme template file that renders that page.

- **H1:** Add `<h1>All board game collections</h1>` (or similar) to the collection list template.
- **Meta description:** Add a `<meta name="description">` specific to this page in the template, before the generic theme description logic applies.

The template file to edit is likely `templates/list-collections.liquid` or `templates/list-collections.json` + matching section.

---

### `/pages/loyalty-points` — missing H1

The loyalty points page has no H1. The fix depends on how the page is built:
- If it uses a Liquid template with a hardcoded heading, add `<h1>` there.
- If it is a Shopify page with a rich-text body, the page title is typically rendered as `<h2>` by the theme. Confirm whether the theme renders `page.title` as `<h1>` or not.

---

### Long product titles in individual game pages

The audit flagged 15 pages with titles over 60 characters. After fixing the collection titles, 0 collections exceed 60 chars. If the 15 flagged pages included product pages (not collections), those would need individual SEO title fields set on each product. The most likely candidates based on game names:

- Kingdom Come: Deliverance – The Board Game
- Shackleton Base: Below. Within. Above.
- Courtisans: Diplomats and Confidants
- Captain Flip: Isla Bomba – Push-Your-Luck Tile Expansion
- Leaders: The Vermillion Emperor

For each, set a shorter custom SEO title in the Shopify product editor (Products → [product] → SEO → Page title), e.g. "Kingdom Come: Deliverance Board Game" instead of the full subtitle.

---

### Noindex allowlist — ongoing maintenance

The `theme.liquid` allowlist currently has 10 handles hardcoded. When new important-but-sparse collections are added (e.g. a new publisher or mechanic you want indexed from day one), add the handle to the `_force_index_handles` string in `layout/theme.liquid` line ~94.

---

## Not Actionable from the Theme / Portal

| Item | Reason |
|------|--------|
| Shopify-generated structured data | Controlled by Shopify core; no override available without a third-party app |
| Canonical tags for paginated collections | Shopify adds these automatically; no action needed |
| Image alt text at scale | Requires per-product/per-image editing — beyond scope of a batch fix; consider bulk alt text via the Partners portal metafield sync |
