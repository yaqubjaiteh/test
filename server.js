const express = require('express');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const db = require('./db');
const { getProvider } = require('./payments');
const email = require('./email');

const app = express();

app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const isPhone = (v) => /^[+\d][\d\s-]{5,19}$/.test(v);

function requireAdmin(req, res, next) {
  if (req.get('x-admin-key') !== config.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function withTransaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function getOrder(id) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return null;
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id);
  return order;
}

// What the customer's browser is allowed to see about an order.
function publicOrder(o) {
  return {
    id: o.id,
    customer_name: o.customer_name,
    order_type: o.order_type,
    total: o.total,
    status: o.status,
    payment_method: o.payment_method,
    payment_status: o.payment_status,
    created_at: o.created_at,
    items: o.items.map((i) => ({ name: i.name, quantity: i.quantity, unit_price: i.unit_price })),
  };
}

// Look up an order from a payment return link (?order=ID&token=SECRET).
function getOrderByToken(id, token) {
  const order = getOrder(Number.parseInt(id, 10));
  if (!order || !order.public_token || typeof token !== 'string') return null;
  const a = Buffer.from(order.public_token);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? order : null;
}

// Send the confirmation email at most once per order.
function sendConfirmationOnce(orderId) {
  const claimed = db
    .prepare('UPDATE orders SET confirmation_sent = 1 WHERE id = ? AND confirmation_sent = 0')
    .run(orderId);
  if (claimed.changes === 0) return;
  email.sendOrderConfirmation(getOrder(orderId)).catch((err) => {
    console.error(`Could not send confirmation email for order #${orderId}:`, err.message);
    db.prepare('UPDATE orders SET confirmation_sent = 0 WHERE id = ?').run(orderId); // allow a resend
  });
}

// Mark an order as paid (only once), move it to the kitchen queue and email the customer.
function markPaid(orderId) {
  const r = db
    .prepare(
      `UPDATE orders
         SET payment_status = 'paid', paid_at = datetime('now'),
             status = CASE WHEN status = 'awaiting-payment' THEN 'received' ELSE status END
       WHERE id = ? AND payment_status != 'paid'`
    )
    .run(orderId);
  if (r.changes > 0) {
    console.log(`Order #${orderId} paid online.`);
    sendConfirmationOnce(orderId);
  }
}

// Ask the payment provider whether an online order has been paid, and record it if so.
async function refreshPayment(order) {
  if (order.payment_method !== 'online' || order.payment_status === 'paid') return order;
  const { paid } = await getProvider().verifyPayment(order);
  if (paid) markPaid(order.id);
  return getOrder(order.id);
}

async function startPayment(order) {
  const { url, reference } = await getProvider().createPayment(order);
  db.prepare("UPDATE orders SET payment_ref = ?, payment_status = 'pending' WHERE id = ?").run(reference, order.id);
  return url;
}

// ---------- public API ----------
app.get('/api/config', (req, res) => {
  res.json({
    openingHour: config.OPENING_HOUR,
    closingHour: config.CLOSING_HOUR,
    deliveryFee: config.DELIVERY_FEE,
    currency: config.CURRENCY,
    paymentProvider: config.PAYMENT_PROVIDER,
  });
});

app.get('/api/menu', (req, res) => {
  const items = db
    .prepare('SELECT * FROM menu_items WHERE available = 1 ORDER BY category, name')
    .all();
  res.json(items);
});

app.post('/api/bookings', (req, res) => {
  const name = str(req.body.name, 100);
  const emailAddr = str(req.body.email, 150);
  const phone = str(req.body.phone, 20);
  const date = str(req.body.date, 10);
  const time = str(req.body.time, 5);
  const notes = str(req.body.notes, 500);
  const guests = Number.parseInt(req.body.guests, 10);

  if (!name) return res.status(400).json({ error: 'Name is required.' });
  if (!isEmail(emailAddr)) return res.status(400).json({ error: 'A valid email is required.' });
  if (!isPhone(phone)) return res.status(400).json({ error: 'A valid phone number is required.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date.' });
  if (!/^\d{2}:(00|30)$/.test(time)) return res.status(400).json({ error: 'Invalid time slot.' });
  if (!Number.isInteger(guests) || guests < 1 || guests > 20) {
    return res.status(400).json({ error: 'Guests must be between 1 and 20.' });
  }

  const hour = Number(time.slice(0, 2));
  if (hour < config.OPENING_HOUR || hour >= config.CLOSING_HOUR) {
    return res
      .status(400)
      .json({ error: `We take bookings between ${config.OPENING_HOUR}:00 and ${config.CLOSING_HOUR - 1}:30.` });
  }
  const when = new Date(`${date}T${time}:00`);
  if (Number.isNaN(when.getTime()) || when < new Date()) {
    return res.status(400).json({ error: 'Please choose a date and time in the future.' });
  }

  try {
    const booking = withTransaction(() => {
      const { booked } = db
        .prepare(
          "SELECT COALESCE(SUM(guests), 0) AS booked FROM bookings WHERE date = ? AND time = ? AND status != 'cancelled'"
        )
        .get(date, time);
      if (booked + guests > config.MAX_GUESTS_PER_SLOT) {
        const err = new Error('Sorry, that time slot is fully booked. Please pick another time.');
        err.status = 409;
        throw err;
      }
      const result = db
        .prepare(
          'INSERT INTO bookings (name, email, phone, date, time, guests, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .run(name, emailAddr, phone, date, time, guests, notes);
      return db.prepare('SELECT * FROM bookings WHERE id = ?').get(result.lastInsertRowid);
    });
    res.status(201).json(booking);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Could not save booking.' });
  }
});

app.post('/api/orders', async (req, res) => {
  const customerName = str(req.body.customerName, 100);
  const phone = str(req.body.phone, 20);
  const emailAddr = str(req.body.email, 150);
  const orderType = str(req.body.orderType, 10);
  const paymentMethod = str(req.body.paymentMethod, 10) || 'cash';
  const address = str(req.body.address, 300);
  const notes = str(req.body.notes, 500);
  const items = Array.isArray(req.body.items) ? req.body.items : [];

  if (!customerName) return res.status(400).json({ error: 'Name is required.' });
  if (!isPhone(phone)) return res.status(400).json({ error: 'A valid phone number is required.' });
  if (!isEmail(emailAddr)) return res.status(400).json({ error: 'A valid email is required for your order confirmation.' });
  if (!['pickup', 'delivery'].includes(orderType)) {
    return res.status(400).json({ error: 'Choose pickup or delivery.' });
  }
  if (!['cash', 'online'].includes(paymentMethod)) {
    return res.status(400).json({ error: 'Choose a payment method.' });
  }
  if (orderType === 'delivery' && !address) {
    return res.status(400).json({ error: 'A delivery address is required.' });
  }
  if (items.length === 0 || items.length > 50) {
    return res.status(400).json({ error: 'Your cart is empty.' });
  }

  // Prices always come from the database, never from the client.
  const getItem = db.prepare('SELECT * FROM menu_items WHERE id = ? AND available = 1');
  const lines = [];
  for (const raw of items) {
    const id = Number.parseInt(raw.id, 10);
    const quantity = Number.parseInt(raw.quantity, 10);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      return res.status(400).json({ error: 'Invalid quantity.' });
    }
    const menuItem = getItem.get(id);
    if (!menuItem) return res.status(400).json({ error: 'An item in your cart is no longer available.' });
    lines.push({ menuItem, quantity });
  }

  const subtotal = lines.reduce((sum, l) => sum + l.menuItem.price * l.quantity, 0);
  const total = Math.round((subtotal + (orderType === 'delivery' ? config.DELIVERY_FEE : 0)) * 100) / 100;
  const online = paymentMethod === 'online';

  let order;
  try {
    order = withTransaction(() => {
      const result = db
        .prepare(
          `INSERT INTO orders
             (customer_name, phone, email, order_type, address, notes, total,
              status, payment_method, payment_status, public_token)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          customerName, phone, emailAddr, orderType, orderType === 'delivery' ? address : '', notes, total,
          online ? 'awaiting-payment' : 'received',
          paymentMethod,
          online ? 'pending' : 'unpaid',
          crypto.randomBytes(16).toString('hex')
        );
      const orderId = result.lastInsertRowid;
      const insertLine = db.prepare(
        'INSERT INTO order_items (order_id, menu_item_id, name, unit_price, quantity) VALUES (?, ?, ?, ?, ?)'
      );
      for (const l of lines) {
        insertLine.run(orderId, l.menuItem.id, l.menuItem.name, l.menuItem.price, l.quantity);
      }
      return getOrder(orderId);
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not place order.' });
  }

  if (!online) {
    sendConfirmationOnce(order.id);
    return res.status(201).json({ order: publicOrder(order), paymentUrl: null });
  }

  try {
    const paymentUrl = await startPayment(order);
    res.status(201).json({ order: publicOrder(order), paymentUrl });
  } catch (err) {
    console.error(`Payment setup failed for order #${order.id}:`, err.message);
    db.prepare("UPDATE orders SET status = 'cancelled', payment_status = 'failed' WHERE id = ?").run(order.id);
    res.status(502).json({
      error: 'Online payment is not available right now. Please try again, or choose to pay on pickup/delivery.',
    });
  }
});

app.get('/api/orders/:id', (req, res) => {
  // Customers can track an order with its id + the phone number used.
  const order = getOrder(Number.parseInt(req.params.id, 10));
  if (!order || order.phone !== str(req.query.phone, 20)) {
    return res.status(404).json({ error: 'Order not found. Check the order number and phone.' });
  }
  res.json(publicOrder(order));
});

// ---------- payments ----------

// Called by the "payment result" page after the customer returns from the payment company.
app.get('/api/payments/status', async (req, res) => {
  let order = getOrderByToken(req.query.order, req.query.token);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  try {
    order = await refreshPayment(order);
  } catch (err) {
    console.error(`Payment check failed for order #${order.id}:`, err.message);
  }
  res.json(publicOrder(order));
});

// Lets the customer try paying again if the first attempt failed or was cancelled.
app.post('/api/payments/retry', async (req, res) => {
  let order = getOrderByToken(req.body.order, req.body.token);
  if (!order || order.payment_method !== 'online') return res.status(404).json({ error: 'Order not found.' });
  try {
    order = await refreshPayment(order); // never charge twice: check the last attempt first
    if (order.payment_status === 'paid') return res.json({ paid: true });
    if (order.status !== 'awaiting-payment') {
      return res.status(400).json({ error: 'This order can no longer be paid online.' });
    }
    res.json({ paymentUrl: await startPayment(order) });
  } catch (err) {
    console.error(`Payment retry failed for order #${order.id}:`, err.message);
    res.status(502).json({ error: 'Online payment is not available right now. Please try again shortly.' });
  }
});

// Test mode only: the practice payment page reports the result here.
app.post('/api/payments/test/complete', (req, res) => {
  if (config.PAYMENT_PROVIDER !== 'test') return res.status(404).json({ error: 'Not found' });
  const order = getOrderByToken(req.body.order, req.body.token);
  if (!order || order.payment_method !== 'online') return res.status(404).json({ error: 'Order not found.' });
  if (order.status !== 'awaiting-payment') return res.status(400).json({ error: 'This order is not awaiting payment.' });
  if (req.body.success === true) {
    markPaid(order.id);
  } else {
    db.prepare("UPDATE orders SET payment_status = 'failed' WHERE id = ? AND payment_status != 'paid'").run(order.id);
  }
  res.json({ redirect: `/payment-result.html?order=${order.id}&token=${order.public_token}` });
});

// ---------- admin API ----------
const admin = express.Router();
admin.use(requireAdmin);

admin.get('/check', (req, res) => res.json({ ok: true }));

admin.get('/bookings', (req, res) => {
  res.json(db.prepare('SELECT * FROM bookings ORDER BY date DESC, time DESC').all());
});

admin.patch('/bookings/:id', (req, res) => {
  const status = str(req.body.status, 20);
  if (!['pending', 'confirmed', 'cancelled', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }
  const r = db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Booking not found.' });
  res.json({ ok: true });
});

admin.get('/orders', (req, res) => {
  const orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC, id DESC').all();
  const lineStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  for (const o of orders) {
    o.items = lineStmt.all(o.id);
    delete o.public_token;
  }
  res.json(orders);
});

admin.patch('/orders/:id', (req, res) => {
  const order = getOrder(Number.parseInt(req.params.id, 10));
  if (!order) return res.status(404).json({ error: 'Order not found.' });

  if (req.body.status !== undefined) {
    const status = str(req.body.status, 20);
    if (!['awaiting-payment', 'received', 'preparing', 'ready', 'out-for-delivery', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, order.id);
  }

  // Staff can record cash payments. Online payments are confirmed by the payment company only.
  if (req.body.paymentStatus !== undefined) {
    const paymentStatus = str(req.body.paymentStatus, 10);
    if (order.payment_method !== 'cash' || !['unpaid', 'paid'].includes(paymentStatus)) {
      return res.status(400).json({ error: 'Only cash orders can be marked paid or unpaid by staff.' });
    }
    db.prepare(
      "UPDATE orders SET payment_status = ?, paid_at = CASE WHEN ? = 'paid' THEN datetime('now') ELSE NULL END WHERE id = ?"
    ).run(paymentStatus, paymentStatus, order.id);
  }
  res.json({ ok: true });
});

// Ask the payment company again (e.g. the customer paid but closed the browser before returning).
admin.post('/orders/:id/check-payment', async (req, res) => {
  const order = getOrder(Number.parseInt(req.params.id, 10));
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (order.payment_method !== 'online') return res.status(400).json({ error: 'This is not an online-payment order.' });
  try {
    const updated = await refreshPayment(order);
    res.json({ payment_status: updated.payment_status });
  } catch (err) {
    res.status(502).json({ error: `Could not reach the payment company: ${err.message}` });
  }
});

admin.post('/orders/:id/resend-email', (req, res) => {
  const order = getOrder(Number.parseInt(req.params.id, 10));
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  db.prepare('UPDATE orders SET confirmation_sent = 0 WHERE id = ?').run(order.id);
  sendConfirmationOnce(order.id);
  res.json({ ok: true });
});

admin.get('/menu', (req, res) => {
  res.json(db.prepare('SELECT * FROM menu_items ORDER BY category, name').all());
});

admin.post('/menu', (req, res) => {
  const name = str(req.body.name, 100);
  const description = str(req.body.description, 300);
  const category = str(req.body.category, 50);
  const price = Number(req.body.price);
  if (!name || !category || !(price > 0)) {
    return res.status(400).json({ error: 'Name, category and a positive price are required.' });
  }
  const r = db
    .prepare('INSERT INTO menu_items (name, description, category, price) VALUES (?, ?, ?, ?)')
    .run(name, description, category, price);
  res.status(201).json(db.prepare('SELECT * FROM menu_items WHERE id = ?').get(r.lastInsertRowid));
});

admin.patch('/menu/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  const available = req.body.available === undefined ? item.available : req.body.available ? 1 : 0;
  const price = req.body.price === undefined ? item.price : Number(req.body.price);
  if (!(price > 0)) return res.status(400).json({ error: 'Price must be positive.' });
  db.prepare('UPDATE menu_items SET available = ?, price = ? WHERE id = ?').run(available, price, item.id);
  res.json({ ok: true });
});

app.use('/api/admin', admin);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(config.PORT, () => {
  console.log(`Restaurant app running at http://localhost:${config.PORT}`);
  console.log(`Admin dashboard:         http://localhost:${config.PORT}/admin.html`);
  console.log(
    `Payments: ${config.PAYMENT_PROVIDER}${config.PAYMENT_PROVIDER === 'test' ? ' (practice mode, no real money)' : ''}`
  );
  console.log(`Emails:   ${email.usingSmtp ? `sent via ${config.SMTP_HOST}` : 'saved to data/outbox (SMTP not configured)'}`);
  if (config.ADMIN_PASSWORD === 'admin123') {
    console.log('Admin password is the default "admin123". Set ADMIN_PASSWORD in .env to change it.');
  }
  try {
    getProvider();
  } catch (err) {
    console.warn(`WARNING: ${err.message} Online payment will not work until this is fixed.`);
  }
});
