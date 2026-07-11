#!/usr/bin/env node
/**
 * setup-inserts.mjs
 * ------------------------------------------------------------------
 * One-time (idempotent) store setup for the "Board Game Insert" product type.
 *
 * Creates:
 *   1. Metafield definition  custom.insert_for_game   (list.product_reference)
 *        -> on an INSERT product: the board game(s) this insert is designed for.
 *   2. Metafield definition  custom.available_inserts (list.product_reference)
 *        -> on a BOARD GAME product: the inserts available for it. This is the
 *           REVERSE link, maintained automatically by scripts/sync-inserts.mjs
 *           (Liquid can't reverse-query a metafield, so we materialise it).
 *   Both are set storefront PUBLIC_READ so they're filter-eligible + readable
 *   via the Storefront API, matching every other custom.* definition.
 *
 *   3. Smart collection  board-game-inserts  (product type EQUALS
 *        "Board Game Insert"), published to the Online Store so /collections/
 *        board-game-inserts resolves and the mp-collection page renders.
 *
 * Safe to re-run — anything that already exists is left untouched.
 *
 *   node scripts/setup-inserts.mjs          # apply
 *   node scripts/setup-inserts.mjs --dry    # preview only
 * ------------------------------------------------------------------
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DRY = process.argv.includes('--dry');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
const token = /SHOPIFY_ADMIN_TOKEN=(\S+)/.exec(env)?.[1]?.trim();
const storeUrl = (/SHOPIFY_URL=(\S+)/.exec(env)?.[1]?.trim() || '').replace(/\/+$/, '');
const store = storeUrl.replace(/^https?:\/\//, '');
if (!token || !store) throw new Error('SHOPIFY_ADMIN_TOKEN / SHOPIFY_URL missing from .env');

const API = `https://${store}/admin/api/2024-10`;
const H = { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gql(query, variables) {
  const r = await fetch(`${API}/graphql.json`, { method: 'POST', headers: H, body: JSON.stringify({ query, variables }) });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}
async function rest(method, endpoint, body) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch(`${API}/${endpoint}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 429) { await sleep(2000); continue; }
    await sleep(300);
    const text = await r.text();
    const json = text ? JSON.parse(text) : {};
    if (!r.ok) throw new Error(`${method} ${endpoint} -> ${r.status} ${text}`);
    return json;
  }
  throw new Error(`${method} ${endpoint} -> gave up after repeated 429s`);
}

const PRODUCT_TYPE = 'Board Game Insert';
const COLLECTION_HANDLE = 'board-game-inserts';

const DEFINITIONS = [
  {
    name: 'Insert for (games)',
    namespace: 'custom',
    key: 'insert_for_game',
    description: 'The board game(s) this 3D-printed storage insert is designed for. Set on Board Game Insert products.',
    type: 'list.product_reference',
  },
  {
    name: 'Available inserts',
    namespace: 'custom',
    key: 'available_inserts',
    description: 'The 3D-printed storage inserts available for this board game. Maintained automatically by scripts/sync-inserts.mjs — do not edit by hand.',
    type: 'list.product_reference',
  },
  // Optional print specs shown on the insert product template (all hide gracefully when empty).
  { name: 'Insert — material',      namespace: 'custom', key: 'insert_material',   description: 'Filament/material the printed insert is made from, e.g. "PLA" or "PLA / PETG".', type: 'single_line_text_field' },
  { name: 'Insert — pieces',        namespace: 'custom', key: 'insert_pieces',     description: 'What the insert is made up of, e.g. "5 trays + lid".',                       type: 'single_line_text_field' },
  { name: 'Insert — filament use',  namespace: 'custom', key: 'insert_filament',   description: 'Approx. filament used for a full print, e.g. "~180 g".',                     type: 'single_line_text_field' },
  { name: 'Insert — print time',    namespace: 'custom', key: 'insert_print_time', description: 'Approx. total print time, e.g. "~14 hrs".',                                  type: 'single_line_text_field' },
  { name: 'Insert — min build volume', namespace: 'custom', key: 'insert_build_volume', description: 'Minimum printer bed/build volume needed, e.g. "220 × 220 × 250 mm".',    type: 'single_line_text_field' },
  { name: 'Insert — assembly',      namespace: 'custom', key: 'insert_assembly',   description: 'Assembly note, e.g. "Snap-fit, no glue" or "Glue required".',                type: 'single_line_text_field' },
];

async function ensureDefinition(def) {
  // Already defined?
  const existing = await gql(
    `query($ns:String!,$key:String!){ metafieldDefinitions(first:1, ownerType:PRODUCT, namespace:$ns, key:$key){ edges{ node{ id type{ name } } } } }`,
    { ns: def.namespace, key: def.key },
  );
  const node = existing.metafieldDefinitions.edges[0]?.node;
  if (node) {
    console.log(`DEF  custom.${def.key}  already exists (${node.type.name}) — skipped`);
    return;
  }
  console.log(`DEF  custom.${def.key}  <-  ${def.type}  (storefront PUBLIC_READ)`);
  if (DRY) return;
  const res = await gql(
    `mutation($d: MetafieldDefinitionInput!){
       metafieldDefinitionCreate(definition:$d){
         createdDefinition{ id }
         userErrors{ field message code }
       }
     }`,
    {
      d: {
        name: def.name,
        namespace: def.namespace,
        key: def.key,
        description: def.description,
        type: def.type,
        ownerType: 'PRODUCT',
        access: { storefront: 'PUBLIC_READ' },
      },
    },
  );
  const errs = res.metafieldDefinitionCreate.userErrors.filter((e) => e.code !== 'TAKEN');
  if (errs.length) throw new Error(`custom.${def.key}: ${JSON.stringify(errs)}`);
}

async function ensureCollection() {
  // Look in both smart + custom collections for the handle.
  for (const type of ['smart_collections', 'custom_collections']) {
    const res = await rest('GET', `${type}.json?limit=250&fields=handle,id`);
    if ((res[type] || []).some((c) => c.handle === COLLECTION_HANDLE)) {
      console.log(`COLL ${COLLECTION_HANDLE}  already exists (${type}) — skipped`);
      return;
    }
  }
  console.log(`COLL ${COLLECTION_HANDLE}  <-  product type EQUALS "${PRODUCT_TYPE}"  (published to Online Store)`);
  if (DRY) return;
  await rest('POST', 'smart_collections.json', {
    smart_collection: {
      title: 'Board Game Inserts',
      handle: COLLECTION_HANDLE,
      published: true, // publishes to the Online Store sales channel (REST legacy behaviour)
      sort_order: 'best-selling',
      disjunctive: false,
      body_html:
        '<p>3D-printed storage inserts and organisers for your favourite board games. ' +
        'Buy the ready-to-print STL files or order a printed insert shipped to your door.</p>',
      rules: [{ column: 'type', relation: 'equals', condition: PRODUCT_TYPE }],
    },
  });
}

async function main() {
  console.log(`Store: ${store}${DRY ? '   (DRY RUN — no writes)' : ''}\n`);
  for (const def of DEFINITIONS) await ensureDefinition(def);
  console.log('');
  await ensureCollection();
  console.log('\nDone. Next: install the Digital Downloads app (browser) and create your first');
  console.log('Board Game Insert product with a "Format" option (STL Digital Download / 3D Printed).');
  console.log('See docs/board-game-inserts.md.');
}

main().catch((e) => { console.error(e); process.exit(1); });
