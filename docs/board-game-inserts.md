# Board Game Inserts

3D-printed storage inserts/organisers sold alongside the games. Each insert is
offered **two ways on one product**: buy the ready-to-print **STL files**
(digital download, nothing ships) or buy a **3D-printed** insert shipped to the
customer.

## The product model

One Shopify product per insert, with a **`Format`** option:

| Option value          | Type     | Requires shipping | Fulfilment                                   |
| --------------------- | -------- | ----------------- | -------------------------------------------- |
| `STL Digital Download`| digital  | **No**            | STL file attached via Digital Downloads app  |
| `3D Printed`          | physical | Yes               | you print + ship it, tracked inventory       |

The theme's variant picker (`sections/mp-product.liquid`) renders the `Format`
option automatically — no theme change needed to add the options.

- **Product type** must be exactly **`Board Game Insert`** (this is what the
  `board-game-inserts` smart collection and the PDP banner key off).
- The insert links to the game(s) it fits via the **`custom.insert_for_game`**
  metafield (a list of product references — a single insert can fit a base game
  and its expansions).

## Storefront wiring (already built)

- **Dedicated product template** — inserts render through
  `sections/mp-product-insert.liquid` via the **`product.insert`** template
  (`templates/product.insert.json`). Set an insert product's **Theme template**
  to **`insert`** (Admin → product → Online Store → Theme template, or
  `template_suffix: "insert"`). It shares the site's look but drops the board-game
  furniture (designer/artist, how-to-play, BGG, complexity) and instead shows:
  a **compatibility** banner, a **"Choose how you buy it"** STL-vs-Printed
  comparison, an **Insert details** print-spec panel, and a **"Games this insert
  is made for"** grid. Board games keep using the normal `mp-product` template.
- **Collection** `board-game-inserts` — smart collection, rule *product type
  equals "Board Game Insert"*, published to the Online Store. Renders through the
  normal `mp-collection` page at `/collections/board-game-inserts`.
- **Insert PDP** shows a *"🎯 Designed to fit [game links]"* compatibility banner
  (from `custom.insert_for_game`). (The default `mp-product` template also carries
  a fallback "Storage insert for…" banner in case an insert isn't switched to the
  `insert` template.)
- **Print-spec metafields** (all optional, hide when empty) drive the Insert
  details panel: `custom.insert_material`, `insert_pieces`, `insert_filament`,
  `insert_print_time`, `insert_build_volume`, `insert_assembly`.
- **Format-aware delivery copy** — when the `STL Digital Download` variant is
  selected, the physical "Free UK delivery / 30-day returns" reassurance is
  swapped for an *"Instant digital download… nothing ships"* notice, and the
  "Free UK delivery" line under the price is hidden. Driven by each variant's
  `requires_shipping` flag, so it Just Works as long as the STL variant has
  shipping switched off.
- **Reverse link** — a board game's own PDP shows *"📦 3D-printed storage inserts
  available for this game → [insert links]"* from the **`custom.available_inserts`**
  metafield. That field is **maintained automatically** by
  `scripts/sync-inserts.mjs` (see below) — don't edit it by hand.

Both metafield definitions are storefront `PUBLIC_READ` (filter-eligible), created
by `scripts/setup-inserts.mjs`.

## One-time setup

Already run, but idempotent — safe to re-run:

```bash
node scripts/setup-inserts.mjs         # creates the 2 metafield defs + collection
```

### Install a digital-delivery app (manual — browser only)

The STL file has to be attached to the digital variant by an app; this **can't be
done over the Admin API** (app install needs browser OAuth). Use Shopify's free
first-party app:

1. Shopify admin → **Settings → Apps and sales channels → Shopify App Store**.
2. Search **"Digital Downloads"** (by Shopify) → **Install**.
3. Open the app → **Add a digital attachment** → pick the insert product → upload
   the `.stl` (or a `.zip` of several) and attach it to the **`STL Digital
   Download`** variant.

Buyers then get an automatic download link on the order confirmation / email.
(If you later need licence keys, download caps or watermarking, swap to a paid app
like SendOwl or Sky Pilot — same product model, different attachment app.)

## Adding an insert product

1. **Products → Add product.** Title e.g. *"Wingspan — Storage Insert"*.
2. **Product type** = `Board Game Insert`.
3. **Online Store → Theme template** = **`insert`**.
4. **Variants → add option** `Format` with values `STL Digital Download` and
   `3D Printed`. Set each price.
5. On the **`STL Digital Download`** variant: **uncheck "This is a physical
   product"** (so `requires_shipping = false`). Leave `3D Printed` physical and
   tracked.
6. **Metafields → Insert for (games)** (`custom.insert_for_game`): pick the game(s)
   this insert fits. Optionally fill the print-spec metafields
   (material/pieces/filament/print time/build volume/assembly).
7. Save. In the **Digital Downloads** app, attach the STL to the digital variant.
8. Run the reverse-link sync so the game pages advertise the insert:

```bash
node scripts/sync-inserts.mjs --dry    # preview
node scripts/sync-inserts.mjs          # apply
```

Re-run `sync-inserts.mjs` any time you add/edit an insert or change its
`insert_for_game`. It writes `custom.available_inserts` onto each referenced game
and clears it from games that no longer have an insert.

## Files

- `scripts/setup-inserts.mjs` — one-time store setup (metafield defs + collection).
- `scripts/sync-inserts.mjs` — reverse-link maintenance (`available_inserts`).
- `sections/mp-product-insert.liquid` — dedicated insert PDP section.
- `templates/product.insert.json` — the `insert` product template.
- `sections/mp-product.liquid` — board-game PDP: reverse "inserts available"
  banner + fallback insert banner + format-aware delivery copy.

> **Deploy:** the two theme files above are only live after a **git push to the
> Shopify-synced branch** (or `shopify theme push`). Data changes (metafields,
> collection, menu, a product's template assignment) are live immediately.
