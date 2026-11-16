(() => {
  const $ = (sel) => document.querySelector(sel);
  const KEY = 'restaurant-admin-key';
  let adminKey = '';
  let currency = '$';
  try { adminKey = sessionStorage.getItem(KEY) || ''; } catch { /* storage unavailable */ }

  const ORDER_STATUSES = ['awaiting-payment', 'received', 'preparing', 'ready', 'out-for-delivery', 'completed', 'cancelled'];
  const BOOKING_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'];

  const money = (n) => `${currency}${Number(n).toFixed(2)}`;
  const escapeHtml = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const statusSelect = (kind, id, current, options) =>
    `<select data-kind="${kind}" data-id="${id}">${options
      .map((s) => `<option value="${s}" ${s === current ? 'selected' : ''}>${s}</option>`)
      .join('')}</select>`;

  async function api(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { logout(); throw new Error('Session expired. Please log in again.'); }
    if (!res.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }

  // ---------- auth ----------
  function showDashboard() {
    $('#loginView').hidden = true;
    $('#dashboard').hidden = false;
    $('#logoutBtn').hidden = false;
    loadAll();
  }
  function logout() {
    adminKey = '';
    try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
    $('#loginView').hidden = false;
    $('#dashboard').hidden = true;
    $('#logoutBtn').hidden = true;
  }
  $('#logoutBtn').addEventListener('click', logout);

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    adminKey = new FormData(e.target).get('password');
    try {
      await api('/api/admin/check');
      try { sessionStorage.setItem(KEY, adminKey); } catch { /* ignore */ }
      e.target.reset();
      $('#loginMessage').textContent = '';
      showDashboard();
    } catch {
      $('#loginMessage').className = 'form-message err';
      $('#loginMessage').textContent = 'Incorrect password.';
    }
  });

  // ---------- tabs ----------
  document.querySelector('.admin-tabs').addEventListener('click', (e) => {
    const view = e.target.dataset.view;
    if (!view) return;
    document.querySelectorAll('.admin-tabs .tab').forEach((t) => t.classList.toggle('active', t === e.target));
    document.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== view));
  });
  document.querySelectorAll('[data-refresh]').forEach((b) => b.addEventListener('click', loadAll));

  // ---------- data ----------
  async function loadAll() {
    try {
      const cfg = await fetch('/api/config').then((r) => r.json());
      currency = cfg.currency || currency;
    } catch { /* keep default */ }
    await Promise.all([loadOrders(), loadBookings(), loadMenu()]).catch((err) => alert(err.message));
  }

  async function loadOrders() {
    const orders = await api('/api/admin/orders');
    $('#ordersBody').innerHTML = orders.length
      ? orders
          .map(
            (o) => `<tr>
          <td>${o.id}</td>
          <td>${escapeHtml(o.created_at)} UTC</td>
          <td>${escapeHtml(o.customer_name)}<br><span class="muted small">${escapeHtml(o.phone)}${o.email ? `<br>${escapeHtml(o.email)}` : ''}</span></td>
          <td>${escapeHtml(o.order_type)}${o.address ? `<br><span class="muted small">${escapeHtml(o.address)}</span>` : ''}</td>
          <td>${o.items.map((i) => `${i.quantity} × ${escapeHtml(i.name)}`).join('<br>')}${o.notes ? `<br><em class="muted small">${escapeHtml(o.notes)}</em>` : ''}</td>
          <td>${money(o.total)}</td>
          <td>${paymentCell(o)}</td>
          <td>${statusSelect('orders', o.id, o.status, ORDER_STATUSES)}</td>
        </tr>`
          )
          .join('')
      : '<tr><td colspan="8" class="muted">No orders yet.</td></tr>';
  }

  function paymentCell(o) {
    const badge = `<span class="status ${escapeHtml(o.payment_status)}">${escapeHtml(o.payment_status)}</span>`;
    const how = o.payment_method === 'online' ? 'Online' : `Cash on ${escapeHtml(o.order_type)}`;
    const actions = [];
    if (o.payment_method === 'cash') {
      actions.push(
        o.payment_status === 'paid'
          ? `<button class="link-btn" data-cash="${o.id}" data-value="unpaid">Mark unpaid</button>`
          : `<button class="link-btn" data-cash="${o.id}" data-value="paid">Mark paid</button>`
      );
    } else if (o.payment_status !== 'paid') {
      actions.push(`<button class="link-btn" data-check="${o.id}">Check payment</button>`);
    }
    if (o.payment_method === 'cash' || o.payment_status === 'paid') {
      actions.push(`<button class="link-btn" data-resend="${o.id}">${o.confirmation_sent ? 'Resend email' : 'Send email'}</button>`);
    }
    return `${badge}<br><span class="muted small">${how}</span><br>${actions.join(' · ')}`;
  }

  async function loadBookings() {
    const bookings = await api('/api/admin/bookings');
    $('#bookingsBody').innerHTML = bookings.length
      ? bookings
          .map(
            (b) => `<tr>
          <td>${b.id}</td>
          <td>${escapeHtml(b.date)}</td>
          <td>${escapeHtml(b.time)}</td>
          <td>${b.guests}</td>
          <td>${escapeHtml(b.name)}</td>
          <td>${escapeHtml(b.phone)}<br><span class="muted small">${escapeHtml(b.email)}</span></td>
          <td>${escapeHtml(b.notes)}</td>
          <td>${statusSelect('bookings', b.id, b.status, BOOKING_STATUSES)}</td>
        </tr>`
          )
          .join('')
      : '<tr><td colspan="8" class="muted">No bookings yet.</td></tr>';
  }

  async function loadMenu() {
    const items = await api('/api/admin/menu');
    $('#menuBody').innerHTML = items
      .map(
        (m) => `<tr>
        <td>${escapeHtml(m.name)}<br><span class="muted small">${escapeHtml(m.description)}</span></td>
        <td>${escapeHtml(m.category)}</td>
        <td><input type="number" step="0.01" min="0.01" value="${m.price}" data-price="${m.id}" style="width:90px"></td>
        <td><input type="checkbox" data-available="${m.id}" ${m.available ? 'checked' : ''}></td>
      </tr>`
      )
      .join('');
  }

  // status changes
  $('#dashboard').addEventListener('change', async (e) => {
    const t = e.target;
    try {
      if (t.matches('select[data-kind]')) {
        await api(`/api/admin/${t.dataset.kind}/${t.dataset.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: t.value }),
        });
      } else if (t.dataset.available) {
        await api(`/api/admin/menu/${t.dataset.available}`, {
          method: 'PATCH',
          body: JSON.stringify({ available: t.checked }),
        });
      } else if (t.dataset.price) {
        await api(`/api/admin/menu/${t.dataset.price}`, {
          method: 'PATCH',
          body: JSON.stringify({ price: Number(t.value) }),
        });
      }
    } catch (err) {
      alert(err.message);
      loadAll();
    }
  });

  // payment buttons in the orders table
  $('#ordersBody').addEventListener('click', async (e) => {
    const { cash, value, check, resend } = e.target.dataset;
    if (!cash && !check && !resend) return;
    e.target.disabled = true;
    try {
      if (cash) {
        await api(`/api/admin/orders/${cash}`, { method: 'PATCH', body: JSON.stringify({ paymentStatus: value }) });
      } else if (check) {
        const r = await api(`/api/admin/orders/${check}/check-payment`, { method: 'POST' });
        alert(r.payment_status === 'paid' ? 'Payment confirmed. The order has moved to "received".' : 'No payment received yet.');
      } else if (resend) {
        await api(`/api/admin/orders/${resend}/resend-email`, { method: 'POST' });
        alert('Confirmation email sent.');
      }
      await loadOrders();
    } catch (err) {
      alert(err.message);
      e.target.disabled = false;
    }
  });

  $('#addItemForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#menuMessage');
    try {
      const item = await api('/api/admin/menu', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(e.target))),
      });
      msg.className = 'form-message ok';
      msg.textContent = `Added "${item.name}".`;
      e.target.reset();
      loadMenu();
    } catch (err) {
      msg.className = 'form-message err';
      msg.textContent = err.message;
    }
  });

  if (adminKey) {
    api('/api/admin/check').then(showDashboard).catch(logout);
  }
})();
