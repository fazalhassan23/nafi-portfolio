// Dr. Nafi website backend: static site + appointment API + admin dashboard.
// Local SQLite or hosted Turso, with local files or private Vercel Blob media.
'use strict';
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const openDatabase = require('./database');
const createContentStore = require('./content-store');

async function createApp() {
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'appointments.db');
const SESSION_HOURS = 12;
const IS_PROD = process.env.NODE_ENV === 'production';
if (IS_PROD && (!process.env.SESSION_SECRET || SESSION_SECRET.length < 32)) {
  throw new Error('Production requires SESSION_SECRET with at least 32 characters.');
}

if (ADMIN_PASSWORD.length < 8) {
  throw new Error('ADMIN_PASSWORD is required and must be at least 8 characters. See .env.example.');
}

// ---------- database ----------
const db = await openDatabase();
await db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS rate_limits (bucket TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
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
async function rateLimit(key, max, windowMs) {
  const now=Date.now();
  key=crypto.createHmac('sha256',SESSION_SECRET).update(key).digest('hex');
  await db.prepare('DELETE FROM rate_limits WHERE expires_at<=?').run(now);
  // Atomic upsert: limits remain shared across concurrent Vercel instances.
  const row=await db.prepare(`INSERT INTO rate_limits(bucket,hits,expires_at) VALUES(?,1,?)
    ON CONFLICT(bucket) DO UPDATE SET
      hits=CASE WHEN expires_at<=? THEN 1 ELSE hits+1 END,
      expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END
    RETURNING hits`).get(key,now+windowMs,now,now);
  return Number(row.hits)<=max;
}

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const normalizeDigits = (str) => String(str ?? '').replace(/[০-৯]/g, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d));

function tokenHash(token) { return crypto.createHmac('sha256',SESSION_SECRET).update(token).digest('hex'); }
async function makeToken() {
  const token = crypto.randomBytes(32).toString('hex');
  await db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(Date.now());
  await db.prepare('INSERT INTO admin_sessions(token_hash,expires_at) VALUES(?,?)').run(tokenHash(token),Date.now()+SESSION_HOURS*3600e3);
  return token;
}
async function validToken(token) {
  if (!/^[a-f0-9]{64}$/.test(token || '')) return false;
  return !!(await db.prepare('SELECT token_hash FROM admin_sessions WHERE token_hash=? AND expires_at>?').get(tokenHash(token),Date.now()));
}
function getCookie(req, name) {
  const h = req.headers.cookie || '';
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) { try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return ''; } }
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
async function isAdmin(req) { return validToken(getCookie(req, 'nafi_admin')); }
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}
function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(); // set by the host's proxy
  return ((process.env.VERCEL || process.env.TRUST_PROXY === '1') && xf) || req.socket.remoteAddress || 'unknown';
}
function send(res, status, body, headers = {}) {
  const isObj = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
  const data = isObj ? JSON.stringify(body) : body;
  if (res.writableEnded || res.destroyed) return;
  if (!headers['Cache-Control']) headers['Cache-Control'] = 'no-store';
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
    if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
      req.resume(); return reject(Object.assign(new Error('Content-Type must be application/json'), { status: 415 }));
    }
    // Vercel may already have parsed the incoming body before invoking us.
    if (req.body !== undefined) {
      try {
        const encoded=Buffer.isBuffer(req.body) ? req.body.toString('utf8') : typeof req.body==='string' ? req.body : JSON.stringify(req.body);
        if (Buffer.byteLength(encoded)>limit) return reject(Object.assign(new Error('Request too large'),{status:413}));
        const value=JSON.parse(encoded);
        if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Expected an object');
        return resolve(value);
      } catch { return reject(Object.assign(new Error('Expected a JSON object'),{status:400})); }
    }
    let size = 0, tooLarge = false; const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        if (!tooLarge) { tooLarge = true; chunks.length = 0; reject(Object.assign(new Error('Request too large'), {status:413})); }
      } else if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected a JSON object');
        resolve(body);
      } catch { reject(Object.assign(new Error('Expected a JSON object'), {status:400})); }
    });
    req.on('error', reject);
  });
}
function cookieHeader(value, maxAgeSec) {
  return `nafi_admin=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}` + (IS_PROD ? '; Secure' : '');
}

// ---------- handlers ----------
async function createAppointment(req, res, b) {
  const lang = b.lang === 'bn' ? 'bn' : 'en';
  if (!await rateLimit('appt:' + clientIp(req), 15, 3600e3)) {
    return send(res, 429, {
      error: lang === 'bn'
        ? 'অনুরোধের সংখ্যা বেশি হয়েছে। অনুগ্রহ করে সরাসরি চেম্বার হটলাইনে যোগাযোগ করুন।'
        : 'Too many requests. Please call the chamber directly.'
    });
  }
  if (b.website) return send(res, 200, { ok: true, ref: 'NAF-OK' }); // honeypot: pretend success

  const name = clean(b.name, 80);
  const rawPhone = normalizeDigits(clean(b.phone, 35));
  const phone = rawPhone.replace(/[^\d+]/g, '').slice(0, 20);
  const area = clean(b.area, 80);
  const message = clean(b.message, 1000);
  const date = clean(b.date, 10);

  const errors = {};
  if (name.length < 2) {
    errors.name = lang === 'bn' ? 'অনুগ্রহ করে রোগীর পূর্ণ নাম লিখুন।' : 'Please enter your name.';
  }
  if (!/^\+?\d{7,15}$/.test(phone)) {
    errors.phone = lang === 'bn' ? 'অনুগ্রহ করে সঠিক মোবাইল নম্বর প্রদান করুন।' : 'Please enter a valid phone number.';
  }
  if (date) {
    const d = new Date(date + 'T00:00:00Z');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Dhaka', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(d) || d.toISOString().slice(0,10) !== date || date < today) {
      errors.date = lang === 'bn' ? 'অনুগ্রহ করে ভবিষ্যৎ বা আজকের একটি তারিখ নির্বাচন করুন।' : 'Please choose a valid future date.';
    }
  }
  if (Object.keys(errors).length) {
    return send(res, 400, {
      error: lang === 'bn' ? 'অনুগ্রহ করে ফর্মের তথ্য যাচাই করুন।' : 'Please check the form.',
      fields: errors
    });
  }

  const ref = newRef();
  await db.prepare('INSERT INTO appointments (ref,name,phone,area,preferred_date,message,lang) VALUES (?,?,?,?,?,?,?)')
    .run(ref, name, phone, area, date, message, lang);
  send(res, 201, { ok: true, ref });
}

async function queryRows(q) {
  const where = [], args = [];
  if (STATUSES.includes(q.get('status'))) { where.push('status = ?'); args.push(q.get('status')); }
  const s = clean(q.get('q'), 60).replace(/[%_]/g, '');
  if (s) {
    where.push('(name LIKE ? OR phone LIKE ? OR ref LIKE ? OR message LIKE ? OR area LIKE ?)');
    const like = `%${s}%`;
    args.push(like, like, like, like, like);
  }
  const sql = `SELECT * FROM appointments ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 1000`;
  return (await db.prepare(sql).all(...args)).map((r) => ({ ...r }));
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
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return send(res,400,'Invalid URL'); }
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

const handleContent = await createContentStore({db, send, readJson, isAdmin, dataDirectory:path.dirname(path.resolve(DB_PATH))});

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const m = req.method;

  if (p === '/healthz') return send(res, 200, { ok: true });

  if (p.startsWith('/media/') || (p.startsWith('/api/content') && !p.startsWith('/api/admin/'))) {
    if (await handleContent(req,res,url)) return;
    return send(res,404,{error:'Not found'});
  }

  if (p.startsWith('/api/')) {
    if (m !== 'GET' && m !== 'HEAD' && !sameOrigin(req)) return send(res,403,{error:'Bad origin'});
    if (m === 'POST' && p === '/api/appointments') return createAppointment(req, res, await readJson(req));

    if (m === 'POST' && p === '/api/admin/login') {
      const body = await readJson(req);
      if (!sameOrigin(req)) return send(res, 403, { error: 'Bad origin' });
      if (!await rateLimit('login:' + clientIp(req), 8, 15 * 60e3)) return send(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
      if (!safeEqualStr(body.password ?? '', ADMIN_PASSWORD)) return send(res, 401, { error: 'Wrong password' });
      return send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(await makeToken(), SESSION_HOURS * 3600) });
    }
    if (m === 'POST' && p === '/api/admin/logout') {
      await db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(tokenHash(getCookie(req,'nafi_admin')));
      return send(res,200,{ok:true},{'Set-Cookie':cookieHeader('',0)});
    }

    if (p.startsWith('/api/admin/')) {
      if (!await isAdmin(req)) return send(res, 401, { error: 'Not signed in' });
      if (m !== 'GET' && !sameOrigin(req)) return send(res, 403, { error: 'Bad origin' });

      if (await handleContent(req,res,url)) return;

      if (m === 'GET' && p === '/api/admin/me') return send(res, 200, { ok: true });
      if (m === 'GET' && p === '/api/admin/appointments') {
        const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
        for (const r of await db.prepare('SELECT status, COUNT(*) c FROM appointments GROUP BY status').all()) counts[r.status] = Number(r.c);
        return send(res, 200, { rows: await queryRows(url.searchParams), counts });
      }
      if (m === 'GET' && p === '/api/admin/export.csv') {
        return send(res, 200, csv(await queryRows(url.searchParams)), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="appointments.csv"' });
      }
      const mm = p.match(/^\/api\/admin\/appointments\/(\d+)$/);
      if (mm) {
        const id = Number(mm[1]);
        if (m === 'PATCH') {
          const b = await readJson(req);
          const cur = await db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
          if (!cur) return send(res, 404, { error: 'Not found' });
          const status = b.status ?? cur.status;
          if (!STATUSES.includes(status)) return send(res, 400, { error: 'Bad status' });
          const note = b.note === undefined ? cur.note : clean(b.note, 500);
          await db.prepare("UPDATE appointments SET status=?, note=?, updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?").run(status, note, id);
          return send(res, 200, { ok: true });
        }
        if (m === 'DELETE') { await db.prepare('DELETE FROM appointments WHERE id = ?').run(id); return send(res, 200, { ok: true }); }
      }
    }
    return send(res, 404, { error: 'Not found' });
  }

  if (m === 'GET' || m === 'HEAD') return serveStatic(req, res, p);
  send(res, 405, 'Method not allowed', { 'Content-Type': 'text/plain' });
}

const handleRequest = async function handler(req,res) {
  try { await route(req,res); }
  catch (error) {
    if(error.status) return send(res,error.status,{error:error.message});
    console.error(error);
    send(res,500,{error:'Server error'});
  }
};
handleRequest.close=()=>db.close();
return handleRequest;
}

let initialized;
async function handler(req,res) {
  try {
    initialized ||= createApp().catch(error=>{initialized=undefined;throw error;});
    await (await initialized)(req,res);
  } catch(error) {
    console.error(error.message);
    res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end(JSON.stringify({error:'Backend is not configured. Check the database and storage environment variables.'}));
  }
}
handler.close=async()=>{if(initialized){const app=await initialized;await app.close();initialized=undefined;}};
module.exports=handler;
if(require.main===module) {
  const port=Number(process.env.PORT || 3000);
  http.createServer(handler).listen(port,()=>console.log(`Dr. Nafi site running on http://localhost:${port}  (admin: /admin)`));
}
