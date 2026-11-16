(() => {
  const $ = (sel) => document.querySelector(sel);
  const CART_KEY = 'restaurant-cart';

  let config = { openingHour: 11, closingHour: 22, deliveryFee: 0, currency: '$' };
  let menu = [];
  let cart = loadCart(); // { [menuItemId]: quantity }
  let activeCategory = 'All';

  const money = (n) => `${config.currency}${Number(n).toFixed(2)}`;
  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function loadCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY)) || {}; } catch { return {}; }
  }
  function saveCart() {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch { /* storage unavailable */ }
  }

  async function api(url, options = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  function setMessage(el, text, ok) {
    el.className = `form-message ${ok ? 'ok' : 'err'}`;
    el.textContent = text;
  }

  // ---------- menu ----------
  function renderTabs() {
    const categories = ['All', ...new Set(menu.map((m) => m.category))];
    $('#categoryTabs').innerHTML = categories
      .map((c) => `<button class="tab ${c === activeCategory ? 'active' : ''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`)
      .join('');
  }

  function renderMenu() {
    const items = activeCategory === 'All' ? menu : menu.filter((m) => m.category === activeCategory);
    if (items.length === 0) {
      $('#menuGrid').innerHTML = '<p class="muted">No items available right now.</p>';
      return;
    }
    $('#menuGrid').innerHTML = items
      .map(
        (m) => `
        <article class="card">
          <span class="badge">${escapeHtml(m.category)}</span>
          <h3>${escapeHtml(m.name)}</h3>
          <p class="muted">${escapeHtml(m.description)}</p>
          <div class="card-foot">
            <span class="price">${money(m.price)}</span>
            <button class="btn btn-small" data-add="${m.id}">Add to cart</button>
          </div>
        </article>`
      )
      .join('');
  }

  $('#categoryTabs').addEventListener('click', (e) => {
    const cat = e.target.dataset.cat;
    if (!cat) return;
    activeCategory = cat;
    renderTabs();
    renderMenu();
  });

  $('#menuGrid').addEventListener('click', (e) => {
    const id = e.target.dataset.add;
    if (!id) return;
    cart[id] = (cart[id] || 0) + 1;
    saveCart();
    renderCart();
    e.target.textContent = 'Added ✓';
    setTimeout(() => (e.target.textContent = 'Add to cart'), 900);
  });

  // ---------- cart ----------
  function cartLines() {
    return Object.entries(cart)
      .map(([id, qty]) => ({ item: menu.find((m) => m.id === Number(id)), qty }))
      .filter((l) => l.item && l.qty > 0);
  }

  function renderCart() {
    // Drop items that are no longer on the menu.
    if (menu.length) {
      for (const id of Object.keys(cart)) if (!menu.some((m) => m.id === Number(id))) delete cart[id];
    }
    const lines = cartLines();
    $('#cartCount').textContent = lines.reduce((n, l) => n + l.qty, 0);

    if (lines.length === 0) {
      $('#cartItems').innerHTML = '<p class="muted">Your cart is empty. Add something from the menu.</p>';
      $('#cartTotals').innerHTML = '';
      $('#checkoutForm').hidden = true;
      return;
    }
    $('#checkoutForm').hidden = false;
    $('#cartItems').innerHTML = lines
      .map(
        ({ item, qty }) => `
        <div class="cart-line">
          <div>${escapeHtml(item.name)}<br><span class="muted small">${money(item.price)} each</span></div>
          <div class="qty">
            <button data-dec="${item.id}" aria-label="Decrease">−</button>
            <span>${qty}</span>
            <button data-inc="${item.id}" aria-label="Increase">+</button>
          </div>
          <strong>${money(item.price * qty)}</strong>
        </div>`
      )
      .join('');

    const subtotal = lines.reduce((s, l) => s + l.item.price * l.qty, 0);
    const delivery = orderType() === 'delivery' ? config.deliveryFee : 0;
    $('#cartTotals').innerHTML = `
      <div><span>Subtotal</span><span>${money(subtotal)}</span></div>
      ${delivery ? `<div><span>Delivery fee</span><span>${money(delivery)}</span></div>` : ''}
      <div class="grand"><span>Total</span><span>${money(subtotal + delivery)}</span></div>`;
  }

  $('#cartItems').addEventListener('click', (e) => {
    const { inc, dec } = e.target.dataset;
    if (inc) cart[inc] = Math.min((cart[inc] || 0) + 1, 99);
    if (dec) {
      cart[dec] = (cart[dec] || 0) - 1;
      if (cart[dec] <= 0) delete cart[dec];
    }
    if (inc || dec) { saveCart(); renderCart(); }
  });

  const orderType = () => document.querySelector('input[name="orderType"]:checked').value;

  const paymentMethod = () => document.querySelector('input[name="paymentMethod"]:checked').value;

  function updateCheckoutLabels() {
    $('#addressField').hidden = orderType() !== 'delivery';
    $('#cashLabel').textContent = orderType() === 'delivery' ? 'Pay on delivery' : 'Pay on pickup';
    $('#placeOrderBtn').textContent = paymentMethod() === 'online' ? 'Continue to payment' : 'Place order';
  }

  document.querySelectorAll('input[name="orderType"], input[name="paymentMethod"]').forEach((r) =>
    r.addEventListener('change', () => {
      updateCheckoutLabels();
      renderCart();
    })
  );

  function openCart() { $('#cartDrawer').hidden = false; $('#cartOverlay').hidden = false; }
  function closeCart() { $('#cartDrawer').hidden = true; $('#cartOverlay').hidden = true; }
  $('#cartButton').addEventListener('click', openCart);
  $('#closeCart').addEventListener('click', closeCart);
  $('#cartOverlay').addEventListener('click', closeCart);
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeCart());

  $('#checkoutForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const msg = $('#checkoutMessage');
    const data = Object.fromEntries(new FormData(form));
    data.items = cartLines().map((l) => ({ id: l.item.id, quantity: l.qty }));

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const { order, paymentUrl } = await api('/api/orders', { method: 'POST', body: JSON.stringify(data) });
      cart = {};
      saveCart();
      if (paymentUrl) {
        // Send the customer to the payment page. They come back to payment-result.html.
        setMessage(msg, 'Taking you to the payment page…', true);
        window.location.href = paymentUrl;
        return;
      }
      renderCart();
      $('#cartItems').innerHTML = `
        <div class="result-box">
          <h3>Thank you, ${escapeHtml(order.customer_name)}!</h3>
          <p>Your order <strong>#${order.id}</strong> has been received.
             Please pay <strong>${money(order.total)}</strong> on ${order.order_type === 'delivery' ? 'delivery' : 'pickup'}.</p>
          <p class="muted small">A confirmation has been sent to your email. Track your order any time with
             order number ${order.id} and your phone number.</p>
        </div>`;
      form.reset();
      updateCheckoutLabels();
      msg.textContent = '';
    } catch (err) {
      setMessage(msg, err.message, false);
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- booking ----------
  function setupBookingForm() {
    const select = $('#timeSelect');
    const slots = [];
    for (let h = config.openingHour; h < config.closingHour; h++) {
      slots.push(`${String(h).padStart(2, '0')}:00`, `${String(h).padStart(2, '0')}:30`);
    }
    select.innerHTML = slots.map((s) => `<option value="${s}">${s}</option>`).join('');
    select.value = slots.includes('19:00') ? '19:00' : slots[0];

    const now = new Date();
    const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const dateInput = document.querySelector('#bookingForm input[name="date"]');
    dateInput.min = today;
    dateInput.value = today;

    $('#hoursNote').textContent =
      `We accept bookings daily from ${config.openingHour}:00 to ${config.closingHour - 1}:30. ` +
      'We will contact you to confirm your reservation.';
  }

  $('#bookingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const msg = $('#bookingMessage');
    const data = Object.fromEntries(new FormData(form));
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const b = await api('/api/bookings', { method: 'POST', body: JSON.stringify(data) });
      setMessage(
        msg,
        `Thanks ${b.name}! Booking #${b.id} for ${b.guests} on ${b.date} at ${b.time} is received. We'll confirm shortly.`,
        true
      );
      form.reset();
      setupBookingForm();
    } catch (err) {
      setMessage(msg, err.message, false);
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- order tracking ----------
  $('#trackForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { id, phone } = Object.fromEntries(new FormData(e.target));
    const msg = $('#trackMessage');
    try {
      const o = await api(`/api/orders/${encodeURIComponent(id)}?phone=${encodeURIComponent(phone)}`);
      msg.className = 'form-message';
      msg.innerHTML = `
        <div class="result-box">
          <p>Order <strong>#${o.id}</strong> &middot; status: <span class="status">${escapeHtml(o.status)}</span>
             &middot; payment: <span class="status">${escapeHtml(o.payment_status)}</span></p>
          <ul>${o.items.map((i) => `<li>${i.quantity} × ${escapeHtml(i.name)}</li>`).join('')}</ul>
          <p>Total: <strong>${money(o.total)}</strong> &middot; ${escapeHtml(o.order_type)}</p>
        </div>`;
    } catch (err) {
      setMessage(msg, err.message, false);
    }
  });

  // ---------- init ----------
  $('#year').textContent = new Date().getFullYear();

  (async () => {
    try {
      config = await api('/api/config');
    } catch { /* use defaults */ }
    $('#testModeNote').hidden = config.paymentProvider !== 'test';
    updateCheckoutLabels();
    setupBookingForm();
    try {
      menu = await api('/api/menu');
      renderTabs();
      renderMenu();
    } catch {
      $('#menuGrid').innerHTML = '<p class="muted">Could not load the menu. Please refresh.</p>';
    }
    renderCart();
  })();
})();
