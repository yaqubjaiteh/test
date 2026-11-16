// Sends emails through SMTP. When SMTP is not configured, emails are saved as
// HTML files in data/outbox so you can still see what customers would receive.

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const config = require('./config');

const outboxDir = path.join(__dirname, 'data', 'outbox');

const transporter = config.SMTP_HOST
  ? nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    })
  : null;

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `${config.CURRENCY}${Number(n).toFixed(2)}`;

async function sendMail({ to, bcc, subject, html, text }) {
  if (transporter) {
    await transporter.sendMail({ from: `"${config.RESTAURANT_NAME}" <${config.MAIL_FROM}>`, to, bcc, subject, html, text });
    console.log(`Email sent to ${to}: ${subject}`);
    return;
  }
  fs.mkdirSync(outboxDir, { recursive: true });
  const file = path.join(outboxDir, `${Date.now()}-${subject.replace(/[^a-z0-9]+/gi, '-').slice(0, 60)}.html`);
  fs.writeFileSync(file, `<!-- To: ${to} | Subject: ${subject} -->\n${html}`);
  console.log(`SMTP not configured, so the email was saved to ${path.relative(__dirname, file)} instead of being sent.`);
}

function orderConfirmation(order) {
  const paidLine =
    order.payment_method === 'online'
      ? `<p style="color:#2e7d32"><strong>Paid online: ${money(order.total)}</strong></p>`
      : `<p><strong>Amount to pay on ${order.order_type === 'delivery' ? 'delivery' : 'pickup'}: ${money(order.total)}</strong></p>`;

  const rows = order.items
    .map(
      (i) => `<tr>
        <td style="padding:6px 0">${i.quantity} × ${escapeHtml(i.name)}</td>
        <td style="padding:6px 0;text-align:right">${money(i.unit_price * i.quantity)}</td>
      </tr>`
    )
    .join('');
  const subtotal = order.items.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  const deliveryFee = Math.round((order.total - subtotal) * 100) / 100;

  const html = `<!doctype html>
<html><body style="margin:0;background:#fffaf3;font-family:Arial,Helvetica,sans-serif;color:#2b2118">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <h1 style="color:#b5541c;font-size:22px;margin:0 0 4px">${escapeHtml(config.RESTAURANT_NAME)}</h1>
    <h2 style="font-size:18px;margin:16px 0 8px">Thank you for your order, ${escapeHtml(order.customer_name)}!</h2>
    <p>Your order <strong>#${order.id}</strong> has been received and is being prepared.</p>
    ${paidLine}
    <table style="width:100%;border-collapse:collapse;border-top:1px solid #e6dccd;border-bottom:1px solid #e6dccd;margin:12px 0">
      ${rows}
      ${deliveryFee > 0 ? `<tr><td style="padding:6px 0">Delivery fee</td><td style="padding:6px 0;text-align:right">${money(deliveryFee)}</td></tr>` : ''}
      <tr><td style="padding:8px 0;font-weight:bold;border-top:1px solid #e6dccd">Total</td>
          <td style="padding:8px 0;font-weight:bold;text-align:right;border-top:1px solid #e6dccd">${money(order.total)}</td></tr>
    </table>
    <p><strong>${order.order_type === 'delivery' ? 'Delivery to' : 'Pickup'}:</strong>
       ${order.order_type === 'delivery' ? escapeHtml(order.address) : 'Collect from the restaurant'}</p>
    ${order.notes ? `<p><strong>Your notes:</strong> ${escapeHtml(order.notes)}</p>` : ''}
    <p>You can check your order status any time at
      <a href="${config.BASE_URL}/#track" style="color:#b5541c">${config.BASE_URL}</a>
      using order number <strong>${order.id}</strong> and your phone number.</p>
    <p style="color:#7a6a5a;font-size:13px;margin-top:24px">This is an automatic email from ${escapeHtml(config.RESTAURANT_NAME)}.</p>
  </div>
</body></html>`;

  const text = [
    `Thank you for your order, ${order.customer_name}!`,
    `Order #${order.id}`,
    ...order.items.map((i) => `${i.quantity} x ${i.name}  ${money(i.unit_price * i.quantity)}`),
    deliveryFee > 0 ? `Delivery fee  ${money(deliveryFee)}` : '',
    `Total: ${money(order.total)} (${order.payment_method === 'online' ? 'paid online' : `pay on ${order.order_type}`})`,
    `Track your order at ${config.BASE_URL}/#track`,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    to: order.email,
    bcc: config.RESTAURANT_EMAIL || undefined,
    subject: `Order #${order.id} confirmed – ${config.RESTAURANT_NAME}`,
    html,
    text,
  };
}

async function sendOrderConfirmation(order) {
  await sendMail(orderConfirmation(order));
}

module.exports = { sendOrderConfirmation, usingSmtp: Boolean(transporter) };
