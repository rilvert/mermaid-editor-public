// Mermaid Editor – App
import { createEditor } from './editor.js';
import { createPreview } from './preview.js';

const TOKEN = document.querySelector('meta[name="token"]').content;
const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem('mme.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('mme.' + k, JSON.stringify(v)); } catch { /* */ } },
};

const dirname = (p) => p.replace(/\/[^/]*$/, '') || '/';
const basename = (p) => p.replace(/^.*\//, '');
const kindOf = (p) => (/\.(mmd|mermaid)$/i.test(p || '') ? 'mermaid' : 'markdown');

// ---------------------------------------------------------------- API
// In der Mac-App läuft alles über die native Brücke, im Browser über den lokalen Server.
const NATIVE = window.webkit?.messageHandlers?.mme || null;
if (NATIVE) document.documentElement.classList.add('native');

async function api(route, { method = 'GET', body, query } = {}) {
  if (NATIVE) {
    const r = await NATIVE.postMessage({ route, method, body: body ?? null, query: query ?? null });
    if (r && r.error) { const e = new Error(r.error); e.status = r.status; e.data = r; throw e; }
    return r || {};
  }
  const u = new URL('/api/' + route, location.origin);
  for (const [k, v] of Object.entries(query || {})) if (v != null) u.searchParams.set(k, v);
  const r = await fetch(u, {
    method,
    headers: { 'X-Token': TOKEN, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || r.statusText); e.status = r.status; e.data = data; throw e; }
  return data;
}

// ---------------------------------------------------------------- Zustand
const state = {
  path: null,
  mtime: 0,
  saved: '',
  kind: 'markdown',
  root: null,
  home: '',
  dirty: false,
  saving: false,
  saveAgain: false,
  conflict: false,
  autosave: store.get('autosave', true),
  wrap: store.get('wrap', true),
  view: store.get('view', 'split'),
  sidebar: store.get('sidebar', false),
  theme: store.get('theme', 'auto'),
  files: [],
};

// ---------------------------------------------------------------- Toast/Status
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function setStatus(text, cls = '') {
  const s = $('#save-status');
  s.textContent = text;
  s.className = cls;
}

function updateTitle() {
  const name = state.path ? basename(state.path) : 'Unbenannt';
  $('#file-name').textContent = name;
  $('#file-name').title = state.path || 'Noch nicht gespeichert';
  $('#file-dir').textContent = state.path ? dirname(state.path).replace(state.home, '~') : '';
  document.title = `${state.dirty ? '● ' : ''}${name} – Mermaid Editor`;
  document.body.classList.toggle('is-dirty', state.dirty);
  reportStatus();
}

let lastStatus = '';
function reportStatus() {
  if (!NATIVE) return;
  const dark = document.documentElement.dataset.theme === 'dark';
  const s = { path: state.path, dirty: state.dirty, appearance: state.theme === 'auto' ? null : dark ? 'dark' : 'light' };
  const key = JSON.stringify(s);
  if (key === lastStatus) return;
  lastStatus = key;
  api('status', { method: 'POST', body: s }).catch(() => {});
}

function updateDirty() {
  state.dirty = editor.getText() !== state.saved;
  if (state.conflict) setStatus('Konflikt', 'warn');
  else if (state.saving) setStatus('Speichert …');
  else if (state.dirty) setStatus(state.path ? (state.autosave ? 'Änderungen …' : 'Nicht gespeichert') : 'Nicht gespeichert', 'muted');
  else setStatus(state.path ? 'Gespeichert' : '', 'ok');
  updateTitle();
}

// ---------------------------------------------------------------- Editor + Vorschau
let previewTimer;
let syncTimer;
let autoTimer;

const editor = createEditor($('#editor'), {
  onChange() {
    updateDirty();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => preview.update(editor.getText()), 220);
    if (!state.path) store.set('draft', editor.getText());
    clearTimeout(autoTimer);
    if (state.autosave && state.path && !state.conflict) autoTimer = setTimeout(() => { if (state.dirty) save(); }, 900);
  },
  onSelection(u) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => preview.highlightLines(editor.selectedLines(), { scroll: true }), u.docChanged ? 260 : 40);
  },
});

const preview = createPreview($('#preview-pane'), $('#preview'), {
  onJump(line) {
    if (state.view === 'preview') return; // reine Diagramm-Ansicht: kein Sprung in den Code
    editor.jumpTo(line);
  },
  onHover: (lines) => { if (state.view !== 'preview') editor.setHoverLines(lines); },
  onErrors: (lines) => editor.setErrorLines(lines),
  onZoom: (z) => { $('#zoom-val').textContent = Math.round(z * 100) + '%'; store.set('zoom', z); },
  lineText: (l) => editor.lineText(l),
  toast,
  saveFile: NATIVE ? async (blob, name) => {
    const r = await api('export', { method: 'POST', body: { name, data: await toBase64(blob) } });
    if (r.saved) toast('Gespeichert: ' + basename(r.path));
  } : null,
  copyImage: NATIVE ? async (blob) => {
    await api('copyImage', { method: 'POST', body: { data: await toBase64(await blob) } });
    toast('Diagramm als Bild kopiert');
  } : null,
  baseName: () => (state.path ? basename(state.path).replace(/\.[^.]+$/, '') : 'diagramm'),
  assetUrl: (src) => {
    const dir = state.path ? dirname(state.path) : state.root || state.home;
    const abs = src.startsWith('/') ? src : `${dir}/${decodeURI(src)}`;
    return `/api/asset?token=${TOKEN}&path=${encodeURIComponent(abs)}`;
  },
});

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).replace(/^data:[^,]*,/, ''));
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

function renderNow() {
  clearTimeout(previewTimer);
  preview.update(editor.getText());
}

// ---------------------------------------------------------------- Ansicht
function setView(v) {
  state.view = v;
  store.set('view', v);
  const ws = $('#workspace');
  ws.classList.remove('view-code', 'view-split', 'view-preview');
  ws.classList.add('view-' + v);
  document.querySelectorAll('#view-switch button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  requestAnimationFrame(() => {
    editor.view.requestMeasure();
    preview.refresh();
  });
}

function setSidebar(on) {
  state.sidebar = on;
  store.set('sidebar', on);
  $('#workspace').classList.toggle('with-sidebar', on);
  $('#btn-sidebar').classList.toggle('active', on);
  if (on) loadFiles();
}

const darkMq = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const dark = state.theme === 'dark' || (state.theme === 'auto' && darkMq.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  editor.setDark(dark);
  preview.setDark(dark);
  renderNow();
  document.querySelectorAll('[data-theme-opt]').forEach((b) => b.classList.toggle('checked', b.dataset.themeOpt === state.theme));
  reportStatus();
}
darkMq.addEventListener('change', () => state.theme === 'auto' && applyTheme());

// Trennlinie ziehen
{
  const div = $('#divider');
  const ws = $('#panes');
  const saved = store.get('split', 50);
  ws.style.setProperty('--split', saved + '%');
  div.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    div.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
    const pane = $('#editor-pane').getBoundingClientRect();
    const total = $('#editor-pane').offsetWidth + $('#preview-pane').offsetWidth;
    const move = (ev) => {
      const pct = Math.max(15, Math.min(85, ((ev.clientX - pane.left) / total) * 100));
      ws.style.setProperty('--split', pct + '%');
      store.set('split', Math.round(pct * 10) / 10);
    };
    const up = () => {
      div.removeEventListener('pointermove', move);
      div.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing');
      editor.view.requestMeasure();
      preview.refresh();
    };
    div.addEventListener('pointermove', move);
    div.addEventListener('pointerup', up);
  });
  div.addEventListener('dblclick', () => { ws.style.setProperty('--split', '50%'); store.set('split', 50); });
}

// ---------------------------------------------------------------- Dateien
let es = null;
let clientId = null;

function connectEvents() {
  if (NATIVE) {
    window.__mmeNative = (ev) => {
      if (ev.type === 'change' && ev.path === state.path && Math.abs(ev.mtime - state.mtime) > 1) onExternalChange();
    };
    clientId = 'native';
    return;
  }
  es = new EventSource(`/api/events?token=${TOKEN}`);
  es.addEventListener('hello', (e) => {
    clientId = JSON.parse(e.data).id;
    document.body.classList.remove('offline');
    if (state.path) watch(state.path);
  });
  es.addEventListener('change', (e) => {
    const d = JSON.parse(e.data);
    if (d.path === state.path && Math.abs(d.mtime - state.mtime) > 1) onExternalChange();
  });
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED || es.readyState === EventSource.CONNECTING) {
      document.body.classList.add('offline');
    }
  };
}

function watch(path) {
  if (clientId) api('watch', { method: 'POST', body: { id: clientId, path } }).catch(() => {});
}

async function onExternalChange() {
  if (!state.path || state.saving) return;
  let r;
  try { r = await api('file', { query: { path: state.path } }); } catch { return; }
  if (r.content === editor.getText()) {
    state.mtime = r.mtime;
    state.saved = r.content;
    updateDirty();
    return;
  }
  if (!state.dirty) {
    state.saved = r.content;
    state.mtime = r.mtime;
    editor.replaceDoc(r.content);
    updateDirty();
    toast('Datei wurde extern geändert – neu geladen');
  } else {
    showConflict(r);
  }
}

function showConflict(disk) {
  state.conflict = true;
  updateDirty();
  const bar = $('#conflict');
  bar.hidden = false;
  bar.querySelector('[data-act="reload"]').onclick = async () => {
    const r = disk || (await api('file', { query: { path: state.path } }));
    state.conflict = false;
    state.saved = r.content;
    state.mtime = r.mtime;
    editor.replaceDoc(r.content);
    bar.hidden = true;
    updateDirty();
  };
  bar.querySelector('[data-act="keep"]').onclick = async () => {
    state.conflict = false;
    bar.hidden = true;
    await save({ force: true });
  };
}

async function openFile(path, { quiet = false } = {}) {
  if (state.dirty && state.path && !state.conflict) await save();
  else if (state.dirty && !state.path && editor.getText().trim() && !confirm('Ungespeicherten Text verwerfen?')) return false;
  let r;
  try {
    r = await api('file', { query: { path } });
  } catch (e) {
    if (!quiet) toast('Öffnen fehlgeschlagen: ' + e.message);
    return false;
  }
  state.path = r.path;
  state.mtime = r.mtime;
  state.saved = r.content;
  state.kind = kindOf(r.path);
  state.conflict = false;
  $('#conflict').hidden = true;
  preview.setKind(state.kind);
  editor.setDoc(r.content, state.kind);
  editor.setWrap(state.wrap);
  store.set('lastFile', r.path);
  const u = new URL(location.href);
  u.searchParams.delete('dir');
  u.searchParams.set('file', r.path);
  history.replaceState(null, '', u);
  watch(r.path);
  if (!state.root || !r.path.startsWith(state.root + '/')) setRoot(dirname(r.path));
  else markActiveFile();
  updateDirty();
  renderNow();
  if (r.isNew) toast('Neue Datei – wird beim Speichern angelegt');
  return true;
}

function newDoc() {
  if (state.dirty && state.path) save();
  state.path = null;
  state.mtime = 0;
  state.saved = '';
  state.kind = 'markdown';
  preview.setKind('markdown');
  editor.setDoc(SAMPLE_NEW, 'markdown');
  editor.setWrap(state.wrap);
  const u = new URL(location.href);
  u.searchParams.delete('file');
  history.replaceState(null, '', u);
  watch(null);
  updateDirty();
  markActiveFile();
  renderNow();
}

let dialogOpen = false;

async function save({ as = false, force = false } = {}) {
  if (state.saving) { state.saveAgain = true; return; }
  let path = state.path;
  if (!path || as) {
    if (dialogOpen) return;
    const name = state.path ? basename(state.path) : 'Diagramm.md';
    dialogOpen = true;
    const r = await api('dialog/save', { method: 'POST', body: { dir: state.path ? dirname(state.path) : state.root || state.home, name } })
      .catch((e) => { toast(e.message); return {}; })
      .finally(() => { dialogOpen = false; });
    if (!r.path) return;
    path = r.path;
  }
  const content = editor.getText();
  state.saving = true;
  updateDirty();
  try {
    const sameFile = path === state.path;
    const r = await api('file', { method: 'PUT', body: { path, content, baseMtime: sameFile && !force ? state.mtime : 0, force } });
    const changedPath = path !== state.path;
    state.path = path;
    state.mtime = r.mtime;
    state.saved = content;
    if (changedPath) {
      store.set('lastFile', path);
      store.set('draft', null);
      const u = new URL(location.href);
      u.searchParams.set('file', path);
      history.replaceState(null, '', u);
      watch(path);
      if (kindOf(path) !== state.kind) {
        state.kind = kindOf(path);
        preview.setKind(state.kind);
        editor.setDoc(content, state.kind);
        renderNow();
      }
      if (!state.root || !path.startsWith(state.root + '/')) setRoot(dirname(path));
      else loadFiles();
    }
  } catch (e) {
    if (e.status === 409) showConflict(null);
    else toast('Speichern fehlgeschlagen: ' + e.message);
  } finally {
    state.saving = false;
    updateDirty();
    if (state.saveAgain) { state.saveAgain = false; if (state.dirty) save(); }
  }
}

async function openDialog() {
  if (dialogOpen) return;
  dialogOpen = true;
  try {
    const r = await api('dialog/open', { method: 'POST', body: { dir: state.path ? dirname(state.path) : state.root } });
    if (r.path) openFile(r.path);
  } catch (e) { toast(e.message); } finally { dialogOpen = false; }
}

async function folderDialog() {
  if (dialogOpen) return;
  dialogOpen = true;
  const r = await api('dialog/folder', { method: 'POST', body: { dir: state.root } }).catch(() => ({})).finally(() => { dialogOpen = false; });
  if (r.path) { setRoot(r.path); setSidebar(true); }
}

// ---------------------------------------------------------------- Seitenleiste
function setRoot(dir) {
  state.root = dir;
  store.set('root', dir);
  $('#root-name').textContent = basename(dir) || dir;
  $('#root-name').title = dir;
  if (state.sidebar) loadFiles();
}

async function loadFiles() {
  if (!state.root) return;
  try {
    const r = await api('files', { query: { dir: state.root } });
    state.files = r.files;
  } catch { state.files = []; }
  renderFiles();
}

function renderFiles() {
  const q = $('#file-filter').value.trim().toLowerCase();
  const list = $('#file-list');
  list.replaceChildren();
  let lastDir = null;
  const files = state.files.filter((f) => !q || f.rel.toLowerCase().includes(q));
  for (const f of files) {
    const dir = f.rel.includes('/') ? f.rel.replace(/\/[^/]*$/, '') : '';
    if (dir !== lastDir && dir) {
      const h = document.createElement('div');
      h.className = 'file-dir';
      h.textContent = dir;
      list.appendChild(h);
    }
    lastDir = dir;
    const b = document.createElement('button');
    b.className = 'file' + (dir ? ' nested' : '');
    b.dataset.path = f.path;
    b.innerHTML = `<span class="ext">${/\.(mmd|mermaid)$/i.test(f.rel) ? '◇' : '¶'}</span><span class="nm"></span>`;
    b.querySelector('.nm').textContent = basename(f.rel);
    b.title = f.path;
    b.onclick = () => openFile(f.path);
    list.appendChild(b);
  }
  if (!files.length) list.innerHTML = '<div class="empty">Keine .md / .mmd-Dateien</div>';
  markActiveFile();
}

function markActiveFile() {
  document.querySelectorAll('#file-list .file').forEach((b) => b.classList.toggle('active', b.dataset.path === state.path));
}

$('#file-filter').addEventListener('input', renderFiles);
$('#btn-folder').onclick = folderDialog;
$('#btn-refresh').onclick = loadFiles;

// ---------------------------------------------------------------- Toolbar / Menü
$('#btn-sidebar').onclick = () => setSidebar(!state.sidebar);
document.querySelectorAll('#view-switch button').forEach((b) => (b.onclick = () => setView(b.dataset.view)));
$('#btn-open').onclick = openDialog;
$('#btn-save').onclick = () => save();
$('#zoom-in').onclick = () => preview.setZoom(preview.getZoom() * 1.2);
$('#zoom-out').onclick = () => preview.setZoom(preview.getZoom() / 1.2);
$('#zoom-val').onclick = () => preview.setZoom(1);

const menu = $('#menu');
$('#btn-menu').onclick = (e) => {
  e.stopPropagation();
  menu.hidden = !menu.hidden;
};
document.addEventListener('click', (e) => { if (!menu.contains(e.target)) menu.hidden = true; });
menu.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const act = b.dataset.act;
  if (b.dataset.themeOpt) { state.theme = b.dataset.themeOpt; store.set('theme', state.theme); applyTheme(); return; }
  menu.hidden = true;
  if (act === 'new') newDoc();
  if (act === 'open') openDialog();
  if (act === 'folder') folderDialog();
  if (act === 'saveas') save({ as: true });
  if (act === 'reveal' && state.path) api('reveal', { method: 'POST', body: { path: state.path } });
  if (act === 'autosave') { state.autosave = !state.autosave; store.set('autosave', state.autosave); syncMenu(); updateDirty(); if (state.autosave && state.dirty && state.path) save(); }
  if (act === 'wrap') { state.wrap = !state.wrap; store.set('wrap', state.wrap); editor.setWrap(state.wrap); syncMenu(); }
});
function syncMenu() {
  menu.querySelector('[data-act="autosave"]').classList.toggle('checked', state.autosave);
  menu.querySelector('[data-act="wrap"]').classList.toggle('checked', state.wrap);
}

// Tastenkürzel ausserhalb des Editors
document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save({ as: e.shiftKey }); }
  else if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); openDialog(); }
  else if (e.ctrlKey && !e.metaKey && ['1', '2', '3'].includes(e.key)) {
    e.preventDefault();
    setView({ 1: 'code', 2: 'split', 3: 'preview' }[e.key]);
  }
});

window.addEventListener('beforeunload', (e) => {
  if (state.dirty && (state.path || editor.getText().trim())) {
    if (state.path && state.autosave) save();
    e.preventDefault();
    e.returnValue = '';
  }
});

// ---------------------------------------------------------------- Start
const SAMPLE_NEW = `# Neues Dokument

\`\`\`mermaid
sequenceDiagram
  actor U as Benutzer
  participant C as Client
  participant S as Server
  U->>C: Aktion
  activate C
  C->>S: Anfrage
  S-->>C: Antwort
  deactivate C
\`\`\`
`;

const SAMPLE_WELCOME = `# Willkommen im Mermaid Editor

Klicke im Diagramm auf ein Element – der Cursor springt zur passenden Zeile.
Setze den Cursor in eine Zeile – das Element wird im Diagramm markiert.

\`\`\`mermaid
---
title: sd Beispiel
---
sequenceDiagram
  actor U as Benutzer
  participant C as :Client
  participant S as :Server
  U-)C: Drucken / Sync
  activate C
  C->>C: Vorprüfung
  alt Daten ok
    C-)S: Übertrag prüfen
    activate S
    Note over S: Speichern
    S--)C: Code 0
    deactivate S
  else Fehler
    C-)U: Meldung
  end
  deactivate C
\`\`\`

\`\`\`mermaid
flowchart LR
  A[Start] --> B{Gültig?}
  B -->|ja| C[Speichern]
  B -->|nein| D[Fehler melden]
  D --> A
\`\`\`

Öffnen: **⌘O** · Speichern: **⌘S** · Ansicht: **Ctrl+1 / 2 / 3**
`;

(async () => {
  setView(state.view);
  setSidebar(state.sidebar);
  syncMenu();
  preview.setZoom(store.get('zoom', 1));
  applyTheme();
  connectEvents();

  let st = {};
  try { st = await api('state'); } catch { /* */ }
  state.home = st.home || '';
  const params = new URLSearchParams(location.search);
  const dir = params.get('dir');
  const isNew = params.has('new');
  const file = params.get('file') || (dir || isNew ? null : store.get('lastFile', null));
  setRoot(dir || store.get('root', null) || (file ? dirname(file) : `${state.home}/Documents`));

  if (file && (await openFile(file, { quiet: true }))) return;
  if (isNew) { newDoc(); return; }
  const draft = store.get('draft', null);
  editor.setDoc(draft || SAMPLE_WELCOME, 'markdown');
  editor.setWrap(state.wrap);
  state.saved = draft ? '' : SAMPLE_WELCOME;
  updateDirty();
  renderNow();
})();

// Befehle aus dem Mac-Menü
window.__mmeCommand = (name, arg) => {
  const c = {
    save: () => save(),
    saveas: () => save({ as: true }),
    open: () => openDialog(),
    openPath: () => openFile(arg),
    folder: () => folderDialog(),
    new: () => newDoc(),
    reveal: () => state.path && api('reveal', { method: 'POST', body: { path: state.path } }),
    'view:code': () => setView('code'),
    'view:split': () => setView('split'),
    'view:preview': () => setView('preview'),
    sidebar: () => setSidebar(!state.sidebar),
    zoomIn: () => preview.setZoom(preview.getZoom() * 1.2),
    zoomOut: () => preview.setZoom(preview.getZoom() / 1.2),
    zoomReset: () => preview.setZoom(1),
    find: () => { if (state.view === 'preview') setView('split'); editor.openSearch(); },
    discard: () => { store.set('draft', null); state.saved = editor.getText(); updateDirty(); },
  }[name];
  return c ? c() : undefined;
};

// Vor dem Schliessen: speichern (bzw. melden, dass gefragt werden muss)
window.__mmeFlush = async (saveAs) => {
  clearTimeout(autoTimer);
  if (!state.dirty) return { ok: true };
  if (!state.path && !saveAs) {
    const text = editor.getText().trim();
    if (!text || text === SAMPLE_NEW.trim() || text === SAMPLE_WELCOME.trim()) return { ok: true };
    return { ok: false, untitled: true };
  }
  await save({ as: saveAs && !state.path });
  return { ok: !state.dirty };
};

// Für Debugging in der Konsole
window.__mme = { editor, preview, state };
