const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'restaurant.db'));
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS menu_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    category    TEXT    NOT NULL,
    price       REAL    NOT NULL,
    available   INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    email       TEXT    NOT NULL,
    phone       TEXT    NOT NULL,
    date        TEXT    NOT NULL,
    time        TEXT    NOT NULL,
    guests      INTEGER NOT NULL,
    notes       TEXT    NOT NULL DEFAULT '',
    status      TEXT    NOT NULL DEFAULT 'pending',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT    NOT NULL,
    phone         TEXT    NOT NULL,
    email         TEXT    NOT NULL DEFAULT '',
    order_type    TEXT    NOT NULL,
    address       TEXT    NOT NULL DEFAULT '',
    notes         TEXT    NOT NULL DEFAULT '',
    total         REAL    NOT NULL,
    status        TEXT    NOT NULL DEFAULT 'received',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
    name         TEXT    NOT NULL,
    unit_price   REAL    NOT NULL,
    quantity     INTEGER NOT NULL
  );
`);

// Add payment/email columns to databases created before online payments existed.
const orderColumns = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
const addColumn = (name, definition) => {
  if (!orderColumns.includes(name)) db.exec(`ALTER TABLE orders ADD COLUMN ${name} ${definition}`);
};
addColumn('payment_method', "TEXT NOT NULL DEFAULT 'cash'");      // 'cash' (pay on pickup/delivery) or 'online'
addColumn('payment_status', "TEXT NOT NULL DEFAULT 'unpaid'");    // unpaid | pending | paid | failed
addColumn('payment_ref', "TEXT NOT NULL DEFAULT ''");             // provider's session / transaction reference
addColumn('paid_at', 'TEXT');
addColumn('public_token', "TEXT NOT NULL DEFAULT ''");            // secret used in payment return links
addColumn('confirmation_sent', 'INTEGER NOT NULL DEFAULT 0');

// Seed a starter menu the first time the app runs.
const { count } = db.prepare('SELECT COUNT(*) AS count FROM menu_items').get();
if (count === 0) {
  const insert = db.prepare(
    'INSERT INTO menu_items (name, description, category, price) VALUES (?, ?, ?, ?)'
  );
  const seed = [
    ['Grilled Fish Platter', 'Fresh catch of the day grilled with lemon, garlic and herbs, served with fries.', 'Mains', 18.50],
    ['Chicken Yassa', 'Marinated chicken in a tangy onion and lemon sauce, served with rice.', 'Mains', 14.00],
    ['Domoda', 'Rich peanut stew with beef and vegetables, served with white rice.', 'Mains', 15.00],
    ['Benachin', 'One-pot jollof rice cooked with fish and seasonal vegetables.', 'Mains', 13.50],
    ['Beef Burger', 'Grilled beef patty, cheese, lettuce, tomato and house sauce. Comes with fries.', 'Mains', 12.00],
    ['Vegetable Curry', 'Seasonal vegetables simmered in a mild coconut curry, served with rice.', 'Mains', 11.00],
    ['Spring Rolls', 'Crispy vegetable spring rolls with a sweet chilli dip.', 'Starters', 6.00],
    ['Pepper Soup', 'Spicy, warming broth with goat meat and local herbs.', 'Starters', 7.50],
    ['Garden Salad', 'Mixed greens, tomato, cucumber and onion with house vinaigrette.', 'Starters', 6.50],
    ['Fried Plantain', 'Sweet ripe plantain, fried golden.', 'Sides', 4.00],
    ['French Fries', 'Crispy salted fries.', 'Sides', 3.50],
    ['Wonjo Juice', 'Chilled hibiscus drink with mint.', 'Drinks', 3.00],
    ['Baobab Juice', 'Creamy, naturally sweet baobab fruit drink.', 'Drinks', 3.50],
    ['Fresh Lime Soda', 'Freshly squeezed lime with soda water.', 'Drinks', 2.50],
    ['Chocolate Cake', 'Moist chocolate sponge with ganache.', 'Desserts', 6.00],
    ['Fruit Salad', 'Seasonal tropical fruits.', 'Desserts', 5.00],
  ];
  for (const row of seed) insert.run(...row);
}

module.exports = db;
