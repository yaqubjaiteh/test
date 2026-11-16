(async () => {
  const params = new URLSearchParams(location.search);
  const orderId = params.get('order');
  const token = params.get('token');
  const content = document.getElementById('content');

  let currency = '$';
  try { currency = (await fetch('/api/config').then((r) => r.json())).currency || currency; } catch { /* default */ }
  const money = (n) => `${currency}${Number(n).toFixed(2)}`;

  const res = await fetch(`/api/payments/status?order=${encodeURIComponent(orderId)}&token=${encodeURIComponent(token)}`);
  if (!res.ok) {
    content.innerHTML = '<p class="form-message err">This payment link is not valid.</p>';
    return;
  }
  const order = await res.json();
  if (order.payment_status === 'paid') {
    location.href = `/payment-result.html?order=${orderId}&token=${token}`;
    return;
  }

  content.innerHTML = `
    <p>Order #${order.id}</p>
    <div class="big-amount">${money(order.total)}</div>
    <div class="actions">
      <button class="btn" id="payBtn">Pay ${money(order.total)}</button>
      <button class="btn btn-ghost" id="failBtn">Simulate a declined card</button>
    </div>
    <div class="form-message" id="msg" role="status"></div>`;

  async function complete(success) {
    document.querySelectorAll('button').forEach((b) => (b.disabled = true));
    const r = await fetch('/api/payments/test/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: orderId, token, success }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      document.getElementById('msg').className = 'form-message err';
      document.getElementById('msg').textContent = data.error || 'Something went wrong.';
      return;
    }
    location.href = data.redirect;
  }

  document.getElementById('payBtn').addEventListener('click', () => complete(true));
  document.getElementById('failBtn').addEventListener('click', () => complete(false));
})();
