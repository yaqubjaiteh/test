# The Golden Spoon: restaurant web app

A Node.js + Express web app where customers can:

- **Browse the menu** by category
- **Order food online** for pickup or delivery, and either **pay online** or pay on pickup/delivery
- **Get an email confirmation** for every order
- **Book a table** for a date, time slot and party size, with a per-slot capacity check
- **Track an order** using the order number and phone number

Staff get an **admin dashboard** (`/admin.html`) to:

- See incoming orders with their payment status, and move them through received → preparing → ready → out-for-delivery → completed
- Mark cash orders as paid, re-check an online payment, and resend confirmation emails
- See bookings and confirm or cancel them
- Add menu items, change prices and mark items unavailable

## Requirements

- Node.js **22.13 or newer**. The app uses the built-in `node:sqlite` module, so there's no database server to install.

## Run it

```bash
npm install
npm start
```

Then open http://localhost:3000 for the customer site and http://localhost:3000/admin.html for the staff dashboard.

To restart the server automatically when you edit files, use `npm run dev`.

## Settings

All settings go in a file called `.env` in the project folder. Copy `.env.example` to `.env`, fill in the values you need, and restart the server. Everything has a default, so the app works without a `.env` file.

The most important settings:

| Setting            | Default            | Purpose                                                        |
|--------------------|--------------------|----------------------------------------------------------------|
| `ADMIN_PASSWORD`   | `admin123`         | Password for the staff dashboard. **Change this.**             |
| `BASE_URL`         | `http://localhost:3000` | Your site's public address, used in payment links and emails |
| `CURRENCY`         | `$`                | Currency symbol shown on prices                                |
| `PAYMENT_CURRENCY` | `USD`              | Currency code charged online (USD, EUR, GMD, NGN, GHS, KES…)    |
| `PAYMENT_PROVIDER` | `test`             | `test`, `stripe` or `flutterwave`                              |
| `SMTP_HOST` etc.   | (empty)            | Email account used to send confirmations                       |

Opening hours, the delivery fee and the seats available per booking slot are in `config.js`.

## Online payments

The checkout gives customers two choices: **Pay online now**, or **Pay on pickup/delivery**.

### Test mode (default)

With `PAYMENT_PROVIDER=test`, customers who choose online payment see a **practice payment page** with a "Pay" button and a "Simulate a declined card" button. No real money moves. Use it to try the whole flow before connecting a real payment company.

### Going live with Stripe (cards)

1. Create an account at https://stripe.com and check that Stripe supports businesses in your country.
2. In the Stripe dashboard, open **Developers → API keys** and copy the **Secret key**. It starts with `sk_test_` while testing and `sk_live_` once you go live.
3. In `.env` set:
   ```
   PAYMENT_PROVIDER=stripe
   STRIPE_SECRET_KEY=sk_test_...
   PAYMENT_CURRENCY=USD
   BASE_URL=https://your-website-address
   ```
4. Restart the server.

### Going live with Flutterwave (cards + mobile money, many African countries)

1. Create an account at https://flutterwave.com.
2. In the dashboard, open **Settings → API keys** and copy the **Secret key** (it starts with `FLWSECK`).
3. In `.env` set:
   ```
   PAYMENT_PROVIDER=flutterwave
   FLUTTERWAVE_SECRET_KEY=FLWSECK_TEST-...
   PAYMENT_CURRENCY=NGN
   BASE_URL=https://your-website-address
   ```
4. Restart the server.

### How a payment is confirmed

1. The customer places an order. It's saved with status **awaiting-payment**.
2. The customer is sent to the payment company's page.
3. When they come back, the server **asks the payment company directly** whether the order was paid and for the right amount. The customer's browser is never trusted for this.
4. If the order is paid, its status changes to **received** (so the kitchen sees it) and the confirmation email is sent.

If a customer pays but closes the browser before returning, the order stays **awaiting-payment**. Press **Check payment** on that order in the dashboard to ask the payment company again.

## Email confirmations

Customers get a confirmation email:

- for **cash** orders, as soon as the order is placed
- for **online** orders, as soon as the payment is confirmed

If you set `RESTAURANT_EMAIL`, the restaurant gets a copy of every confirmation too.

**Until you set up email**, confirmations are saved as files in `data/outbox/`. Open them in a browser to see what customers would receive.

To send real emails, fill in the `SMTP_` settings in `.env`. For Gmail:

1. Turn on 2-Step Verification for the Google account.
2. Create an **App password** at https://myaccount.google.com/apppasswords.
3. Set:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=yourrestaurant@gmail.com
   SMTP_PASS=the-16-letter-app-password
   MAIL_FROM=yourrestaurant@gmail.com
   ```

Any other email provider works too. Ask them for their SMTP host, port, username and password.

## Project structure

```
server.js          Express server and REST API
config.js          All settings (reads .env)
db.js              SQLite schema, upgrades and starter menu
payments.js        Test, Stripe and Flutterwave payment providers
email.js           Order confirmation emails
data/              Database file and email outbox (created on first run)
public/
  index.html             Customer site (menu, cart, checkout, booking, tracking)
  pay-test.html          Practice payment page (test mode)
  payment-result.html    Where customers land after paying
  admin.html             Staff dashboard
  css/style.css
  js/                    Page scripts
```

## API

| Method | Path                                   | Description                                  |
|--------|----------------------------------------|----------------------------------------------|
| GET    | `/api/menu`                            | Available menu items                         |
| POST   | `/api/orders`                          | Place an order (returns `paymentUrl` for online payment) |
| GET    | `/api/orders/:id?phone=...`            | Track an order                               |
| GET    | `/api/payments/status?order=&token=`   | Check and confirm an order's payment         |
| POST   | `/api/payments/retry`                  | Start a new payment attempt                  |
| POST   | `/api/bookings`                        | Request a table booking                      |
| GET    | `/api/admin/orders`                    | All orders (admin)                           |
| PATCH  | `/api/admin/orders/:id`                | Update order status / cash payment (admin)   |
| POST   | `/api/admin/orders/:id/check-payment`  | Re-check an online payment (admin)           |
| POST   | `/api/admin/orders/:id/resend-email`   | Resend the confirmation email (admin)        |
| GET    | `/api/admin/bookings`                  | All bookings (admin)                         |
| PATCH  | `/api/admin/bookings/:id`              | Update booking status (admin)                |
| GET/POST/PATCH | `/api/admin/menu`              | Manage the menu (admin)                      |

Admin endpoints require an `x-admin-key` header containing the admin password.

## Before going live

- Set a strong `ADMIN_PASSWORD` and serve the site over **HTTPS**.
- Set `BASE_URL` to your real website address so payment companies can send customers back.
- Switch the payment provider from `test` to `stripe` or `flutterwave` and use **live** keys.
- Set up SMTP so emails are actually sent.
- Back up `data/restaurant.db` regularly.
- Optional: add payment **webhooks**. The payment company then notifies the server directly, so a customer who closes their browser right after paying is confirmed automatically, without staff pressing "Check payment".
#   p r o j e c t s  
 #   p r o j e c t s  
 