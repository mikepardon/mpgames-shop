if (!window.GiftWrapAddon) {
  window.GiftWrapAddon = true;

  function submitHandler(evt) {
    const form = evt.target;
    if (!form.matches('[data-type="add-to-cart-form"]')) return;

    const checkbox = form.closest('product-form')?.querySelector('[data-gift-wrap-checkbox]');
    if (!checkbox?.checked) return;

    const variantId = parseInt(checkbox.dataset.giftWrapVariantId, 10);
    if (!variantId) return;

    evt.preventDefault();
    evt.stopImmediatePropagation();

    fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ id: variantId, quantity: 1 }),
    }).finally(() => {
      document.removeEventListener('submit', submitHandler, true);
      form.requestSubmit(form.querySelector('[type="submit"]'));
      setTimeout(() => document.addEventListener('submit', submitHandler, true), 200);
    });
  }

  document.addEventListener('submit', submitHandler, true);
}