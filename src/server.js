require('dotenv').config({ quiet: true });
const path = require('path');
const { openDb } = require('./db');
const { createSender } = require('./sms');
const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'table-is-ready.db');

const db = openDb(DB_PATH);
const sender = createSender();
const app = createApp({ db, sender });

app.listen(PORT, () => {
  console.log(`Table is Ready running at http://localhost:${PORT}`);
  console.log(sender.demo
    ? 'SMS: DEMO mode (no Twilio credentials) - messages are logged, not sent.'
    : `SMS: sending via ${sender.name}`);
});
