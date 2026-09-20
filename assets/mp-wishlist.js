/* MPGames wishlist client.
   - Hydrates heart fill-state on load from the wishlist read endpoint.
   - Heart click -> "choose a list" picker (create new or toggle existing groups).
   - Exposes window.MPWishlist for the cart page (remove/qty-0 prompt + add-back table)
     and the wishlist page to consume.
   Endpoint contract (see docs/wishlist-integration.md):
     GET  {endpoint}            -> { ok, groups:[{ name, items:[{ product_id, handle, added_at }] }] }
     POST {endpoint}            -> action=add|remove & product_id & group (+ handle,title on add)
*/
(function () {
  "use strict";

  var cfg = window.mpWishlist || {};
  if (!cfg.enabled) { return; }
  var ENDPOINT = cfg.endpoint || "/apps/notify/proxy-wishlist";
  var DEFAULT_GROUP = "Wishlist";

  // membership: { "<productId>": Set<groupName> } ; rawGroups: server groups payload
  var membership = {};
  var handles = {};
  var rawGroups = [];
  var groupNames = [];
  var readyResolve;
  var ready = new Promise(function (resolve) { readyResolve = resolve; });

  function key(id) { return String(id); }
  function currentPath() { return window.location.pathname + window.location.search; }

  function gotoLogin() {
    var url = cfg.loginUrl || "/account/login";
    window.location.href = url + (url.indexOf("?") === -1 ? "?" : "&") + "return_url=" + encodeURIComponent(currentPath());
  }

  function isWished(id) {
    var set = membership[key(id)];
    return !!(set && set.size > 0);
  }
  function groupsFor(id) {
    var set = membership[key(id)];
    return set ? Array.prototype.slice.call(set) : [];
  }
  function ensureGroupName(name) {
    if (groupNames.indexOf(name) === -1) { groupNames.push(name); }
  }

  function applyHearts() {
    document.querySelectorAll("[data-wishlist-btn]").forEach(function (btn) {
      var on = isWished(btn.getAttribute("data-product-id"));
      btn.classList.toggle("is-wished", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.setAttribute("title", on ? "Edit wishlists" : "Add to wishlist");
      var label = btn.querySelector("[data-wishlist-label]");
      if (label) { label.textContent = on ? "In your wishlist" : "Save to wishlist"; }
    });
    updateNavCount();
  }

  function updateNavCount() {
    var el = document.querySelector("[data-wishlist-count]");
    if (!el) { return; }
    var total = Object.keys(membership).filter(function (id) { return membership[id].size > 0; }).length;
    if (total > 0) { el.textContent = total; el.hidden = false; }
    else { el.textContent = ""; el.hidden = true; }
  }

  function loadState() {
    if (!cfg.loggedIn) { return Promise.resolve(); }
    return fetch(ENDPOINT, { headers: { "Accept": "application/json" }, credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : undefined; })
      .then(function (data) {
        membership = {}; handles = {}; rawGroups = []; groupNames = [];
        if (data && data.ok !== false && Array.isArray(data.groups)) {
          rawGroups = data.groups;
          data.groups.forEach(function (g) {
            ensureGroupName(g.name);
            (g.items || []).forEach(function (item) {
              var id = key(item.product_id != null ? item.product_id : item.id);
              if (!membership[id]) { membership[id] = new Set(); }
              membership[id].add(g.name);
              if (item.handle) { handles[id] = item.handle; }
            });
          });
        }
      })
      .catch(function () { /* endpoint not ready -> degrade to empty state */ });
  }

  function post(action, productId, group, extra) {
    var body = new URLSearchParams();
    body.set("action", action);
    body.set("product_id", String(productId));
    if (group) { body.set("group", group); }
    if (extra && extra.handle) { body.set("handle", extra.handle); }
    if (extra && extra.title) { body.set("title", extra.title); }
    return fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
      credentials: "same-origin",
      body: body
    }).then(function (r) {
      return r.json().catch(function () { return { ok: r.ok }; });
    });
  }

  function add(productId, group, extra) {
    return post("add", productId, group || DEFAULT_GROUP, extra).then(function (res) {
      if (res && res.ok !== false) {
        var id = key(productId);
        if (!membership[id]) { membership[id] = new Set(); }
        membership[id].add(group || DEFAULT_GROUP);
        if (extra && extra.handle) { handles[id] = extra.handle; }
        ensureGroupName(group || DEFAULT_GROUP);
        applyHearts();
      }
      return res;
    });
  }
  function remove(productId, group) {
    return post("remove", productId, group).then(function (res) {
      if (res && res.ok !== false) {
        var id = key(productId);
        if (membership[id]) { membership[id].delete(group); }
        applyHearts();
      }
      return res;
    });
  }

  /* ---------------- picker modal ---------------- */
  var pickerEl, pickerCtx;
  function buildPicker() {
    if (pickerEl) { return pickerEl; }
    pickerEl = document.createElement("div");
    pickerEl.className = "mpw-modal";
    pickerEl.hidden = true;
    pickerEl.innerHTML =
      '<div class="mpw-modal__ov" data-mpw-close></div>' +
      '<div class="mpw-modal__panel" role="dialog" aria-modal="true" aria-label="Save to wishlist">' +
        '<button type="button" class="mpw-modal__close" data-mpw-close aria-label="Close">&times;</button>' +
        '<h3 class="mpw-modal__title">Save to your wishlist</h3>' +
        '<p class="mpw-modal__sub" data-mpw-sub></p>' +
        '<div class="mpw-modal__groups" data-mpw-groups></div>' +
        '<form class="mpw-modal__new" data-mpw-new>' +
          '<input type="text" placeholder="New list name (e.g. Christmas)" data-mpw-newname aria-label="New list name" maxlength="60">' +
          '<button type="submit">Create</button>' +
        '</form>' +
        '<p class="mpw-modal__err" data-mpw-err hidden></p>' +
        '<div class="mpw-modal__actions"><button type="button" class="mpw-modal__done" data-mpw-close>Done</button></div>' +
      '</div>';
    document.body.appendChild(pickerEl);
    pickerEl.querySelectorAll("[data-mpw-close]").forEach(function (el) { el.addEventListener("click", closePicker); });
    pickerEl.querySelector("[data-mpw-new]").addEventListener("submit", function (e) {
      e.preventDefault();
      var input = pickerEl.querySelector("[data-mpw-newname]");
      var name = (input.value || "").trim();
      if (!name) { return; }
      showErr("");
      add(pickerCtx.productId, name, pickerCtx).then(function (res) {
        if (res && res.ok === false) { showErr(res.message || "Couldn’t create that list."); return; }
        input.value = "";
        renderGroups();
      }).catch(function () { showErr("Something went wrong. Please try again."); });
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !pickerEl.hidden) { closePicker(); } });
    return pickerEl;
  }
  function showErr(msg) {
    var el = pickerEl.querySelector("[data-mpw-err]");
    if (!msg) { el.hidden = true; el.textContent = ""; return; }
    el.textContent = msg; el.hidden = false;
  }
  function renderGroups() {
    var wrap = pickerEl.querySelector("[data-mpw-groups]");
    var names = groupNames.slice();
    if (names.indexOf(DEFAULT_GROUP) === -1) { names.unshift(DEFAULT_GROUP); }
    wrap.innerHTML = "";
    names.forEach(function (name) {
      var inThis = groupsFor(pickerCtx.productId).indexOf(name) !== -1;
      var row = document.createElement("label");
      row.className = "mpw-group";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = inThis;
      var span = document.createElement("span");
      span.className = "mpw-group__name";
      span.textContent = name;
      row.appendChild(cb);
      row.appendChild(span);
      wrap.appendChild(row);
      cb.addEventListener("change", function () {
        cb.disabled = true;
        showErr("");
        var op = cb.checked ? add(pickerCtx.productId, name, pickerCtx) : remove(pickerCtx.productId, name);
        op.then(function (res) {
          cb.disabled = false;
          if (res && res.ok === false) { cb.checked = !cb.checked; showErr(res.message || "Please try again."); }
        }).catch(function () { cb.disabled = false; cb.checked = !cb.checked; showErr("Something went wrong. Please try again."); });
      });
    });
  }
  function openPicker(productId, handle, title) {
    if (!cfg.loggedIn) { gotoLogin(); return; }
    buildPicker();
    pickerCtx = { productId: productId, handle: handle, title: title };
    pickerEl.querySelector("[data-mpw-sub]").innerHTML = title
      ? "Add <b>" + escapeHtml(title) + "</b> to a list, or create a new one."
      : "Choose a list, or create a new one.";
    showErr("");
    renderGroups();
    pickerEl.hidden = false;
    document.body.style.overflow = "hidden";
    var input = pickerEl.querySelector("[data-mpw-newname]");
    if (input) { input.value = ""; }
  }
  function closePicker() { if (pickerEl) { pickerEl.hidden = true; document.body.style.overflow = ""; } }

  /* ---------------- cart remove prompt ---------------- */
  var confirmEl;
  function buildConfirm() {
    if (confirmEl) { return confirmEl; }
    confirmEl = document.createElement("div");
    confirmEl.className = "mpw-modal";
    confirmEl.hidden = true;
    confirmEl.innerHTML =
      '<div class="mpw-modal__ov" data-mpw-cancel></div>' +
      '<div class="mpw-modal__panel" role="dialog" aria-modal="true" aria-label="Save before removing">' +
        '<button type="button" class="mpw-modal__close" data-mpw-cancel aria-label="Close">&times;</button>' +
        '<h3 class="mpw-modal__title">Save it for later?</h3>' +
        '<p class="mpw-modal__sub" data-mpw-cptext></p>' +
        '<div class="mpw-modal__actions">' +
          '<button type="button" class="mpw-modal__primary" data-mpw-save>Add to wishlist</button>' +
          '<button type="button" class="mpw-modal__done" data-mpw-remove>Remove anyway</button>' +
        '</div>' +
        '<div style="text-align:center;margin-top:10px"><button type="button" class="mpw-modal__ghost" data-mpw-cancel>Keep in basket</button></div>' +
      '</div>';
    document.body.appendChild(confirmEl);
    return confirmEl;
  }
  function openCartPrompt(opts) {
    // opts: { productId, handle, title, onRemove }
    if (!cfg.loggedIn) { if (opts.onRemove) { opts.onRemove(); } return; }
    buildConfirm();
    confirmEl.querySelector("[data-mpw-cptext]").innerHTML =
      "Would you like to add <b>" + escapeHtml(opts.title || "this item") + "</b> to your wishlist before removing it from your basket?";
    function cleanup() { confirmEl.hidden = true; document.body.style.overflow = ""; unbind(); }
    function onSave() {
      var btn = confirmEl.querySelector("[data-mpw-save]");
      btn.disabled = true; btn.textContent = "Saving…";
      add(opts.productId, DEFAULT_GROUP, { handle: opts.handle, title: opts.title }).then(function () {
        btn.disabled = false; btn.textContent = "Add to wishlist";
        cleanup(); if (opts.onRemove) { opts.onRemove(); }
      }).catch(function () {
        btn.disabled = false; btn.textContent = "Add to wishlist";
        cleanup(); if (opts.onRemove) { opts.onRemove(); }
      });
    }
    function onRemove() { cleanup(); if (opts.onRemove) { opts.onRemove(); } }
    function onCancel() { cleanup(); }
    function onKey(e) { if (e.key === "Escape") { onCancel(); } }
    function bind() {
      confirmEl.querySelector("[data-mpw-save]").addEventListener("click", onSave);
      confirmEl.querySelector("[data-mpw-remove]").addEventListener("click", onRemove);
      confirmEl.querySelectorAll("[data-mpw-cancel]").forEach(function (el) { el.addEventListener("click", onCancel); });
      document.addEventListener("keydown", onKey);
    }
    function unbind() {
      confirmEl.querySelector("[data-mpw-save]").removeEventListener("click", onSave);
      confirmEl.querySelector("[data-mpw-remove]").removeEventListener("click", onRemove);
      confirmEl.querySelectorAll("[data-mpw-cancel]").forEach(function (el) { el.removeEventListener("click", onCancel); });
      document.removeEventListener("keydown", onKey);
    }
    bind();
    confirmEl.hidden = false;
    document.body.style.overflow = "hidden";
  }

  /* ---------------- wishlist page ---------------- */
  function money(cents) {
    var f = (cfg.moneyFormat || "£{{amount}}");
    var value = (Number(cents) / 100).toFixed(2);
    return f.replace(/\{\{\s*amount[^}]*\}\}/, value);
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function renderPage() {
    var host = document.querySelector("[data-mpw-page]");
    if (!host) { return; }
    if (!cfg.loggedIn) { return; } // server already rendered the guest prompt
    if (!rawGroups.length) {
      host.innerHTML = '<p class="mpw-page__empty">Your wishlist is empty. Tap the heart on any product to save it here.</p>';
      return;
    }
    host.innerHTML = "";
    rawGroups.forEach(function (group) {
      var items = (group.items || []).filter(function (it) { return it.handle; });
      var block = document.createElement("div");
      block.className = "mpw-group-block";
      block.innerHTML =
        '<div class="mpw-group-block__head">' +
          '<div class="mpw-group-block__title">' + escapeHtml(group.name) + '</div>' +
          '<div class="mpw-group-block__count">' + (group.items || []).length + ' item' + ((group.items || []).length === 1 ? '' : 's') + '</div>' +
        '</div><div class="mpw-grid" data-grid></div>';
      host.appendChild(block);
      var grid = block.querySelector("[data-grid]");
      if (!items.length) {
        grid.innerHTML = '<p class="mpw-page__empty">Items in this list aren’t available to preview.</p>';
        return;
      }
      items.forEach(function (it) {
        fetch("/products/" + it.handle + ".js", { headers: { "Accept": "application/json" } })
          .then(function (r) { return r.ok ? r.json() : undefined; })
          .then(function (p) { if (p) { grid.appendChild(pageCard(p, group.name)); } })
          .catch(function () {});
      });
    });
  }
  function pageCard(p, groupName) {
    var el = document.createElement("div");
    el.className = "mpw-item";
    var img = p.featured_image ? '<img src="' + p.featured_image + '&width=360" alt="' + escapeHtml(p.title) + '" loading="lazy">' : "";
    var foot = p.available
      ? '<button type="button" class="mpw-item__add" data-add>Add to basket</button>'
      : '<span class="mpw-item__soldout">Out of stock</span>';
    el.innerHTML =
      '<a href="' + p.url + '" class="mpw-item__media">' + img + '</a>' +
      '<div class="mpw-item__body">' +
        '<a href="' + p.url + '" class="mpw-item__name">' + escapeHtml(p.title) + '</a>' +
        '<div class="mpw-item__price">' + money(p.price) + '</div>' +
        '<div class="mpw-item__foot">' + foot +
          '<button type="button" class="mpw-item__remove" data-remove title="Remove from ' + escapeHtml(groupName) + '">Remove</button>' +
        '</div>' +
      '</div>';
    var addBtn = el.querySelector("[data-add]");
    if (addBtn) {
      addBtn.addEventListener("click", function () {
        addBtn.disabled = true; addBtn.textContent = "Adding…";
        cartAdd(p.variants && p.variants[0] && p.variants[0].id).then(function () {
          addBtn.textContent = "Added ✓"; addBtn.classList.add("is-added");
        }).catch(function () { addBtn.disabled = false; addBtn.textContent = "Add to basket"; });
      });
    }
    el.querySelector("[data-remove]").addEventListener("click", function () {
      remove(p.id, groupName).then(function () { el.remove(); });
    });
    return el;
  }

  function cartAdd(variantId) {
    if (!variantId) { return Promise.reject(); }
    return fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ items: [{ id: variantId, quantity: 1 }] })
    }).then(function (r) { if (!r.ok) { throw new Error("add failed"); } return r.json(); });
  }

  /* ---------------- cart add-back table ---------------- */
  function renderCartTable() {
    var host = document.querySelector("[data-mpw-cart-list]");
    if (!host || !cfg.loggedIn) { return; }
    // product ids already in the cart, so we don't offer to re-add them
    var inCart = {};
    (host.getAttribute("data-cart-product-ids") || "").split(",").forEach(function (x) { if (x) { inCart[x.trim()] = true; } });

    var seen = {};
    var items = [];
    rawGroups.forEach(function (g) {
      (g.items || []).forEach(function (it) {
        var id = key(it.product_id != null ? it.product_id : it.id);
        if (it.handle && !seen[id] && !inCart[id]) { seen[id] = true; items.push(it); }
      });
    });
    if (!items.length) { return; }
    var section = host.closest("[data-mpw-cart-section]");
    if (section) { section.hidden = false; }

    items.slice(0, 6).forEach(function (it) {
      fetch("/products/" + it.handle + ".js", { headers: { "Accept": "application/json" } })
        .then(function (r) { return r.ok ? r.json() : undefined; })
        .then(function (p) { if (p) { host.appendChild(cartRow(p)); } })
        .catch(function () {});
    });
  }
  function cartRow(p) {
    var row = document.createElement("div");
    row.className = "mpw-cart-list__row";
    var img = p.featured_image ? '<img src="' + p.featured_image + '&width=96" alt="' + escapeHtml(p.title) + '" loading="lazy">' : "";
    var action = p.available
      ? '<button type="button" class="mpw-cart-list__add" data-add>Add</button>'
      : '<span class="mpw-item__soldout" style="flex:none">Out of stock</span>';
    row.innerHTML =
      '<a href="' + p.url + '" class="mpw-cart-list__thumb">' + img + '</a>' +
      '<div class="mpw-cart-list__info">' +
        '<a href="' + p.url + '" class="mpw-cart-list__name">' + escapeHtml(p.title) + '</a>' +
        '<div class="mpw-cart-list__meta">From your wishlist</div>' +
      '</div>' +
      '<div class="mpw-cart-list__price">' + money(p.price) + '</div>' +
      action;
    var addBtn = row.querySelector("[data-add]");
    if (addBtn) {
      addBtn.addEventListener("click", function () {
        addBtn.disabled = true; addBtn.textContent = "Adding…";
        cartAdd(p.variants && p.variants[0] && p.variants[0].id).then(function () {
          window.location.reload();
        }).catch(function () { addBtn.disabled = false; addBtn.textContent = "Add"; });
      });
    }
    return row;
  }

  /* ---------------- wire up ---------------- */
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-wishlist-btn]");
    if (!btn) { return; }
    e.preventDefault();
    e.stopPropagation();
    openPicker(btn.getAttribute("data-product-id"), btn.getAttribute("data-product-handle"), btn.getAttribute("data-product-title"));
  });

  window.MPWishlist = {
    ready: ready,
    isWished: isWished,
    open: openPicker,
    openCartPrompt: openCartPrompt,
    add: add,
    remove: remove,
    refresh: function () { return loadState().then(function () { applyHearts(); }); }
  };

  function init() {
    loadState().then(function () {
      applyHearts();
      renderPage();
      renderCartTable();
      readyResolve();
    });
  }
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", init); }
  else { init(); }
})();
