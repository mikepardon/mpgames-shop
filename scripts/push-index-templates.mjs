#!/usr/bin/env node
/**
 * push-index-templates.mjs
 * ------------------------------------------------------------------
 * Uploads the creator-index feature files (the mp-creator-index section and the
 * four page.<kind>.json templates) straight to the *published* theme via the
 * Asset API. Use this when a normal `shopify theme push` isn't landing the JSON
 * templates (they were observed missing from the live theme while the section
 * deployed fine).
 *
 *   node scripts/push-index-templates.mjs          # apply
 *   node scripts/push-index-templates.mjs --dry    # preview only
 *
 * Needs SHOPIFY_ADMIN_TOKEN (with write_themes) + SHOPIFY_URL in .env.
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

async function api(method, endpoint, body) {
  const r = await fetch(`${API}/${endpoint}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${endpoint} -> ${r.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

// Files to push: any non-flag CLI args, else the default creator-index feature set.
const argFiles = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const FILES = argFiles.length ? argFiles : [
  'sections/mp-creator-index.liquid',
  'sections/mp-header.liquid',
  'templates/page.designers.json',
  'templates/page.artists.json',
  'templates/page.publishers.json',
  'templates/page.mechanics.json',
];

async function main() {
  console.log(`Store: ${store}${DRY ? '   (DRY RUN — no writes)' : ''}\n`);
  const { themes } = await api('GET', 'themes.json');
  const live = themes.find((t) => t.role === 'main');
  if (!live) throw new Error('No published (main) theme found');
  console.log(`Published theme: ${live.id} — ${live.name}\n`);

  for (const key of FILES) {
    const value = fs.readFileSync(path.join(root, key), 'utf8');
    console.log(`${DRY ? 'would push' : 'push'}  ${key}  (${value.length} bytes)`);
    if (!DRY) {
      await api('PUT', `themes/${live.id}/assets.json`, { asset: { key, value } });
      await sleep(500); // stay well under asset rate limits
    }
  }
  console.log('\nDone. Hard-refresh /pages/designers, /pages/artists, /pages/publishers, /pages/mechanics.');
}

main().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });
