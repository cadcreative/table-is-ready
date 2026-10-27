const path = require('path');
const express = require('express');
const { normalizeUSPhone, formatPretty } = require('./phone');

const DEFAULTS = {
  restaurant_name: 'Our Restaurant',
  ready_template: 'Hi {name}, your table at {restaurant} is ready! Please head to the host stand.',
  join_template: "You're on the waitlist at {restaurant}. We'll text you when your table is ready.",
  join_sms_enabled: 'false',
};

function render(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

function createApp({ db, sender, env = process.env }) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const now = () => new Date().toISOString();

  // Settings: DB overrides .env, .env overrides defaults.
  function getSettings() {
    const s = {
      restaurant_name: env.RESTAURANT_NAME || DEFAULTS.restaurant_name,
      ready_template: env.READY_MESSAGE_TEMPLATE || DEFAULTS.ready_template,
      join_template: env.JOIN_MESSAGE_TEMPLATE || DEFAULTS.join_template,
      join_sms_enabled: env.JOIN_SMS_ENABLED || DEFAULTS.join_sms_enabled,
    };
    for (const row of db.prepare('SELECT key, value FROM settings').all()) {
      if (row.key in s && row.value != null) s[row.key] = row.value;
    }
    return {
      restaurant_name: s.restaurant_name,
      ready_template: s.ready_template,
      join_template: s.join_template,
      join_sms_enabled: /^(1|true|yes|on)$/i.test(String(s.join_sms_enabled)),
    };
  }

  const getParty = (id) => db.prepare('SELECT * FROM parties WHERE id = ?').get(id);

  function decorate(p) {
    if (!p) return p;
    const last = db
      .prepare('SELECT * FROM messages WHERE party_id = ? ORDER BY id DESC LIMIT 1')
      .get(p.id);
    return { ...p, phone_pretty: formatPretty(p.phone), last_message: last || null };
  }

  async function sendSms(party, kind) {
    const settings = getSettings();
    const tpl = kind === 'join' ? settings.join_template : settings.ready_template;
    const body = render(tpl, {
      name: party.name || 'there',
      restaurant: settings.restaurant_name,
      size: party.party_size || '',
    }).replace(/\s+,/g, ',');
    let status, providerId = null, error = null;
    try {
      const r = await sender.send({ to: party.phone, body });
      status = sender.demo ? 'demo' : 'sent';
      providerId = r.id;
    } catch (e) {
      status = 'failed';
      error = e.message || String(e);
      console.error(`[SMS] failed to send to ${party.phone}:`, error);
    }
    const info = db
      .prepare(
        `INSERT INTO messages (party_id, kind, to_phone, body, provider, status, provider_id, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(party.id, kind, party.phone, body, sender.name, status, providerId, error, now());
    return db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
  }

  app.get('/api/status', (req, res) => {
    res.json({ provider: sender.name, demo: sender.demo, settings: getSettings() });
  });

  app.get('/api/settings', (req, res) => res.json(getSettings()));

  app.put('/api/settings', (req, res) => {
    const b = req.body || {};
    const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    if (b.restaurant_name != null) {
      const v = String(b.restaurant_name).trim();
      if (!v) return res.status(400).json({ error: 'Restaurant name cannot be empty' });
      up.run('restaurant_name', v.slice(0, 100));
    }
    if (b.ready_template != null) {
      const v = String(b.ready_template).trim();
      if (!v) return res.status(400).json({ error: 'Ready message cannot be empty' });
      up.run('ready_template', v.slice(0, 480));
    }
    if (b.join_template != null) {
      const v = String(b.join_template).trim();
      if (!v) return res.status(400).json({ error: 'Join message cannot be empty' });
      up.run('join_template', v.slice(0, 480));
    }
    if (b.join_sms_enabled != null) up.run('join_sms_enabled', b.join_sms_enabled ? 'true' : 'false');
    res.json(getSettings());
  });

  // Active waitlist (waiting + notified). ?all=1 includes seated/removed from today.
  app.get('/api/parties', (req, res) => {
    const rows = req.query.all
      ? db.prepare("SELECT * FROM parties ORDER BY created_at ASC").all()
      : db.prepare("SELECT * FROM parties WHERE status IN ('waiting','notified') ORDER BY created_at ASC").all();
    res.json(rows.map(decorate));
  });

  app.post('/api/parties', async (req, res) => {
    const b = req.body || {};
    const phone = normalizeUSPhone(b.phone);
    if (!phone) return res.status(400).json({ error: 'Enter a valid 10-digit US phone number' });
    let size = null;
    if (b.party_size !== undefined && b.party_size !== null && b.party_size !== '') {
      size = parseInt(b.party_size, 10);
      if (!Number.isInteger(size) || size < 1 || size > 100)
        return res.status(400).json({ error: 'Party size must be between 1 and 100' });
    }
    const name = b.name ? String(b.name).trim().slice(0, 60) || null : null;
    const notes = b.notes ? String(b.notes).trim().slice(0, 200) || null : null;
    const info = db
      .prepare('INSERT INTO parties (name, phone, party_size, notes, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(name, phone, size, notes, 'waiting', now());
    const party = getParty(info.lastInsertRowid);
    let message = null;
    if (getSettings().join_sms_enabled) message = await sendSms(party, 'join');
    res.status(201).json({ party: decorate(party), message });
  });

  function requireActive(req, res) {
    const p = getParty(Number(req.params.id));
    if (!p) { res.status(404).json({ error: 'Party not found' }); return null; }
    return p;
  }

  app.post('/api/parties/:id/ready', async (req, res) => {
    const p = requireActive(req, res);
    if (!p) return;
    if (p.status === 'seated' || p.status === 'removed')
      return res.status(409).json({ error: `Party is already ${p.status}` });
    const message = await sendSms(p, 'ready');
    if (message.status === 'failed')
      return res.status(502).json({ error: 'SMS failed: ' + message.error, message, party: decorate(p) });
    db.prepare("UPDATE parties SET status = 'notified', notified_at = ? WHERE id = ?").run(now(), p.id);
    res.json({ party: decorate(getParty(p.id)), message });
  });

  app.post('/api/parties/:id/seat', (req, res) => {
    const p = requireActive(req, res);
    if (!p) return;
    db.prepare("UPDATE parties SET status = 'seated', seated_at = ? WHERE id = ?").run(now(), p.id);
    res.json({ party: decorate(getParty(p.id)) });
  });

  app.delete('/api/parties/:id', (req, res) => {
    const p = requireActive(req, res);
    if (!p) return;
    db.prepare("UPDATE parties SET status = 'removed', removed_at = ? WHERE id = ?").run(now(), p.id);
    res.json({ party: decorate(getParty(p.id)) });
  });

  app.get('/api/messages', (req, res) => {
    res.json(db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 50').all());
  });

  app.use((err, req, res, next) => {
    if (!err.status || err.status >= 500) console.error(err);
    res.status(err.status || 500).json({ error: err.status === 400 ? 'Invalid request body' : 'Server error' });
  });

  return app;
}

module.exports = { createApp, render, DEFAULTS };
