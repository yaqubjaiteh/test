(async () => {
  const params = new URLSearchParams(location.search);
  const orderId = params.get('order');
  const token = params.get('token');
  const content = document.getElementById('content');

  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let currency = '$';
  try { currency = (await fetch('/api/config').then((r) => r.json())).currency || currency; } catch { /* default */ }
  const money = (n) => `${currency}${Number(n).toFixed(2)}`;

  async function check() {
    const r = await fetch(`/api/payments/status?order=${encodeURIComponent(orderId)}&token=${encodeURIComponent(token)}`);
    if (!r.ok) throw new Error('not found');
    return r.json();
  }

  let order;
  try {
    order = await check();
    // Payment companies sometimes need a few seconds to confirm. Check a few more times.
    for (let i = 0; i < 4 && order.payment_status === 'pending' && !params.has('cancelled'); i++) {
      await new Promise((r) => setTimeout(r, 2000));
      order = await check();
    }
  } catch {
    content.innerHTML = `<h1>Order not found</h1><p class="muted">This link is not valid.</p>
      <div class="actions"><a class="btn" href="/">Back to the menu</a></div>`;
    return;
  }

  const summary = `
    <div class="result-box">
      <p><strong>Order #${order.id}</strong> · ${escapeHtml(order.order_type)}</p>
      <ul>${order.items.map((i) => `<li>${i.quantity} × ${escapeHtml(i.name)}</li>`).join('')}</ul>
      <p>Total: <strong>${money(order.total)}</strong></p>
    </div>`;

  if (order.payment_status === 'paid') {
    content.innerHTML = `
      <h1>Payment successful 🎉</h1>
      <p>Thank you, ${escapeHtml(order.customer_name)}! Your order is now with our kitchen.
         A confirmation email is on its way.</p>
      ${summary}
      <p class="muted small">Track your order on the home page with order number ${order.id} and your phone number.</p>
      <div class="actions"><a class="btn" href="/#track">Track my order</a><a class="btn btn-ghost" href="/">Back to the menu</a></div>`;
    return;
  }

  const cancelledOrder = order.status === 'cancelled';
  content.innerHTML = `
    <h1>${params.has('cancelled') ? 'Payment cancelled' : 'Payment not completed'}</h1>
    <p>${cancelledOrder
      ? 'This order has been cancelled. Please place a new order.'
      : 'Your order has been saved, but we have not received payment yet. You have not been charged.'}</p>
    ${summary}
    <div class="actions">
      ${cancelledOrder ? '' : '<button class="btn" id="retryBtn">Try paying again</button>'}
      <a class="btn btn-ghost" href="/">Back to the menu</a>
    </div>
    <div class="form-message" id="msg" role="status"></div>`;

  document.getElementById('retryBtn')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    const msg = document.getElementById('msg');
    const r = await fetch('/api/payments/retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: orderId, token }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.paymentUrl) return void (location.href = data.paymentUrl);
    if (r.ok && data.paid) return void location.reload();
    msg.className = 'form-message err';
    msg.textContent = data.error || 'Something went wrong. Please try again.';
    e.target.disabled = false;
  });
})();
