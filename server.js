#!/usr/bin/env node
/*
 * Mermaid Editor – lokaler Server (ohne Abhängigkeiten).
 *
 *   node server.js [datei.md | ordner] [--port 4777] [--no-open] [--stay]
 *
 * Läuft nur auf 127.0.0.1. Alle API-Aufrufe brauchen ein Token, das beim Start
 * erzeugt und nur in die eigene Seite eingebettet wird. Lesen/Schreiben ist auf
 * Text-Dateitypen beschränkt (.md, .mmd, …).
 */
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');

const APP_ID = 'mermaid-editor';
const PUBLIC_DIR = path.join(__dirname, 'public');
const ALLOWED_EXT = new Set(['.md', '.markdown', '.mmd', '.mermaid', '.txt']);
const IDLE_EXIT_MS = 2 * 60 * 1000; // Server beendet sich, wenn 2 min kein Tab offen ist

// ---------- Argumente ----------
const argv = process.argv.slice(2);
let port = 4777;
let openBrowser = true;
let stay = false;
let target = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--port') port = Number(argv[++i]);
  else if (a === '--no-open') openBrowser = false;
  else if (a === '--stay') stay = true;
  else if (!a.startsWith('--')) target = path.resolve(a);
}

let initialFile = null;
let initialDir = null;
if (target) {
  try {
    const st = fs.statSync(target);
    if (st.isDirectory()) initialDir = target;
    else { initialFile = target; initialDir = path.dirname(target); }
  } catch {
    // Datei existiert noch nicht → wird beim ersten Speichern angelegt
    if (ALLOWED_EXT.has(path.extname(target).toLowerCase())) {
      initialFile = target; initialDir = path.dirname(target);
    }
  }
}

const token = crypto.randomBytes(24).toString('hex');

// ---------- Hilfsfunktionen ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(data);
}

function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Body zu gross')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function checkPath(p) {
  if (typeof p !== 'string' || !path.isAbsolute(p)) throw httpError(400, 'Ungültiger Pfad');
  const norm = path.normalize(p);
  if (!ALLOWED_EXT.has(path.extname(norm).toLowerCase())) throw httpError(403, 'Dateityp nicht erlaubt');
  return norm;
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function osascript(script) {
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], { timeout: 10 * 60 * 1000 }, (err, stdout) => {
      if (err) resolve(null); // abgebrochen
      else resolve(stdout.trim() || null);
    });
  });
}

function asStr(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// Dialoge erscheinen vor dem Browser
const ACTIVATE = 'activate';

async function listFiles(dir, maxDepth = 4, maxFiles = 800) {
  const out = [];
  async function walk(d, depth) {
    if (out.length >= maxFiles) return;
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (depth < maxDepth) await walk(full, depth + 1);
      } else if (ALLOWED_EXT.has(path.extname(e.name).toLowerCase()) && path.extname(e.name).toLowerCase() !== '.txt') {
        out.push({ path: full, rel: path.relative(dir, full) });
        if (out.length >= maxFiles) return;
      }
    }
  }
  await walk(dir, 0);
  return out;
}

// ---------- Datei-Überwachung (SSE) ----------
const clients = new Set(); // { res, watched: Map<path, watcher> }
let idleTimer = null;

function scheduleIdleExit() {
  if (stay) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (clients.size === 0) {
      console.log('Kein Editor-Tab mehr offen – Server wird beendet.');
      process.exit(0);
    }
  }, IDLE_EXIT_MS);
}

function watchFor(client, file) {
  for (const [, w] of client.watched) w.close();
  client.watched.clear();
  if (!file) return;
  let timer = null;
  const notify = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const st = await fsp.stat(file);
        client.res.write(`event: change\ndata: ${JSON.stringify({ path: file, mtime: st.mtimeMs })}\n\n`);
      } catch { /* gelöscht/umbenannt */ }
    }, 120);
  };
  try {
    // Ordner beobachten: übersteht auch "atomic save" (Datei wird ersetzt)
    const w = fs.watch(path.dirname(file), (ev, name) => {
      if (!name || name === path.basename(file)) notify();
    });
    client.watched.set(file, w);
  } catch { /* ignorieren */ }
}

// ---------- API ----------
async function handleApi(req, res, url) {
  if (req.headers['x-token'] !== token && url.searchParams.get('token') !== token) {
    throw httpError(403, 'Token fehlt');
  }
  const route = url.pathname.slice('/api/'.length);

  if (route === 'events' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(': ok\n\n');
    const client = { res, watched: new Map() };
    clients.add(client);
    clearTimeout(idleTimer);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    const f = url.searchParams.get('file');
    if (f) { try { watchFor(client, checkPath(f)); } catch { /* */ } }
    req.on('close', () => {
      clearInterval(ping);
      for (const [, w] of client.watched) w.close();
      clients.delete(client);
      if (clients.size === 0) scheduleIdleExit();
    });
    // Watch-Ziel über eine zweite Anfrage ändern
    client.id = crypto.randomBytes(8).toString('hex');
    res.write(`event: hello\ndata: ${JSON.stringify({ id: client.id })}\n\n`);
    return;
  }

  if (route === 'watch' && req.method === 'POST') {
    const { id, path: p } = JSON.parse(await readBody(req) || '{}');
    const client = [...clients].find((c) => c.id === id);
    if (client) watchFor(client, p ? checkPath(p) : null);
    return send(res, 200, { ok: true });
  }

  if (route === 'state') {
    return send(res, 200, {
      file: initialFile,
      dir: initialDir,
      home: os.homedir(),
    });
  }

  if (route === 'files') {
    const dir = url.searchParams.get('dir');
    if (!dir || !path.isAbsolute(dir)) throw httpError(400, 'Ordner fehlt');
    return send(res, 200, { dir, files: await listFiles(dir) });
  }

  if (route === 'file' && req.method === 'GET') {
    const p = checkPath(url.searchParams.get('path'));
    try {
      const [content, st] = await Promise.all([fsp.readFile(p, 'utf8'), fsp.stat(p)]);
      return send(res, 200, { path: p, content, mtime: st.mtimeMs });
    } catch (e) {
      if (e.code === 'ENOENT') return send(res, 200, { path: p, content: '', mtime: 0, isNew: true });
      throw e;
    }
  }

  if (route === 'file' && req.method === 'PUT') {
    const body = JSON.parse(await readBody(req));
    const p = checkPath(body.path);
    if (body.baseMtime && !body.force) {
      try {
        const st = await fsp.stat(p);
        if (Math.abs(st.mtimeMs - body.baseMtime) > 1) {
          return send(res, 409, { error: 'conflict', mtime: st.mtimeMs });
        }
      } catch { /* neu */ }
    }
    await fsp.mkdir(path.dirname(p), { recursive: true });
    await fsp.writeFile(p, body.content, 'utf8');
    const st = await fsp.stat(p);
    return send(res, 200, { path: p, mtime: st.mtimeMs });
  }

  if (route === 'stat') {
    const p = checkPath(url.searchParams.get('path'));
    try { const st = await fsp.stat(p); return send(res, 200, { mtime: st.mtimeMs }); }
    catch { return send(res, 200, { mtime: 0, missing: true }); }
  }

  if (route === 'dialog/open' && req.method === 'POST') {
    const { dir } = JSON.parse(await readBody(req) || '{}');
    const loc = dir ? ` default location (POSIX file ${asStr(dir)})` : '';
    const r = await osascript(`${ACTIVATE}\nPOSIX path of (choose file with prompt "Datei öffnen"${loc})`);
    if (r && !ALLOWED_EXT.has(path.extname(r).toLowerCase())) {
      throw httpError(400, 'Bitte eine .md- oder .mmd-Datei wählen');
    }
    return send(res, 200, { path: r });
  }

  if (route === 'dialog/save' && req.method === 'POST') {
    const { dir, name } = JSON.parse(await readBody(req) || '{}');
    const loc = dir ? ` default location (POSIX file ${asStr(dir)})` : '';
    let r = await osascript(`${ACTIVATE}\nPOSIX path of (choose file name with prompt "Speichern unter" default name ${asStr(name || 'Diagramm.md')}${loc})`);
    if (r && !ALLOWED_EXT.has(path.extname(r).toLowerCase())) r += '.md';
    return send(res, 200, { path: r });
  }

  if (route === 'dialog/folder' && req.method === 'POST') {
    const { dir } = JSON.parse(await readBody(req) || '{}');
    const loc = dir ? ` default location (POSIX file ${asStr(dir)})` : '';
    const r = await osascript(`${ACTIVATE}\nPOSIX path of (choose folder with prompt "Ordner öffnen"${loc})`);
    return send(res, 200, { path: r ? r.replace(/\/$/, '') : null });
  }

  if (route === 'asset') {
    // Bilder, die in Markdown relativ eingebunden sind
    const p = url.searchParams.get('path');
    const ext = path.extname(p || '').toLowerCase();
    const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
    if (!p || !path.isAbsolute(p) || !types[ext]) throw httpError(403, 'Nicht erlaubt');
    const data = await fsp.readFile(path.normalize(p)).catch(() => { throw httpError(404, 'Nicht gefunden'); });
    res.writeHead(200, { 'Content-Type': types[ext], 'Cache-Control': 'no-cache', 'Content-Security-Policy': "script-src 'none'" });
    res.end(data);
    return;
  }

  if (route === 'reveal' && req.method === 'POST') {
    const { path: p } = JSON.parse(await readBody(req) || '{}');
    execFile('open', ['-R', checkPath(p)]);
    return send(res, 200, { ok: true });
  }

  throw httpError(404, 'Unbekannte API');
}

// ---------- Statische Dateien ----------
async function handleStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const full = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!full.startsWith(PUBLIC_DIR + path.sep)) throw httpError(403, 'Nein');
  let data;
  try { data = await fsp.readFile(full); } catch { throw httpError(404, 'Nicht gefunden'); }
  if (rel === '/index.html') {
    data = data.toString('utf8').replace('__TOKEN__', token);
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
    'Cache-Control': rel === '/index.html' ? 'no-store' : 'no-cache',
  });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  try {
    // Schutz gegen DNS-Rebinding
    const host = (req.headers.host || '').split(':')[0];
    if (host !== '127.0.0.1' && host !== 'localhost') throw httpError(403, 'Host nicht erlaubt');
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/ping') return send(res, 200, { app: APP_ID });
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return await handleStatic(req, res, url);
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.message });
    else res.end();
  }
});

function pageUrl() {
  const u = new URL(`http://127.0.0.1:${port}/`);
  if (initialFile) u.searchParams.set('file', initialFile);
  else if (initialDir) u.searchParams.set('dir', initialDir);
  return u.toString();
}

function open(u) {
  if (!openBrowser) return;
  execFile('open', [u]);
}

// Läuft schon ein Editor auf dem Port? Dann nur neuen Tab öffnen.
function probeExisting() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/ping', timeout: 800 }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b).app === APP_ID); } catch { resolve(false); } });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

(async () => {
  if (await probeExisting()) {
    console.log(`Mermaid Editor läuft bereits auf Port ${port} – öffne neuen Tab.`);
    open(pageUrl());
    return;
  }
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') { port++; server.listen(port, '127.0.0.1'); }
    else { console.error(e); process.exit(1); }
  });
  server.listen(port, '127.0.0.1', () => {});
  server.on('listening', () => {
    console.log(`Mermaid Editor: ${pageUrl()}`);
    open(pageUrl());
    // Falls nie ein Tab verbindet
    scheduleIdleExit();
  });
})();
