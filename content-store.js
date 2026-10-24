'use strict';
const createMediaStorage = require('./media-storage');
const crypto = require('node:crypto');

// Keep media outside public/: draft images are served only to authenticated admins.
module.exports = async function contentStore({ db, send, readJson, isAdmin, dataDirectory }) {
  const storage = await createMediaStorage(dataDirectory);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY, filename TEXT NOT NULL, mime TEXT NOT NULL,
      bytes INTEGER NOT NULL, alt TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );
    CREATE TABLE IF NOT EXISTS content (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL,
      title_bn TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', body_bn TEXT NOT NULL DEFAULT '',
      image_id TEXT REFERENCES media(id), hotspots TEXT NOT NULL DEFAULT '[]',
      answer TEXT NOT NULL DEFAULT '', answer_bn TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft', sensitive INTEGER NOT NULL DEFAULT 0,
      consent_confirmed INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );
    CREATE INDEX IF NOT EXISTS content_published ON content(status, kind, category, sort_order);
  `);
  const kinds = ['anatomy', 'trivia', 'clinical'];
  const categories = ['ear', 'nose', 'throat', 'head-neck'];
  function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
  function text(value, max, field) {
    if (value == null) return '';
    if (typeof value !== 'string' || value.length > max) fail(`${field} must be text of at most ${max} characters.`);
    return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  }
  async function normalize(b) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) fail('Expected a content object.');
    if (!kinds.includes(b.kind)) fail('Choose anatomy, trivia or clinical content.');
    if (!categories.includes(b.category)) fail('Choose an ENT category.');
    if (!['draft', 'published'].includes(b.status)) fail('Choose draft or published.');
    const entry = {
      kind: b.kind, category: b.category, status: b.status,
      title: text(b.title, 160, 'Title'), title_bn: text(b.title_bn, 160, 'Bangla title'),
      body: text(b.body, 12000, 'Description'), body_bn: text(b.body_bn, 12000, 'Bangla description'),
      answer: text(b.answer, 2000, 'Trivia answer'), answer_bn: text(b.answer_bn, 2000, 'Bangla answer'),
      image_id: b.image_id || null, sensitive: b.kind === 'clinical' ? 1 : 0,
      consent_confirmed: b.kind === 'clinical' && b.consent_confirmed === true ? 1 : 0,
      sort_order: Number.isInteger(b.sort_order) && Math.abs(b.sort_order) <= 100000 ? b.sort_order : 0,
    };
    if (!entry.title) fail('An English title is required.');
    if (entry.image_id && (typeof entry.image_id !== 'string' || !(await db.prepare('SELECT id FROM media WHERE id=?').get(entry.image_id)))) fail('Upload or select a valid image.');
    if (entry.kind !== 'trivia' && !entry.image_id) fail('Anatomy and clinical entries require an image.');
    if (entry.kind === 'trivia' && (!entry.body || !entry.answer)) fail('Trivia requires a question and an answer.');
    if (entry.status === 'published' && entry.kind === 'clinical' && !entry.consent_confirmed) fail('Confirm patient consent, image rights and de-identification before publishing a clinical image.');
    const hotspots = b.hotspots ?? [];
    if (!Array.isArray(hotspots) || hotspots.length > 30) fail('Use at most 30 image labels.');
    entry.hotspots = JSON.stringify(hotspots.map((point) => {
      if (!point || typeof point !== 'object' || typeof point.x !== 'number' || typeof point.y !== 'number' || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 100 || point.y < 0 || point.y > 100) fail('Image label positions must be percentages from 0 to 100.');
      const label = text(point.label, 120, 'Label');
      if (!label) fail('Each image point requires a label.');
      return {
        x: point.x, y: point.y, label, label_bn: text(point.label_bn, 120, 'Bangla label'),
        description: text(point.description, 1500, 'Structure description'), description_bn: text(point.description_bn, 1500, 'Bangla structure description'),
        pathology: text(point.pathology, 1500, 'Common pathology'), pathology_bn: text(point.pathology_bn, 1500, 'Bangla pathology'),
        symptoms: text(point.symptoms, 1500, 'Symptoms'), symptoms_bn: text(point.symptoms_bn, 1500, 'Bangla symptoms'),
      };
    }));
    return entry;
  }
  async function serialize(row, admin = false) {
    const media = row.image_id ? await db.prepare('SELECT id,alt,mime,bytes FROM media WHERE id=?').get(row.image_id) : null;
    const result = { ...row, hotspots: JSON.parse(row.hotspots), sensitive: !!row.sensitive, image: media ? { ...media, url: `/media/${media.id}` } : null };
    if (admin) result.consent_confirmed = !!row.consent_confirmed;
    else { delete result.consent_confirmed; delete result.image_id; }
    return result;
  }
  async function list(params, admin) {
    const where = admin ? [] : ["status='published'"];
    const args = [];
    for (const [key, values] of [['kind', kinds], ['category', categories], ['status', ['draft','published']]]) {
      const value = params.get(key);
      if (key === 'status' && !admin) continue;
      if (value && values.includes(value)) { where.push(`${key}=?`); args.push(value); }
    }
    const q = (params.get('q') || '').trim().slice(0, 100);
    if (q) { where.push('(title LIKE ? OR title_bn LIKE ? OR body LIKE ? OR body_bn LIKE ?)'); args.push(...Array(4).fill(`%${q.replace(/[%_]/g, '')}%`)); }
    const count = Number((await db.prepare(`SELECT COUNT(*) AS count FROM content ${where.length ? 'WHERE '+where.join(' AND ') : ''}`).get(...args)).count);
    const limit = Math.min(100, Math.max(1, Number(params.get('limit')) || 30));
    const offset = Math.max(0, Math.min(1000000, Number(params.get('offset')) || 0));
    const rows = await db.prepare(`SELECT * FROM content ${where.length ? 'WHERE '+where.join(' AND ') : ''} ORDER BY sort_order ASC, id DESC LIMIT ? OFFSET ?`).all(...args, Math.floor(limit), Math.floor(offset));
    return { items: await Promise.all(rows.map(row => serialize(row, admin))), total: count, limit: Math.floor(limit), offset: Math.floor(offset) };
  }
  function imageType(buffer) {
    if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && buffer.toString('ascii',12,16) === 'IHDR') {
      return { mime:'image/png', ext:'png', width:buffer.readUInt32BE(16), height:buffer.readUInt32BE(20) };
    }
    if (buffer.length >= 12 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255 && buffer[buffer.length-2] === 255 && buffer[buffer.length-1] === 217) return { mime:'image/jpeg', ext:'jpg' };
    if (buffer.length >= 30 && buffer.toString('ascii',0,4) === 'RIFF' && buffer.toString('ascii',8,12) === 'WEBP' && buffer.readUInt32LE(4) === buffer.length-8) return { mime:'image/webp', ext:'webp' };
    return null;
  }
  return async function handleContent(req, res, url) {
    const p = url.pathname, method = req.method;
    const mediaMatch = p.match(/^\/media\/([a-f0-9]{32})$/);
    if (mediaMatch && (method === 'GET' || method === 'HEAD')) {
      const id = mediaMatch[1];
      const media = await db.prepare('SELECT * FROM media WHERE id=?').get(id);
      const published = await db.prepare("SELECT id FROM content WHERE image_id=? AND status='published' LIMIT 1").get(id);
      if (!media || (!published && !await isAdmin(req))) { send(res,404,{error:'Image not found'}); return true; }
      let data;
      try { data = await storage.read(media.filename); }
      catch { send(res,404,{error:'Image not found'}); return true; }
      send(res,200,method === 'HEAD' ? null : data,{'Content-Type':media.mime,'Content-Length':data.length,'Cache-Control':'private, no-store','Content-Disposition':'inline'});
      return true;
    }
    if (p === '/api/content' && method === 'GET') { send(res,200,await list(url.searchParams,false),{'Cache-Control':'no-store'}); return true; }
    const publicMatch = p.match(/^\/api\/content\/(\d+)$/);
    if (publicMatch && method === 'GET') {
      const row = await db.prepare("SELECT * FROM content WHERE id=? AND status='published'").get(Number(publicMatch[1]));
      send(res,row ? 200 : 404,row ? await serialize(row) : {error:'Content not found'},{'Cache-Control':'no-store'}); return true;
    }
    // Admin routes are called only after the main router's authentication/origin checks.
    if (p === '/api/admin/media' && method === 'GET') {
      const items = await db.prepare('SELECT id,alt,mime,bytes,created_at FROM media ORDER BY created_at DESC LIMIT 200').all();
      send(res,200,{items:items.map(item=>({...item,url:`/media/${item.id}`}))}); return true;
    }
    if (p === '/api/admin/media' && method === 'POST') {
      const b = await readJson(req, 9 * 1024 * 1024);
      const alt = text(b.alt,300,'Image alternative text');
      if (!alt) fail('Describe this image for visitors using screen readers.');
      if (typeof b.data !== 'string' || (b.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b.data))) fail('Provide a base64 encoded PNG, JPEG or WebP image.');
      const data = Buffer.from(b.data,'base64');
      const maxBytes=(process.env.VERCEL ? 3 : 6)*1024*1024;
      if (!data.length || data.length > maxBytes) fail(`Prepared images must be no larger than ${maxBytes/1024/1024} MB.`,413);
      const type = imageType(data);
      if (!type || (type.width !== undefined && (!type.width || !type.height || type.width > 12000 || type.height > 12000))) fail('Upload a valid PNG, JPEG or WebP image. SVG and animated GIF files are not supported.');
      const id = crypto.randomBytes(16).toString('hex');
      const filename = await storage.write(`${id}.${type.ext}`,data,type.mime);
      try { await db.prepare('INSERT INTO media(id,filename,mime,bytes,alt) VALUES(?,?,?,?,?)').run(id,filename,type.mime,data.length,alt); }
      catch (error) { await storage.remove(filename); throw error; }
      send(res,201,{id,alt,mime:type.mime,bytes:data.length,url:`/media/${id}`}); return true;
    }
    const mediaAdminMatch = p.match(/^\/api\/admin\/media\/([a-f0-9]{32})$/);
    if (mediaAdminMatch && method === 'PATCH') {
      const id=mediaAdminMatch[1];
      if (!(await db.prepare('SELECT id FROM media WHERE id=?').get(id))) fail('Image not found.',404);
      const body=await readJson(req), alt=text(body.alt,300,'Image alternative text');
      if (!alt) fail('An image description is required.');
      await db.prepare('UPDATE media SET alt=? WHERE id=?').run(alt,id);
      send(res,200,{ok:true}); return true;
    }
    if (mediaAdminMatch && method === 'DELETE') {
      const id=mediaAdminMatch[1], row=await db.prepare('SELECT * FROM media WHERE id=?').get(id);
      if (!row) fail('Image not found.',404);
      if (await db.prepare('SELECT id FROM content WHERE image_id=? LIMIT 1').get(id)) fail('This image is used by content. Remove it from that entry first.',409);
      await storage.remove(row.filename);
      await db.prepare('DELETE FROM media WHERE id=?').run(id);
      send(res,200,{ok:true}); return true;
    }
    if (p === '/api/admin/content' && method === 'GET') { send(res,200,await list(url.searchParams,true)); return true; }
    if (p === '/api/admin/content' && method === 'POST') {
      const entry = await normalize(await readJson(req, 256 * 1024));
      const keys=Object.keys(entry);
      const result=await db.prepare(`INSERT INTO content(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...Object.values(entry));
      send(res,201,await serialize(await db.prepare('SELECT * FROM content WHERE id=?').get(result.lastInsertRowid),true)); return true;
    }
    const adminMatch=p.match(/^\/api\/admin\/content\/(\d+)$/);
    if (adminMatch) {
      const id=Number(adminMatch[1]), row=await db.prepare('SELECT * FROM content WHERE id=?').get(id);
      if (!row) fail('Content not found.',404);
      if (method==='GET') { send(res,200,await serialize(row,true)); return true; }
      if (method==='PUT') {
        const entry=await normalize(await readJson(req,256*1024));
        await db.prepare(`UPDATE content SET ${Object.keys(entry).map(key=>`${key}=?`).join(',')},updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?`).run(...Object.values(entry),id);
        send(res,200,await serialize(await db.prepare('SELECT * FROM content WHERE id=?').get(id),true)); return true;
      }
      if (method==='DELETE') { await db.prepare('DELETE FROM content WHERE id=?').run(id); send(res,200,{ok:true}); return true; }
    }
    return false;
  };
};
