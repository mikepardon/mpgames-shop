# Wishlist — storefront ↔ back-office contract

The storefront (this theme) is wired up for wishlists. This documents what the
theme sends/expects so the back office (`partners.mpgames.io`) can match it.

All calls go through the **existing App Proxy** — the same one the "notify me"
button uses. Its storefront base is **`/apps/notify`**, so the wishlist path is:

```
/apps/notify/proxy-wishlist   ->  https://partners.mpgames.io/webhooks/shopify/proxy-wishlist
```

Shopify signs each request and injects `logged_in_customer_id` for signed-in
shoppers. The theme never sends the customer id.

---

## 1. Write — add / remove (LIVE, already built)

The theme posts exactly as your spec describes:

```
POST /apps/notify/proxy-wishlist
Content-Type: application/x-www-form-urlencoded
```

| Param          | Sent by theme | Notes                                                            |
| -------------- | ------------- | --------------------------------------------------------------- |
| `action`       | `add`/`remove`| `add` when saving, `remove` when unticking a group.             |
| `product_id`   | yes           | Shopify product id.                                             |
| `group`        | yes           | Group name; defaults to `Wishlist`.                            |
| `handle`       | yes (on add)  | **Please persist this** — see §3. Shopify product handle.       |
| `title`        | yes (on add)  | Convenience; persist if useful.                                 |

The theme treats existing responses (`{ ok:true, action:"added"|"removed" }`,
`422` when signed out) exactly as documented.

---

## 2. Read — list the customer's wishlist (NEEDS BUILDING)

This is the "small addition" your doc offered. The theme needs it for three
things: filling the heart icons on page load, populating the "which list?"
picker, and rendering the **My Wishlist** page and the cart add-back table.

```
GET /apps/notify/proxy-wishlist
Accept: application/json
```

Shopify injects `logged_in_customer_id`. Return that customer's groups + items:

```jsonc
// 200 — signed in
{
  "ok": true,
  "groups": [
    {
      "name": "Wishlist",
      "items": [
        { "product_id": 1234567890, "handle": "catan", "added_at": "2026-09-20T10:30:00.000Z" }
      ]
    },
    {
      "name": "Christmas Items",
      "items": [
        { "product_id": 987, "handle": "wingspan", "added_at": "2026-09-18T09:00:00.000Z" }
      ]
    }
  ]
}

// 422 — signed out (nothing rendered client-side)
{ "ok": false, "message": "You must be signed in to use wishlists." }
```

- **Only `removed_at IS NULL` items** should appear (removed rows stay in your DB
  but must not come back here).
- **`handle` is required per item.** The storefront resolves product display data
  (title, image, price, availability) by fetching `/products/{handle}.js` live from
  Shopify, so prices/stock are always current. Without a handle an item can't be
  rendered on the wishlist page or the cart table (its heart still lights up if the
  `product_id` matches). If you don't store the handle, either persist the one we
  send on `add` (§1), or look it up from the Shopify product id when answering.
- `added_at` is optional (used only for display/sorting later).

Until this endpoint exists, the storefront degrades gracefully: hearts stay
unfilled on load, the picker offers free-form group names only, and the My
Wishlist page / cart table show an empty state.

---

## 3. Why we send `handle` on add

The read endpoint must return a `handle` per item so the storefront can render
cards. The simplest way to guarantee you have it is to persist the `handle` the
theme sends on every `add`. Alternatively, resolve it from `product_id` via the
Shopify Admin API when building the GET response.

---

## 4. Storefront surfaces that consume this

| Surface                        | Uses                                    |
| ------------------------------ | --------------------------------------- |
| Heart on every product card    | GET (fill state), POST add/remove       |
| Product page "Save to wishlist"| GET (fill state), POST add/remove       |
| "Which list?" picker modal     | GET (existing groups), POST add/remove  |
| Header "My Wishlist" link+count| GET (count)                             |
| `/pages/wishlist` page         | GET (groups+items) + `/products/*.js`   |
| Cart remove prompt             | POST add (to `Wishlist`)                |
| Cart "From your wishlist" table| GET (items) + `/products/*.js`          |

---

## 5. Theme setup checklist (Shopify admin)

- [ ] Confirm the App Proxy subpath is `notify` so `/apps/notify/proxy-wishlist`
      resolves (same proxy as the notify button).
- [ ] Build the **GET** read endpoint in §2.
- [ ] Persist / resolve the product **handle** (§3).
- [ ] Create a page (e.g. **Wishlist**, handle `wishlist`) and assign it the
      **MP Wishlist** template so `/pages/wishlist` works (the header link points
      there).
- [ ] Register `customers/*` webhooks + grant protected customer data access
      (per the back-office doc) for customer sync.
