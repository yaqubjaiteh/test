const path = require('path');

// Load settings from a .env file in the project folder, if there is one.
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  // No .env file: fall back to real environment variables and the defaults below.
}

const env = process.env;
const PORT = Number(env.PORT) || 3000;

module.exports = {
  PORT,
  BASE_URL: (env.BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, ''),
  ADMIN_PASSWORD: env.ADMIN_PASSWORD || 'admin123',
  RESTAURANT_NAME: env.RESTAURANT_NAME || 'The Golden Spoon',

  // Restaurant settings
  OPENING_HOUR: 11,        // 11:00
  CLOSING_HOUR: 22,        // last booking slot 21:30
  MAX_GUESTS_PER_SLOT: 40, // total seats that can be booked for one time slot
  DELIVERY_FEE: 3.0,

  // Money
  CURRENCY: env.CURRENCY || '$',                                // symbol shown on the website
  PAYMENT_CURRENCY: (env.PAYMENT_CURRENCY || 'USD').toUpperCase(), // ISO code sent to the payment company

  // Payments: "test", "stripe" or "flutterwave"
  PAYMENT_PROVIDER: (env.PAYMENT_PROVIDER || 'test').toLowerCase(),
  STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY || '',
  FLUTTERWAVE_SECRET_KEY: env.FLUTTERWAVE_SECRET_KEY || '',

  // Email (SMTP). If SMTP_HOST is empty, emails are saved to data/outbox instead of being sent.
  SMTP_HOST: env.SMTP_HOST || '',
  SMTP_PORT: Number(env.SMTP_PORT) || 587,
  SMTP_SECURE: env.SMTP_SECURE === 'true',
  SMTP_USER: env.SMTP_USER || '',
  SMTP_PASS: env.SMTP_PASS || '',
  MAIL_FROM: env.MAIL_FROM || env.SMTP_USER || 'no-reply@example.com',
  RESTAURANT_EMAIL: env.RESTAURANT_EMAIL || '', // optional: also get a copy of each order confirmation
};
