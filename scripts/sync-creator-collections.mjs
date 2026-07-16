#!/usr/bin/env node
/**
 * sync-creator-collections.mjs
 * ------------------------------------------------------------------
 * Keeps the Designer / Artist collections on the storefront in sync with
 * the `custom.designer` and `custom.artist` product metafields.
 *
 * CONVENTION (matches the collections already in the store):
 *   - Each product is tagged  "Designer: <Name>"  and  "Artist: <Name>"
 *     once per person. Multi-person metafields ("A, B" or "A;B") are split.
 *   - One tag-based automated (smart) collection per unique person:
 *       handle  = designer-<handle> / artist-<handle>   (matches the PDP links,
 *                 handle produced exactly like Liquid's `| handle` filter)
 *       title   = "Designer: <Name>" / "Artist: <Name>"
 *       rule    = product tag EQUALS the same "Designer: <Name>" string
 *       published to the Online Store so the /collections/... link resolves.
 *
 * Idempotent — skips tags/collections that already exist. Re-run it whenever
 * you add or edit products.
 *
 *   node scripts/sync-creator-collections.mjs          # apply changes
 *   node scripts/sync-creator-collections.mjs --dry    # preview only
 *
 * It also DELETES stale automated designer-/artist- collections whose person is
 * no longer in any product (e.g. "combined" collections from before multi-person
 * splitting, or a removed title's designer). Manual (custom) collections under
 * those handles are only reported, never auto-deleted.
 * ------------------------------------------------------------------
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DRY = process.argv.includes('--dry');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// --- credentials from .env ------------------------------------------------
const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
const token = /SHOPIFY_ADMIN_TOKEN=(\S+)/.exec(env)?.[1]?.trim();
const storeUrl = (/SHOPIFY_URL=(\S+)/.exec(env)?.[1]?.trim() || '').replace(/\/+$/, '');
const store = storeUrl.replace(/^https?:\/\//, '');
if (!token || !store) throw new Error('SHOPIFY_ADMIN_TOKEN / SHOPIFY_URL missing from .env');

const API = `https://${store}/admin/api/2024-10`;
const H = { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Mirror Shopify's Liquid `| handle` filter (lowercase, strip accents, hyphenate). */
function handleize(s) {
  return s
    .normalize('NFKD').replace(/[̀-ͯ]/g, '') // drop diacritics: Ondřej -> Ondrej
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Split a metafield holding one or more names ("A, B" or "A;B"). */
function splitNames(v) {
  if (!v) return [];
  return v.replace(/;/g, ',').split(',').map((x) => x.trim()).filter(Boolean);
}

async function gql(query) {
  const r = await fetch(`${API}/graphql.json`, { method: 'POST', headers: H, body: JSON.stringify({ query }) });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}
async function rest(method, endpoint, body) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch(`${API}/${endpoint}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 429) { await sleep(2000); continue; }        // throttled — back off
    await sleep(300);                                              // stay under 2 req/s
    const text = await r.text();
    const json = text ? JSON.parse(text) : {};
    if (!r.ok) throw new Error(`${method} ${endpoint} -> ${r.status} ${text}`);
    return json;
  }
  throw new Error(`${method} ${endpoint} -> gave up after repeated 429s`);
}

// --------------------------------------------------------------------------
async function main() {
  console.log(`Store: ${store}${DRY ? '   (DRY RUN — no writes)' : ''}\n`);

  // 1. Read every product's creators ---------------------------------------
  const data = await gql(`{
    products(first: 250) {
      edges { node {
        legacyResourceId title status tags
        designer: metafield(namespace: "custom", key: "designer") { value }
        artist:   metafield(namespace: "custom", key: "artist")   { value }
      } }
    }
  }`);
  const products = data.products.edges.map((e) => e.node);

  // 2. Compute required tags per product + the unique collection set --------
  const collections = new Map(); // handle -> { handle, title, tag }
  const liveHandles = new Set(); // every handle that SHOULD exist per current catalog
  const wantByProduct = new Map(); // productId -> { tags:Set, existing:Set, title }

  for (const p of products) {
    const tags = new Set();
    const add = (kind, name) => {          // kind = 'Designer' | 'Artist'
      const h = handleize(name);
      if (!h) return;
      const handle = `${kind.toLowerCase()}-${h}`;
      const tag = `${kind}: ${name}`;      // e.g. "Designer: Paolo Mori"
      tags.add(tag);
      liveHandles.add(handle);
      if (!collections.has(handle)) collections.set(handle, { handle, title: tag, tag });
    };
    splitNames(p.designer?.value).forEach((n) => add('Designer', n));
    splitNames(p.artist?.value).forEach((n) => add('Artist', n));
    wantByProduct.set(p.legacyResourceId, { tags, existing: new Set(p.tags), title: p.title });
  }

  // 3. Apply tags -----------------------------------------------------------
  let tagged = 0;
  for (const [id, { tags, existing, title }] of wantByProduct) {
    const missing = [...tags].filter((t) => !existing.has(t));
    if (!missing.length) continue;
    const merged = [...new Set([...existing, ...missing])].join(', ');
    console.log(`TAG  ${title}: +"${missing.join('", +"')}"`);
    if (!DRY) await rest('PUT', `products/${id}.json`, { product: { id, tags: merged } });
    tagged++;
  }
  console.log(`\n${tagged} product(s) ${DRY ? 'would be' : 'were'} re-tagged.\n`);

  // 4. Create missing smart collections ------------------------------------
  const existing = []; // { handle, id, kind: 'smart' | 'custom' }
  for (const [type, kind] of [['smart_collections', 'smart'], ['custom_collections', 'custom']]) {
    const res = await rest('GET', `${type}.json?limit=250&fields=handle,id`);
    (res[type] || []).forEach((c) => existing.push({ handle: c.handle, id: c.id, kind }));
  }
  const existingHandles = new Set(existing.map((c) => c.handle));

  let created = 0;
  for (const { handle, title, tag } of [...collections.values()].sort((a, b) => a.handle.localeCompare(b.handle))) {
    if (existingHandles.has(handle)) continue;
    console.log(`COLL ${handle}  <-  tag "${tag}"`);
    if (!DRY) {
      await rest('POST', 'smart_collections.json', {
        smart_collection: {
          title,
          handle,
          published: true,            // publish to Online Store so the PDP link resolves
          sort_order: 'best-selling',
          disjunctive: false,
          rules: [{ column: 'tag', relation: 'equals', condition: tag }],
        },
      });
    }
    created++;
  }
  console.log(`\n${created} collection(s) ${DRY ? 'would be' : 'were'} created; ${collections.size - created} already existed.`);

  // 5. Delete leftover creator collections that no longer match any product -
  //    (superseded pre-split "combined" handles, or a removed title's person).
  //    Automated (smart) collections are deleted; manual (custom) ones are only
  //    reported, since a hand-built custom collection may be intentional.
  const stale = existing
    .filter((c) => /^(designer|artist)-/.test(c.handle) && !liveHandles.has(c.handle))
    .sort((a, b) => a.handle.localeCompare(b.handle));
  let deleted = 0;
  for (const c of stale) {
    if (c.kind === 'custom') {
      console.log(`SKIP ${c.handle}  (manual collection — delete by hand if unwanted)`);
      continue;
    }
    console.log(`DEL  ${c.handle}  (no matching product)`);
    if (!DRY) await rest('DELETE', `smart_collections/${c.id}.json`);
    deleted++;
  }
  if (stale.length) console.log(`\n${deleted} leftover collection(s) ${DRY ? 'would be' : 'were'} deleted.`);

  console.log(`\nTotal unique creators in catalog: ${collections.size}. Done.`);
}

main().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });
