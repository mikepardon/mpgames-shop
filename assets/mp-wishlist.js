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

  // Local id -> {handle,title} cache, populated from every heart the shopper sees and
  // every add. Lets the wishlist page + cart table render even when the read endpoint
  // returns items without a handle (it's still the reliable cross-device source).
  var HANDLE_CACHE_KEY = "mp_wishlist_handles";
  function readHandleCache() { try { return JSON.parse(localStorage.getItem(HANDLE_CACHE_KEY)) || {}; } catch (e) { return {}; } }
  function cacheHandle(id, handle, title) {
    if (!id || !handle) { return; }
    try {
      var c = readHandleCache();
      var k = key(id);
      c[k] = { handle: handle, title: title || (c[k] && c[k].title) || "" };
      localStorage.setItem(HANDLE_CACHE_KEY, JSON.stringify(c));
    } catch (e) {}
  }
  function resolveHandle(id) { return handles[key(id)] || (readHandleCache()[key(id)] || {}).handle; }

  // Last-resort id->handle resolver: pull the full catalogue from Shopify's public
  // /products.json (paged) and cache each handle. Covers saved products the shopper
  // hasn't browsed and that the read endpoint returns without a handle.
  var catalogLoaded = false;
  function loadCatalog() {
    if (catalogLoaded) { return Promise.resolve(); }
    var page = 1;
    function nextPage() {
      return fetch("/products.json?limit=250&page=" + page, { headers: { "Accept": "application/json" } })
        .then(function (r) { return r.ok ? r.json() : { products: [] }; })
        .then(function (d) {
          var list = (d && d.products) || [];
          list.forEach(function (p) { cacheHandle(p.id, p.handle, p.title); });
          if (list.length >= 250 && page < 10) { page++; return nextPage(); }
        });
    }
    return nextPage().then(function () { catalogLoaded = true; }).catch(function () { catalogLoaded = true; });
  }
  // Resolve handles for a set of ids, loading the catalogue only if some are still missing.
  function ensureHandles(ids) {
    var missing = ids.some(function (id) { return !resolveHandle(id); });
    return missing ? loadCatalog() : Promise.resolve();
  }

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
    return set ? Array.from(set) : [];
  }
  function ensureGroupName(name) {
    if (groupNames.indexOf(name) === -1) { groupNames.push(name); }
  }

  function applyHearts() {
    document.querySelectorAll("[data-wishlist-btn]").forEach(function (btn) {
      var id = btn.getAttribute("data-product-id");
      cacheHandle(id, btn.getAttribute("data-product-handle"), btn.getAttribute("data-product-title"));
      var on = isWished(id);
      btn.classList.toggle("is-wished", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.setAttribute("title", on ? "Remove from wishlist" : "Add to wishlist");
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
        if (extra && extra.handle) { handles[id] = extra.handle; cacheHandle(productId, extra.handle, extra.title); }
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

  /* ---------------- list management + sharing api ---------------- */
  function apiPost(payload) {
    return fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json().catch(function () { return { ok: r.ok }; }); });
  }
  function renameGroup(uuid, newName) { return apiPost({ action: "rename_group", group_uuid: uuid, new_name: newName }); }
  function deleteGroupApi(uuid) { return apiPost({ action: "delete_group", group_uuid: uuid }); }
  function moveItem(productId, fromUuid, toName) { return apiPost({ action: "move_item", product_id: productId, from_group: fromUuid, to_group: toName }); }
  function shareGroup(uuid) { return apiPost({ action: "share", group_uuid: uuid }); }
  function unshareGroup(uuid) { return apiPost({ action: "unshare", group_uuid: uuid }); }
  function fetchShared(token) {
    return fetch(ENDPOINT + "?action=shared&token=" + encodeURIComponent(token), { headers: { "Accept": "application/json" }, credentials: "same-origin" })
      .then(function (r) { return r.json().catch(function () { return { ok: false }; }); });
  }
  function shareUrl(token) { return window.location.origin + "/pages/wishlist?shared=" + encodeURIComponent(token); }
  function reloadAndRepaint() {
    return loadState().then(function () { applyHearts(); if (document.querySelector("[data-mpw-page]")) { renderPage(); } });
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
    var sharedToken = new URLSearchParams(window.location.search).get("shared");
    if (sharedToken) { renderSharedList(host, sharedToken); return; }
    if (!cfg.loggedIn) { host.innerHTML = guestPromptHtml(); return; }
    if (!rawGroups.length) {
      host.innerHTML = '<p class="mpw-page__empty">Your wishlist is empty. Tap the heart on any product to save it here.</p>';
      return;
    }
    var allIds = [];
    rawGroups.forEach(function (g) { (g.items || []).forEach(function (it) { allIds.push(key(it.product_id != null ? it.product_id : it.id)); }); });
    ensureHandles(allIds).then(function () { paintPage(host); });
  }
  function guestPromptHtml() {
    var back = encodeURIComponent(window.location.pathname);
    var login = (cfg.loginUrl || "/account/login") + "?return_url=" + back;
    var reg = (cfg.registerUrl || "/account/register") + "?return_url=" + back;
    return '<p class="mpw-page__guest">Please <a href="' + login + '">log in</a> or <a href="' + reg + '">create an account</a> to view and save your wishlists.</p>';
  }

  /* ---------------- shared (read-only) list ---------------- */
  function renderSharedList(host, token) {
    host.innerHTML = '<p class="mpw-page__loading">Loading shared list&hellip;</p>';
    fetchShared(token).then(function (data) {
      if (!data || data.ok === false) {
        host.innerHTML = '<p class="mpw-page__empty">This shared list isn’t available — the link may have been turned off.</p>';
        return;
      }
      var titleEl = document.querySelector("[data-mpw-title]");
      if (titleEl) { titleEl.textContent = data.name || "Shared wishlist"; }
      var introEl = document.querySelector("[data-mpw-intro]");
      if (introEl) { introEl.textContent = data.owner_name ? ("A wishlist shared by " + data.owner_name) : "A shared wishlist"; }
      var items = (data.items || []).filter(function (it) { return it.handle; });
      if (!items.length) { host.innerHTML = '<p class="mpw-page__empty">This list is empty.</p>'; return; }
      host.innerHTML = '<div class="mpw-grid" data-grid></div>';
      var grid = host.querySelector("[data-grid]");
      items.forEach(function (it) {
        fetch("/products/" + it.handle + ".js", { headers: { "Accept": "application/json" } })
          .then(function (r) { return r.ok ? r.json() : undefined; })
          .then(function (p) { if (p) { grid.appendChild(sharedCard(p)); } })
          .catch(function () {});
      });
    });
  }
  function sharedCard(p) {
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
        '<div class="mpw-item__foot">' + foot + '</div>' +
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
    return el;
  }
  function paintPage(host) {
    host.innerHTML = "";
    rawGroups.forEach(function (group) {
      var count = (group.items || []).length;
      var items = (group.items || []).map(function (it) {
        var id = key(it.product_id != null ? it.product_id : it.id);
        return { id: id, handle: it.handle || resolveHandle(id) };
      }).filter(function (x) { return x.handle; });

      var block = document.createElement("div");
      block.className = "mpw-group-block";
      block.innerHTML =
        '<div class="mpw-group-block__head">' +
          '<div class="mpw-group-block__title" data-title>' + escapeHtml(group.name) + '</div>' +
          '<div class="mpw-group-block__actions">' +
            '<span class="mpw-group-block__count">' + count + ' item' + (count === 1 ? '' : 's') + '</span>' +
            '<button type="button" class="mpw-link" data-share>' + (group.share_token ? 'Sharing' : 'Share') + '</button>' +
            '<button type="button" class="mpw-link" data-rename>Rename</button>' +
            '<button type="button" class="mpw-link mpw-link--danger" data-delete>Delete</button>' +
          '</div>' +
        '</div>' +
        '<div class="mpw-share" data-sharebar' + (group.share_token ? '' : ' hidden') + '></div>' +
        '<div class="mpw-grid" data-grid></div>';
      host.appendChild(block);
      wireGroupControls(block, group);
      if (group.share_token) { renderShareBar(block.querySelector("[data-sharebar]"), group); }

      var grid = block.querySelector("[data-grid]");
      if (!items.length) {
        grid.innerHTML = '<p class="mpw-page__empty">Items in this list aren’t available to preview.</p>';
        return;
      }
      items.forEach(function (x) {
        fetch("/products/" + x.handle + ".js", { headers: { "Accept": "application/json" } })
          .then(function (r) { return r.ok ? r.json() : undefined; })
          .then(function (p) { if (p) { grid.appendChild(pageCard(p, group)); } })
          .catch(function () {});
      });
    });
  }
  function wireGroupControls(block, group) {
    var titleEl = block.querySelector("[data-title]");
    block.querySelector("[data-rename]").addEventListener("click", function () { startRename(titleEl, group); });
    block.querySelector("[data-delete]").addEventListener("click", function () {
      if (!window.confirm('Delete the "' + group.name + '" list? Its saved items will be removed from it.')) { return; }
      deleteGroupApi(group.uuid).then(function (res) {
        if (res && res.ok !== false) { reloadAndRepaint(); }
        else { window.alert((res && res.message) || "Couldn’t delete that list."); }
      });
    });
    var shareBtn = block.querySelector("[data-share]");
    var bar = block.querySelector("[data-sharebar]");
    shareBtn.addEventListener("click", function () {
      if (group.share_token) { bar.hidden = !bar.hidden; return; }
      shareBtn.disabled = true;
      shareGroup(group.uuid).then(function (res) {
        shareBtn.disabled = false;
        if (res && res.share_token) { group.share_token = res.share_token; shareBtn.textContent = "Sharing"; bar.hidden = false; renderShareBar(bar, group); }
        else { window.alert((res && res.message) || "Couldn’t share that list."); }
      });
    });
  }
  function startRename(titleEl, group) {
    var current = group.name;
    titleEl.innerHTML = '<input type="text" class="mpw-rename-input" maxlength="60" value="' + escapeHtml(current) + '"> ' +
      '<button type="button" class="mpw-link" data-save>Save</button> <button type="button" class="mpw-link" data-cancel>Cancel</button>';
    var input = titleEl.querySelector("input");
    input.focus(); input.select();
    function cancel() { titleEl.textContent = group.name; }
    function save() {
      var val = (input.value || "").trim();
      if (!val || val === current) { cancel(); return; }
      renameGroup(group.uuid, val).then(function (res) {
        if (res && res.ok !== false) { reloadAndRepaint(); }
        else { window.alert((res && res.message) || "Couldn’t rename that list."); cancel(); }
      });
    }
    titleEl.querySelector("[data-save]").addEventListener("click", save);
    titleEl.querySelector("[data-cancel]").addEventListener("click", cancel);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") { save(); } if (e.key === "Escape") { cancel(); } });
  }
  function renderShareBar(bar, group) {
    if (!bar || !group.share_token) { return; }
    var url = shareUrl(group.share_token);
    bar.innerHTML =
      '<span class="mpw-share__label">Anyone with this link can view “' + escapeHtml(group.name) + '”</span>' +
      '<div class="mpw-share__row">' +
        '<input type="text" class="mpw-share__url" readonly value="' + escapeHtml(url) + '">' +
        '<button type="button" class="mpw-link" data-copy>Copy link</button>' +
        '<button type="button" class="mpw-link mpw-link--danger" data-unshare>Stop sharing</button>' +
      '</div>';
    var copyBtn = bar.querySelector("[data-copy]");
    copyBtn.addEventListener("click", function () {
      var input = bar.querySelector(".mpw-share__url");
      input.select();
      function done() { copyBtn.textContent = "Copied ✓"; window.setTimeout(function () { copyBtn.textContent = "Copy link"; }, 1800); }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, function () { try { document.execCommand("copy"); done(); } catch (e) {} });
      } else { try { document.execCommand("copy"); done(); } catch (e) {} }
    });
    bar.querySelector("[data-unshare]").addEventListener("click", function () {
      unshareGroup(group.uuid).then(function (res) {
        if (res && res.ok !== false) { reloadAndRepaint(); }
        else { window.alert((res && res.message) || "Couldn’t stop sharing."); }
      });
    });
  }
  function pageCard(p, group) {
    var el = document.createElement("div");
    el.className = "mpw-item";
    var img = p.featured_image ? '<img src="' + p.featured_image + '&width=360" alt="' + escapeHtml(p.title) + '" loading="lazy">' : "";
    var foot = p.available
      ? '<button type="button" class="mpw-item__add" data-add>Add to basket</button>'
      : '<span class="mpw-item__soldout">Out of stock</span>';
    var others = groupNames.filter(function (n) { return n !== group.name; });
    var moveOpts = '<option value="" disabled selected>Move…</option>' +
      others.map(function (n) { return '<option value="' + escapeHtml(n) + '">To “' + escapeHtml(n) + '”</option>'; }).join("") +
      '<option value="__new__">＋ New list…</option>';
    el.innerHTML =
      '<a href="' + p.url + '" class="mpw-item__media">' + img + '</a>' +
      '<div class="mpw-item__body">' +
        '<a href="' + p.url + '" class="mpw-item__name">' + escapeHtml(p.title) + '</a>' +
        '<div class="mpw-item__price">' + money(p.price) + '</div>' +
        '<div class="mpw-item__foot">' + foot +
          '<select class="mpw-item__move" data-move aria-label="Move to another list">' + moveOpts + '</select>' +
          '<button type="button" class="mpw-item__remove" data-remove title="Remove from ' + escapeHtml(group.name) + '">Remove</button>' +
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
    el.querySelector("[data-move]").addEventListener("click", function (e) { e.stopPropagation(); });
    el.querySelector("[data-move]").addEventListener("change", function () {
      var sel = this;
      var val = sel.value;
      sel.value = "";
      if (!val) { return; }
      var toName = val;
      if (val === "__new__") { toName = (window.prompt("New list name:") || "").trim(); if (!toName) { return; } }
      moveItem(p.id, group.uuid, toName).then(function (res) {
        if (res && res.ok !== false) { reloadAndRepaint(); }
        else { window.alert((res && res.message) || "Couldn’t move that item."); }
      });
    });
    el.querySelector("[data-remove]").addEventListener("click", function () {
      remove(p.id, group.name).then(function () { reloadAndRepaint(); });
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
    var allIds = [];
    rawGroups.forEach(function (g) { (g.items || []).forEach(function (it) { allIds.push(key(it.product_id != null ? it.product_id : it.id)); }); });
    ensureHandles(allIds).then(function () { paintCartTable(host); });
  }
  function paintCartTable(host) {
    // product ids already in the cart, so we don't offer to re-add them
    var inCart = {};
    (host.getAttribute("data-cart-product-ids") || "").split(",").forEach(function (x) { if (x) { inCart[x.trim()] = true; } });

    var seen = {};
    var items = [];
    rawGroups.forEach(function (g) {
      (g.items || []).forEach(function (it) {
        var id = key(it.product_id != null ? it.product_id : it.id);
        var h = it.handle || resolveHandle(id);
        if (h && !seen[id] && !inCart[id]) { seen[id] = true; items.push({ id: id, handle: h, groups: groupsFor(id) }); }
      });
    });
    if (!items.length) { return; }
    var section = host.closest("[data-mpw-cart-section]");
    if (section) { section.hidden = false; }

    items.slice(0, 6).forEach(function (x) {
      fetch("/products/" + x.handle + ".js", { headers: { "Accept": "application/json" } })
        .then(function (r) { return r.ok ? r.json() : undefined; })
        .then(function (p) { if (p) { host.appendChild(cartRow(p, x.groups)); } })
        .catch(function () {});
    });
  }
  function cartRow(p, groups) {
    var row = document.createElement("div");
    row.className = "mpw-cart-list__row";
    var img = p.featured_image ? '<img src="' + p.featured_image + '&width=96" alt="' + escapeHtml(p.title) + '" loading="lazy">' : "";
    var action = p.available
      ? '<button type="button" class="mpw-cart-list__add" data-add>Add</button>'
      : '<span class="mpw-item__soldout" style="flex:none">Out of stock</span>';
    var meta = (groups && groups.length) ? "In " + groups.map(escapeHtml).join(", ") : "From your wishlist";
    row.innerHTML =
      '<a href="' + p.url + '" class="mpw-cart-list__thumb">' + img + '</a>' +
      '<div class="mpw-cart-list__info">' +
        '<a href="' + p.url + '" class="mpw-cart-list__name">' + escapeHtml(p.title) + '</a>' +
        '<div class="mpw-cart-list__meta">' + meta + '</div>' +
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

  /* ---------------- cart snapshot (early abandonment) ---------------- */
  var cachedCart = null;
  function sendSnapshot(cart, preferBeacon) {
    if (!cart || !cart.item_count) { return; }
    var sig = cart.token + ":" + cart.item_count + ":" + cart.total_price;
    try { if (sessionStorage.getItem("mp_cart_sig") === sig) { return; } } catch (e) {}
    var payload = {
      type: "cart_snapshot",
      cart_token: cart.token,
      total_price: cart.total_price,
      currency: cart.currency,
      items: (cart.items || []).map(function (i) { return { product_id: i.product_id, title: i.product_title || i.title, quantity: i.quantity }; })
    };
    var json = JSON.stringify(payload);
    var sent = false;
    if (preferBeacon && navigator.sendBeacon) {
      sent = navigator.sendBeacon("/apps/notify", new Blob([json], { type: "application/json" }));
    }
    if (!sent) {
      fetch("/apps/notify", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: json, keepalive: true }).catch(function () {});
    }
    try { sessionStorage.setItem("mp_cart_sig", sig); } catch (e) {}
  }
  function refreshCartSnapshot(preferBeacon) {
    if (!cfg.loggedIn) { return; }
    if (preferBeacon && cachedCart) { sendSnapshot(cachedCart, true); return; }
    fetch("/cart.js", { headers: { "Accept": "application/json" }, credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : undefined; })
      .then(function (cart) { if (cart) { cachedCart = cart; sendSnapshot(cart, preferBeacon); } })
      .catch(function () {});
  }
  function initCartSnapshot() {
    if (!cfg.loggedIn) { return; }
    // The mp cart/add flows reload the page, so a load-time snapshot captures the
    // latest basket; page-hide beacons a final snapshot in case they leave.
    window.setTimeout(function () { refreshCartSnapshot(false); }, 2500);
    window.addEventListener("pagehide", function () { refreshCartSnapshot(true); });
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") { refreshCartSnapshot(true); } });
  }

  /* ---------------- wire up ---------------- */
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-wishlist-btn]");
    if (!btn) { return; }
    e.preventDefault();
    e.stopPropagation();
    var id = btn.getAttribute("data-product-id");
    var handle = btn.getAttribute("data-product-handle");
    var title = btn.getAttribute("data-product-title");
    if (!cfg.loggedIn) { gotoLogin(); return; }
    if (isWished(id)) {
      // Already saved -> un-heart it (remove from every list it's in).
      var current = groupsFor(id);
      if (!current.length) { openPicker(id, handle, title); return; }
      btn.classList.add("is-busy");
      Promise.all(current.map(function (g) { return remove(id, g); })).then(function () {
        btn.classList.remove("is-busy");
      }).catch(function () { btn.classList.remove("is-busy"); });
      return;
    }
    openPicker(id, handle, title);
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
    initCartSnapshot();
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
