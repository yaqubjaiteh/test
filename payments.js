// Online payment providers.
//
// Each provider has two functions:
//   createPayment(order) -> { url, reference }   where to send the customer to pay
//   verifyPayment(order) -> { paid: boolean }    ask the provider whether the order was really paid
//
// Payment is ALWAYS confirmed by the server asking the provider directly, never by trusting
// what the customer's browser says.

const config = require('./config');

// Currencies that have no cents (Stripe wants whole units for these).
const ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);
const toMinorUnits = (amount, currency) =>
  ZERO_DECIMAL.has(currency) ? Math.round(amount) : Math.round(amount * 100);

function returnUrl(order, extra = '') {
  return `${config.BASE_URL}/payment-result.html?order=${order.id}&token=${order.public_token}${extra}`;
}

// ---------- Test mode: a practice payment page, no real money ----------
const test = {
  name: 'test',
  async createPayment(order) {
    const reference = `test_${order.id}_${Date.now()}`;
    return {
      reference,
      url: `${config.BASE_URL}/pay-test.html?order=${order.id}&token=${order.public_token}`,
    };
  },
  async verifyPayment(order) {
    // The practice page records the result directly in the database (see /api/payments/test/complete).
    return { paid: order.payment_status === 'paid' };
  },
};

// ---------- Stripe Checkout ----------
const stripe = {
  name: 'stripe',
  async request(method, path, form) {
    const res = await fetch(`https://api.stripe.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Stripe: ${data.error?.message || res.status}`);
    return data;
  },
  async createPayment(order) {
    const currency = config.PAYMENT_CURRENCY;
    const session = await this.request('POST', '/checkout/sessions', {
      mode: 'payment',
      customer_email: order.email,
      client_reference_id: String(order.id),
      'metadata[order_id]': String(order.id),
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(toMinorUnits(order.total, currency)),
      'line_items[0][price_data][product_data][name]': `${config.RESTAURANT_NAME} order #${order.id}`,
      success_url: returnUrl(order),
      cancel_url: returnUrl(order, '&cancelled=1'),
    });
    return { reference: session.id, url: session.url };
  },
  async verifyPayment(order) {
    if (!order.payment_ref) return { paid: false };
    const s = await this.request('GET', `/checkout/sessions/${encodeURIComponent(order.payment_ref)}`);
    const currency = config.PAYMENT_CURRENCY;
    const paid =
      s.payment_status === 'paid' &&
      s.amount_total === toMinorUnits(order.total, currency) &&
      s.currency === currency.toLowerCase() &&
      s.metadata?.order_id === String(order.id);
    return { paid };
  },
};

// ---------- Flutterwave Standard ----------
const flutterwave = {
  name: 'flutterwave',
  async request(method, path, body) {
    const res = await fetch(`https://api.flutterwave.com/v3${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.FLUTTERWAVE_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.status !== 'success') {
      throw new Error(`Flutterwave: ${data.message || res.status}`);
    }
    return data.data;
  },
  async createPayment(order) {
    // Each attempt gets a fresh, unique reference.
    const reference = `order-${order.id}-${Date.now()}`;
    const data = await this.request('POST', '/payments', {
      tx_ref: reference,
      amount: order.total,
      currency: config.PAYMENT_CURRENCY,
      redirect_url: returnUrl(order),
      customer: { email: order.email, phonenumber: order.phone, name: order.customer_name },
      customizations: { title: config.RESTAURANT_NAME, description: `Order #${order.id}` },
      meta: { order_id: order.id },
    });
    return { reference, url: data.link };
  },
  async verifyPayment(order) {
    if (!order.payment_ref) return { paid: false };
    let tx;
    try {
      tx = await this.request('GET', `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(order.payment_ref)}`);
    } catch {
      return { paid: false }; // not found yet / not paid
    }
    const paid =
      tx.status === 'successful' &&
      tx.tx_ref === order.payment_ref &&
      tx.currency === config.PAYMENT_CURRENCY &&
      Number(tx.amount) >= order.total;
    return { paid };
  },
};

const providers = { test, stripe, flutterwave };

function getProvider() {
  const p = providers[config.PAYMENT_PROVIDER];
  if (!p) throw new Error(`Unknown PAYMENT_PROVIDER "${config.PAYMENT_PROVIDER}". Use test, stripe or flutterwave.`);
  if (p === stripe && !config.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set.');
  if (p === flutterwave && !config.FLUTTERWAVE_SECRET_KEY) throw new Error('FLUTTERWAVE_SECRET_KEY is not set.');
  return p;
}

module.exports = { getProvider };
