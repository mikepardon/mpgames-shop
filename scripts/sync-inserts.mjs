#!/usr/bin/env node
/**
 * sync-inserts.mjs
 * ------------------------------------------------------------------
 * Maintains the REVERSE insert link so a board game's product page can show the
 * inserts made for it.
 *
 *   Forward (edited by hand in admin):
 *     insert product  custom.insert_for_game   -> [ game, game, ... ]
 *   Reverse (materialised by THIS script):
 *     game product    custom.available_inserts -> [ insert, insert, ... ]
 *
 * Liquid can't reverse-query a metafield, so we walk every "Board Game Insert"
 * product, read its custom.insert_for_game, invert the mapping, and write
 * custom.available_inserts onto each referenced game. Games that no longer have
 * any insert pointing at them get the metafield cleared.
 *
 * Idempotent — only writes when a game's insert list actually changed.
 *
 *   node scripts/sync-inserts.mjs          # apply
 *   node scripts/sync-inserts.mjs --dry    # preview only
 *
 * Re-run after adding/editing an insert product or changing its insert_for_game.
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
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch(`${API}/graphql.json`, { method: 'POST', headers: H, body: JSON.stringify({ query, variables }) });
    if (r.status === 429) { await sleep(2000); continue; }
    await sleep(250);
    const j = await r.json();
    if (j.errors) throw new Error(JSON.stringify(j.errors));
    return j.data;
  }
  throw new Error('graphql -> gave up after repeated 429s');
}

/** Fetch every product with type, title, and the two insert metafields (paginated). */
async function fetchProducts() {
  const out = [];
  let cursor = null;
  do {
    const data = await gql(
      `query($cursor:String){
         products(first:250, after:$cursor){
           pageInfo{ hasNextPage endCursor }
           edges{ node{
             id title productType
             insert_for_game:   metafield(namespace:"custom", key:"insert_for_game"){ value }
             available_inserts: metafield(namespace:"custom", key:"available_inserts"){ id value }
           } }
         }
       }`,
      { cursor },
    );
    for (const e of data.products.edges) out.push(e.node);
    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (cursor);
  return out;
}

/** list.product_reference metafield value is a JSON array of product GIDs (or null). */
function parseRefs(value) {
  if (!value) return [];
  try {
    const arr = JSON.parse(value);
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  } catch {
    return [];
  }
}

const shortId = (gid) => gid.split('/').pop();
const titleOf = (map, gid) => map.get(gid)?.title || shortId(gid);

async function main() {
  console.log(`Store: ${store}${DRY ? '   (DRY RUN — no writes)' : ''}\n`);

  const products = await fetchProducts();
  const byId = new Map(products.map((p) => [p.id, p]));
  const inserts = products.filter((p) => p.productType === 'Board Game Insert');
  console.log(`${products.length} products · ${inserts.length} Board Game Insert(s)\n`);

  // Invert: gameGid -> Set(insertGid). Order inserts deterministically by title.
  const reverse = new Map();
  for (const ins of [...inserts].sort((a, b) => a.title.localeCompare(b.title))) {
    const games = parseRefs(ins.insert_for_game?.value);
    if (!games.length) {
      console.log(`WARN "${ins.title}" is a Board Game Insert with no custom.insert_for_game set — it will link to no game.`);
      continue;
    }
    for (const g of games) {
      if (!byId.has(g)) { console.log(`WARN "${ins.title}" references a game not in this store (${shortId(g)}) — skipped.`); continue; }
      if (!reverse.has(g)) reverse.set(g, []);
      reverse.get(g).push(ins.id);
    }
  }

  // Diff against what each game currently has, and collect writes/clears.
  const setInputs = [];   // metafieldsSet inputs
  const clearInputs = []; // metafieldIdentifier inputs to delete
  for (const p of products) {
    if (p.productType === 'Board Game Insert') continue; // inserts don't carry the reverse field
    const desired = reverse.get(p.id) || [];
    const current = parseRefs(p.available_inserts?.value);
    const same = desired.length === current.length && desired.every((v, i) => v === current[i]);
    if (same) continue;

    if (desired.length) {
      console.log(`SET  "${p.title}"  available_inserts <- [${desired.map((g) => titleOf(byId, g)).join(', ')}]`);
      setInputs.push({ ownerId: p.id, namespace: 'custom', key: 'available_inserts', type: 'list.product_reference', value: JSON.stringify(desired) });
    } else if (p.available_inserts) {
      console.log(`CLR  "${p.title}"  available_inserts (no inserts point here anymore)`);
      clearInputs.push({ ownerId: p.id, namespace: 'custom', key: 'available_inserts' });
    }
  }

  if (!setInputs.length && !clearInputs.length) {
    console.log('\nEverything already in sync — nothing to write.');
    return;
  }

  if (!DRY) {
    // metafieldsSet accepts up to 25 per call.
    for (let i = 0; i < setInputs.length; i += 25) {
      const batch = setInputs.slice(i, i + 25);
      const res = await gql(
        `mutation($mf:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$mf){ userErrors{ field message } } }`,
        { mf: batch },
      );
      const errs = res.metafieldsSet.userErrors;
      if (errs.length) throw new Error(`metafieldsSet: ${JSON.stringify(errs)}`);
    }
    for (let i = 0; i < clearInputs.length; i += 25) {
      const batch = clearInputs.slice(i, i + 25);
      const res = await gql(
        `mutation($ids:[MetafieldIdentifierInput!]!){ metafieldsDelete(metafields:$ids){ deletedMetafields{ key } userErrors{ field message } } }`,
        { ids: batch },
      );
      const errs = res.metafieldsDelete.userErrors;
      if (errs.length) throw new Error(`metafieldsDelete: ${JSON.stringify(errs)}`);
    }
  }

  console.log(`\n${DRY ? 'Would write' : 'Wrote'} ${setInputs.length} game(s), ${DRY ? 'would clear' : 'cleared'} ${clearInputs.length}. Done.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
