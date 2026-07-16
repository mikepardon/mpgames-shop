#!/usr/bin/env node
/**
 * create-index-pages.mjs
 * ------------------------------------------------------------------
 * Creates (or repairs) the four "creator index" storefront pages that the
 * mp-creator-index section + page.<kind>.json templates render:
 *
 *     /pages/designers   -> template "designers"
 *     /pages/artists     -> template "artists"
 *     /pages/publishers  -> template "publishers"
 *     /pages/mechanics   -> template "mechanics"
 *
 * Each page is a searchable A–Z index of every designer / artist / publisher /
 * mechanic in the catalogue (names read live from product data). The homepage
 * "All designers" / "All publishers" links point at these pages.
 *
 * Idempotent — if a page with the handle already exists it only fixes the
 * template_suffix / published flag when needed; it never clobbers page content.
 *
 *   node scripts/create-index-pages.mjs          # apply
 *   node scripts/create-index-pages.mjs --dry    # preview only
 *
 * Needs SHOPIFY_ADMIN_TOKEN + SHOPIFY_URL in .env (already present). The token
 * must have write_content scope (pages live under the Content/Online Store API).
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

// The four pages we want. handle == template_suffix keeps the URL tidy.
const PAGES = [
  { title: 'Designers', handle: 'designers', template_suffix: 'designers' },
  { title: 'Artists', handle: 'artists', template_suffix: 'artists' },
  { title: 'Publishers', handle: 'publishers', template_suffix: 'publishers' },
  { title: 'Mechanics', handle: 'mechanics', template_suffix: 'mechanics' },
];

async function main() {
  console.log(`Store: ${store}${DRY ? '   (DRY RUN — no writes)' : ''}\n`);

  const { pages: existing = [] } = await rest('GET', 'pages.json?limit=250');
  const byHandle = new Map(existing.map((p) => [p.handle, p]));

  for (const want of PAGES) {
    const found = byHandle.get(want.handle);
    if (!found) {
      console.log(`+ create  /pages/${want.handle}  (template: ${want.template_suffix})`);
      if (!DRY) {
        await rest('POST', 'pages.json', {
          page: { title: want.title, handle: want.handle, template_suffix: want.template_suffix, published: true },
        });
      }
      continue;
    }
    const needsSuffix = found.template_suffix !== want.template_suffix;
    const needsPublish = !found.published_at;
    if (needsSuffix || needsPublish) {
      console.log(`~ update  /pages/${want.handle}  (${needsSuffix ? `template ${found.template_suffix || 'default'} -> ${want.template_suffix}` : ''}${needsSuffix && needsPublish ? ', ' : ''}${needsPublish ? 'publish' : ''})`);
      if (!DRY) {
        await rest('PUT', `pages/${found.id}.json`, {
          page: { id: found.id, template_suffix: want.template_suffix, published: true },
        });
      }
    } else {
      console.log(`= ok      /pages/${want.handle}`);
    }
  }

  console.log('\nDone. Visit /pages/designers, /pages/artists, /pages/publishers, /pages/mechanics.');
}

main().catch((e) => { console.error(e); process.exit(1); });
