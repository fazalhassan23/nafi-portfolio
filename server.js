// Dr. Nafi website backend: static site + appointment API + admin dashboard.
// Requires Node 22.5+ (uses built-in node:sqlite). No npm dependencies.
'use strict';
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'appointments.db');
const SESSION_HOURS = 12;
const IS_PROD = process.env.NODE_ENV === 'production';

if (ADMIN_PASSWORD.length < 8) {
  console.error('ADMIN_PASSWORD is required and must be at least 8 characters. See .env.example.');
  process.exit(1);
}

// ---------- database ----------
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    area TEXT NOT NULL DEFAULT '',
    preferred_date TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    lang TEXT NOT NULL DEFAULT 'en',
    status TEXT NOT NULL DEFAULT 'new',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_appt_status ON appointments(status, created_at);
`);
const STATUSES = ['new', 'confirmed', 'completed', 'cancelled'];

// ---------- helpers ----------
const buckets = new Map(); // key -> [timestamps]
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { buckets.set(key, arr); return false; }
  arr.push(now); buckets.set(key, arr); return true;
}
setInterval(() => { // keep memory bounded
  const now = Date.now();
  for (const [k, arr] of buckets) { if (!arr.some((t) => now - t < 3600e3)) buckets.delete(k); }
}, 600e3).unref();

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);

function sign(payload) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
}
function makeToken() {
  const exp = Date.now() + SESSION_HOURS * 3600e3;
  const p = String(exp);
  return `${p}.${sign(p)}`;
}
function validToken(tok) {
  if (!tok || !tok.includes('.')) return false;
  const [p, sig] = tok.split('.');
  const good = sign(p);
  const a = Buffer.from(sig || ''), b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(p) > Date.now();
}
function getCookie(req, name) {
  const h = req.headers.cookie || '';
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}
function safeEqualStr(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function newRef() {
  const d = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  return `NAF-${d}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}
function isAdmin(req) { return validToken(getCookie(req, 'nafi_admin')); }
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}
function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(); // set by the host's proxy
  return xf || req.socket.remoteAddress || 'unknown';
}
function send(res, status, body, headers = {}) {
  const isObj = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
  const data = isObj ? JSON.stringify(body) : body;
  res.writeHead(status, Object.assign(isObj ? { 'Content-Type': 'application/json; charset=utf-8' } : {}, SECURITY_HEADERS, headers));
  res.end(data);
}
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};
function readJson(req, limit = 20 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('Too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(Object.assign(new Error('Bad JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}
function cookieHeader(value, maxAgeSec) {
  return `nafi_admin=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}` + (IS_PROD ? '; Secure' : '');
}

// ---------- handlers ----------
function createAppointment(req, res, b) {
  if (!rateLimit('appt:' + clientIp(req), 5, 3600e3)) return send(res, 429, { error: 'Too many requests. Please call the chamber.' });
  if (b.website) return send(res, 200, { ok: true, ref: 'NAF-OK' }); // honeypot: pretend success

  const name = clean(b.name, 80);
  const phone = clean(b.phone, 20).replace(/[^\d+]/g, '');
  const area = clean(b.area, 40);
  const message = clean(b.message, 1000);
  const lang = b.lang === 'bn' ? 'bn' : 'en';
  const date = clean(b.date, 10);

  const errors = {};
  if (name.length < 2) errors.name = 'Please enter your name.';
  if (!/^\+?\d{7,15}$/.test(phone)) errors.phone = 'Please enter a valid phone number.';
  if (date) {
    const d = new Date(date + 'T00:00:00Z');
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(d) || d < new Date(today - 864e5)) errors.date = 'Please choose a valid future date.';
  }
  if (Object.keys(errors).length) return send(res, 400, { error: 'Please check the form.', fields: errors });

  const ref = newRef();
  db.prepare('INSERT INTO appointments (ref,name,phone,area,preferred_date,message,lang) VALUES (?,?,?,?,?,?,?)')
    .run(ref, name, phone, area, date, message, lang);
  send(res, 201, { ok: true, ref });
}

function queryRows(q) {
  const where = [], args = [];
  if (STATUSES.includes(q.get('status'))) { where.push('status = ?'); args.push(q.get('status')); }
  const s = clean(q.get('q'), 60).replace(/[%_]/g, '');
  if (s) { where.push('(name LIKE ? OR phone LIKE ? OR ref LIKE ? OR message LIKE ?)'); const like = `%${s}%`; args.push(like, like, like, like); }
  const sql = `SELECT * FROM appointments ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 1000`;
  return db.prepare(sql).all(...args).map((r) => ({ ...r }));
}
function csv(rows) {
  const cols = ['ref', 'created_at', 'name', 'phone', 'area', 'preferred_date', 'status', 'message', 'note', 'lang'];
  const esc = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formulas
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return '\ufeff' + [cols.join(',')].concat(rows.map((r) => cols.map((c) => esc(r[c])).join(','))).join('\r\n');
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json' };
const PUBLIC_DIR = path.join(__dirname, 'public');
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  else if (rel === '/admin') rel = '/admin.html';
  else if (!path.extname(rel)) rel += '.html';
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain' });
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    const noStore = rel === '/admin.html';
    send(res, 200, data, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': noStore || !IS_PROD ? 'no-store' : 'public, max-age=3600',
    });
  });
}

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const m = req.method;

  if (p === '/healthz') return send(res, 200, { ok: true });

  if (p.startsWith('/api/')) {
    if (m === 'POST' && p === '/api/appointments') return createAppointment(req, res, await readJson(req));

    if (m === 'POST' && p === '/api/admin/login') {
      const body = await readJson(req);
      if (!sameOrigin(req)) return send(res, 403, { error: 'Bad origin' });
      if (!rateLimit('login:' + clientIp(req), 8, 15 * 60e3)) return send(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
      if (!safeEqualStr(body.password ?? '', ADMIN_PASSWORD)) return send(res, 401, { error: 'Wrong password' });
      return send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(makeToken(), SESSION_HOURS * 3600) });
    }
    if (m === 'POST' && p === '/api/admin/logout') return send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader('', 0) });

    if (p.startsWith('/api/admin/')) {
      if (!isAdmin(req)) return send(res, 401, { error: 'Not signed in' });
      if (m !== 'GET' && !sameOrigin(req)) return send(res, 403, { error: 'Bad origin' });

      if (m === 'GET' && p === '/api/admin/me') return send(res, 200, { ok: true });
      if (m === 'GET' && p === '/api/admin/appointments') {
        const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
        for (const r of db.prepare('SELECT status, COUNT(*) c FROM appointments GROUP BY status').all()) counts[r.status] = Number(r.c);
        return send(res, 200, { rows: queryRows(url.searchParams), counts });
      }
      if (m === 'GET' && p === '/api/admin/export.csv') {
        return send(res, 200, csv(queryRows(url.searchParams)), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="appointments.csv"' });
      }
      const mm = p.match(/^\/api\/admin\/appointments\/(\d+)$/);
      if (mm) {
        const id = Number(mm[1]);
        if (m === 'PATCH') {
          const b = await readJson(req);
          const cur = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
          if (!cur) return send(res, 404, { error: 'Not found' });
          const status = b.status ?? cur.status;
          if (!STATUSES.includes(status)) return send(res, 400, { error: 'Bad status' });
          const note = b.note === undefined ? cur.note : clean(b.note, 500);
          db.prepare("UPDATE appointments SET status=?, note=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?").run(status, note, id);
          return send(res, 200, { ok: true });
        }
        if (m === 'DELETE') { db.prepare('DELETE FROM appointments WHERE id = ?').run(id); return send(res, 200, { ok: true }); }
      }
    }
    return send(res, 404, { error: 'Not found' });
  }

  if (m === 'GET' || m === 'HEAD') return serveStatic(req, res, p);
  send(res, 405, 'Method not allowed', { 'Content-Type': 'text/plain' });
}

http.createServer((req, res) => {
  route(req, res).catch((err) => {
    if (err.status) return send(res, err.status, { error: err.message });
    console.error(err);
    send(res, 500, { error: 'Server error' });
  });
}).listen(PORT, () => console.log(`Dr. Nafi site running on http://localhost:${PORT}  (admin: /admin)`));
