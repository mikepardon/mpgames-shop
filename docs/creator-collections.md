# Designer / Artist collections — how they work & how to redo

> **A–Z index pages.** There are four searchable, alphabetical index pages that list
> *every* designer / artist / publisher / mechanic in the catalogue and link to each
> one's collection:
> `/pages/designers`, `/pages/artists`, `/pages/publishers`, `/pages/mechanics`.
> They're rendered by `sections/mp-creator-index.liquid` + `templates/page.<kind>.json`,
> read names live from product data (metafields / vendor), and need no upkeep.
> The Shopify Page records were created with `scripts/create-index-pages.mjs`
> (idempotent — re-run any time; `--dry` to preview). The homepage "All designers" /
> "All publishers" links point at these pages. Push the theme so the new templates ship.


On every product page (`sections/mp-product.liquid`), the **Publisher**, **Designer**,
and **Artist** are clickable and link to a collection of other games by that person/company.

## The three link types

| Link | Target | Setup needed |
|------|--------|--------------|
| **Publisher** | `/collections/vendors?q=<vendor>` | None — Shopify auto-generates vendor collections. Just set the product's **Vendor**. |
| **Designer** | `/collections/designer-<handle>` | A collection per designer (below). |
| **Artist** | `/collections/artist-<handle>` | A collection per artist (below). |

`<handle>` is the person's name run through Liquid's `| handle` filter:
lowercase, accents stripped, every run of spaces/punctuation → a single hyphen.
Examples: `Paolo Mori` → `paolo-mori`, `Ondřej Bystroň` → `ondrej-bystron`,
`Sam "Crowbar" Henry` → `sam-crowbar-henry`.

The PDP splits multi-person fields, so `custom.designer = "Paolo Mori, Remo Conzadori"`
renders **two** links. Fields may be comma- **or** semicolon-separated — both are handled.

## The convention (must stay consistent)

Designer/Artist collections are **tag-based automated (smart) collections**:

- Each product is tagged **`Designer: <Name>`** and **`Artist: <Name>`**, once per person.
- Each collection has:
  - **handle** = `designer-<handle>` / `artist-<handle>` (this is what the PDP links to)
  - **title** = `Designer: <Name>` / `Artist: <Name>`
  - **rule** = *Product tag is equal to* `Designer: <Name>`
  - **published to the Online Store** (or the link 404s)

So the metafield drives the link; the tag drives collection membership; they must agree.

## Redoing it after adding/editing products — the easy way

The whole thing is automated and idempotent. After adding products or editing a
`custom.designer` / `custom.artist` metafield, just run:

```bash
node scripts/sync-creator-collections.mjs --dry   # preview — shows nothing will surprise you
node scripts/sync-creator-collections.mjs         # apply
```

It reads every product's designer/artist metafields and:
1. Adds any missing `Designer:`/`Artist:` tags to products (never removes tags).
2. Creates any missing smart collections with the correct handle + rule, published to Online Store.
3. Skips everything that already exists (safe to run repeatedly).
4. **Deletes** stale automated `designer-`/`artist-` collections whose person is no longer
   in any product (old pre-split "combined" collections, or a removed title's designer).
   A manual (`custom`) collection under one of those handles is only reported, never
   auto-deleted — remove it by hand if you want it gone.

It needs `SHOPIFY_ADMIN_TOKEN` and `SHOPIFY_URL` in `.env` (already present).

## Doing it by hand (one person) — if you ever need to

1. Products → Collections → **Create collection**.
2. Title `Designer: Jane Doe`. Set **Automated**, condition *Product tag* → *is equal to* → `Designer: Jane Doe`.
3. Save, then bottom of page → **Search engine listing → Edit → Handle** → `designer-jane-doe`
   (must equal the name handleized — lowercase, accents stripped, hyphens).
4. Ensure it's published to the **Online Store** sales channel.
5. Add the tag `Designer: Jane Doe` to each of her games.

## Gotchas

- **Handle must match exactly.** An accent mismatch is the usual cause of a 404
  (`André` → `andre`, not `andr-`). The script gets this right; hand-editing is where it slips.
- **A person who both designs and illustrates** gets two separate collections
  (`designer-kei-kajino` and `artist-kei-kajino`) with two separate tags. That's intended.
- **Draft products** still get tagged, but won't appear in the collection until published.
- **Never rename the tag scheme** (`Designer: <Name>`) without updating every existing
  collection rule to match — that's what caused the earlier leftover "combined" collections.
