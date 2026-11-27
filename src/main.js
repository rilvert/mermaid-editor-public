// Mermaid Editor – App
import { createEditor } from './editor.js';
import { createPreview } from './preview.js';
import { createPdfExport } from './pdf.js';
import { errorText, normalizeLocale, setLocale, t, translate } from './i18n.js';
import { samples } from './samples.js';

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
  u.searchParams.set('lang', state.locale);
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
  locale: normalizeLocale(window.__mmeInitialLocale ?? store.get('locale')),
  sample: null,
  files: [],
};

setLocale(state.locale);

// ---------------------------------------------------------------- Toast/Status
let toastTimer;
let toastMessage;
function toast(key, params) {
  toastMessage = [key, params];
  const el = $('#toast');
  el.textContent = t(key, params);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    toastMessage = null;
  }, 2600);
}

function setStatus(text, cls = '') {
  const s = $('#save-status');
  s.textContent = text;
  s.className = cls;
}

function updateTitle() {
  const name = state.path ? basename(state.path) : t('untitled');
  $('#file-name').textContent = name;
  $('#file-name').title = state.path || t('unsaved');
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
  if (state.conflict) setStatus(t('conflict'), 'warn');
  else if (state.saving) setStatus(t('saving'));
  else if (state.dirty) setStatus(t(state.path && state.autosave ? 'changes' : 'unsaved'), 'muted');
  else setStatus(state.path ? t('saved') : '', 'ok');
  updateTitle();
}

// ---------------------------------------------------------------- Editor + Vorschau
let previewTimer;
let syncTimer;
let autoTimer;

const editor = createEditor($('#editor'), {
  locale: state.locale,
  onChange() {
    state.sample = null;
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
    if (r.saved) toast('exported', { name: basename(r.path) });
  } : null,
  copyImage: NATIVE ? async (blob) => {
    await api('copyImage', { method: 'POST', body: { data: await toBase64(await blob) } });
    toast('copied');
  } : null,
  baseName: () => (state.path ? basename(state.path).replace(/\.[^.]+$/, '') : t('diagramFile').toLowerCase()),
  assetUrl: (src) => {
    const dir = state.path ? dirname(state.path) : state.root || state.home;
    const abs = src.startsWith('/') ? src : `${dir}/${decodeURI(src)}`;
    return `/api/asset?token=${TOKEN}&path=${encodeURIComponent(abs)}`;
  },
});

const openPdfExport = createPdfExport({
  preview,
  getText: () => editor.getText(),
  getName: () => (state.path ? basename(state.path).replace(/\.[^.]+$/, '') : '') || t('untitled'),
  savePdf: NATIVE ? async (name, markup) => {
    const result = await api('export/pdf', { method: 'POST', body: { name: name + '.pdf', markup } });
    if (result.saved) toast('exported', { name: basename(result.path) });
  } : null,
  toast,
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
  document.querySelectorAll('#view-switch button').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === v);
    b.setAttribute('aria-pressed', String(b.dataset.view === v));
  });
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
  $('#btn-sidebar').setAttribute('aria-expanded', String(on));
  if (on) loadFiles();
}

const darkMq = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const dark = state.theme === 'dark' || (state.theme === 'auto' && darkMq.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  editor.setDark(dark);
  preview.setDark(dark);
  renderNow();
  document.querySelectorAll('[data-theme-opt]').forEach((b) => {
    const active = b.dataset.themeOpt === state.theme;
    b.classList.toggle('checked', active);
    b.setAttribute('aria-pressed', String(active));
  });
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
    toast('reloaded');
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

function confirmDiscard() {
  const dialog = $('#discard-dialog');
  if (typeof dialog.showModal !== 'function') return Promise.resolve(confirm(t('discard')));
  if (dialog.open) return Promise.resolve(false);
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'discard'), { once: true });
  });
}

async function openFile(path, { quiet = false } = {}) {
  if (state.dirty && state.path && !state.conflict) await save();
  else if (state.dirty && !state.path && editor.getText().trim() && !(await confirmDiscard())) return false;
  let r;
  try {
    r = await api('file', { query: { path } });
  } catch (e) {
    if (!quiet) toast('openFailed', { reason: () => errorText(e) });
    return false;
  }
  state.sample = null;
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
  if (r.isNew) toast('newFile');
  return true;
}

function newDoc() {
  if (state.dirty && state.path) save();
  state.path = null;
  state.mtime = 0;
  state.saved = '';
  state.kind = 'markdown';
  state.sample = 'newDoc';
  preview.setKind('markdown');
  editor.setDoc(samples[state.locale].newDoc, 'markdown');
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
    const name = state.path ? basename(state.path) : t('diagramFile') + '.md';
    dialogOpen = true;
    const r = await api('dialog/save', { method: 'POST', body: { dir: state.path ? dirname(state.path) : state.root || state.home, name } })
      .catch((e) => { toast('saveFailed', { reason: () => errorText(e) }); return {}; })
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
    state.sample = null;
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
    else toast('saveFailed', { reason: () => errorText(e) });
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
  } catch (e) { toast('openFailed', { reason: () => errorText(e) }); } finally { dialogOpen = false; }
}

async function folderDialog() {
  if (dialogOpen) return;
  dialogOpen = true;
  try {
    const r = await api('dialog/folder', { method: 'POST', body: { dir: state.root } });
    if (r.path) { setRoot(r.path); setSidebar(true); }
  } catch (e) { toast('openFailed', { reason: () => errorText(e) }); } finally { dialogOpen = false; }
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
  if (!files.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = t('noFiles');
    list.appendChild(empty);
  }
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
const menuButton = $('#btn-menu');
function showMenu(open) {
  menu.hidden = !open;
  if (open) menu.scrollTop = 0;
  menuButton.setAttribute('aria-expanded', String(open));
}
menuButton.onclick = (e) => {
  e.stopPropagation();
  showMenu(menu.hidden);
};
document.addEventListener('click', (e) => { if (!menu.contains(e.target)) showMenu(false); });
menu.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    showMenu(false);
    menuButton.focus();
  }
});
menu.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const act = b.dataset.act;
  if (b.dataset.themeOpt) { state.theme = b.dataset.themeOpt; store.set('theme', state.theme); applyTheme(); return; }
  if (b.dataset.locale) { changeLocale(b.dataset.locale, { notifyNative: true }); return; }
  showMenu(false);
  if (act === 'new') newDoc();
  if (act === 'open') openDialog();
  if (act === 'folder') folderDialog();
  if (act === 'saveas') save({ as: true });
  if (act === 'pdf') openPdfExport();
  if (act === 'reveal') revealFile();
  if (act === 'autosave') { state.autosave = !state.autosave; store.set('autosave', state.autosave); syncMenu(); updateDirty(); if (state.autosave && state.dirty && state.path) save(); }
  if (act === 'wrap') { state.wrap = !state.wrap; store.set('wrap', state.wrap); editor.setWrap(state.wrap); syncMenu(); }
});
function revealFile() {
  if (state.path) api('reveal', { method: 'POST', body: { path: state.path } }).catch((e) => {
    toast('openFailed', { reason: () => errorText(e) });
  });
}

function syncMenu() {
  menu.querySelector('[data-act="autosave"]').classList.toggle('checked', state.autosave);
  menu.querySelector('[data-act="wrap"]').classList.toggle('checked', state.wrap);
  for (const b of menu.querySelectorAll('[data-locale]')) {
    b.classList.toggle('checked', b.dataset.locale === state.locale);
  }
  for (const b of menu.querySelectorAll('.check')) {
    b.setAttribute('aria-pressed', String(b.classList.contains('checked')));
  }
}

function changeLocale(value, { notifyNative = false } = {}) {
  const locale = normalizeLocale(value);
  if (state.locale === locale) return;
  state.locale = locale;
  setLocale(locale);
  if (!NATIVE) store.set('locale', locale);
  else if (notifyNative) api('locale', { method: 'POST', body: { locale } }).catch(() => {});
  translate(document);
  const text = samples[locale][state.sample];
  editor.setLocale(locale, text);
  preview.setLocale();
  if (state.sample) {
    if (state.sample === 'welcome') state.saved = text;
    renderNow();
  }
  if (state.sidebar) renderFiles();
  syncMenu();
  updateDirty();
  if (toastMessage) $('#toast').textContent = t(...toastMessage);
}

// Tastenkürzel ausserhalb des Editors
document.addEventListener('keydown', (e) => {
  if ($('#discard-dialog').open || $('#pdf-dialog').open) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save({ as: e.shiftKey }); }
  else if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); openDialog(); }
  else if (e.ctrlKey && !e.metaKey && ['1', '2', '3'].includes(e.key)) {
    e.preventDefault();
    setView({ 1: 'code', 2: 'split', 3: 'preview' }[e.key]);
  }
});

window.addEventListener('beforeunload', (e) => {
  if (state.dirty && !state.sample && (state.path || editor.getText().trim())) {
    if (state.path && state.autosave) save();
    e.preventDefault();
    e.returnValue = '';
  }
});

// ---------------------------------------------------------------- Start
(async () => {
  translate(document);
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
  const dir = params.get('dir') || st.dir;
  const isNew = params.has('new');
  const file = params.get('file') || (isNew ? null : st.file || (dir ? null : store.get('lastFile', null)));
  setRoot(dir || store.get('root', null) || (file ? dirname(file) : `${state.home}/Documents`));

  if (file && (await openFile(file, { quiet: true }))) return;
  if (isNew) { newDoc(); return; }
  const draft = store.get('draft', null);
  const text = draft || samples[state.locale].welcome;
  state.sample = draft ? null : 'welcome';
  editor.setDoc(text, 'markdown');
  editor.setWrap(state.wrap);
  state.saved = draft ? '' : text;
  updateDirty();
  renderNow();
})();

// Befehle aus dem Mac-Menü
window.__mmeCommand = (name, arg) => {
  const c = {
    save: () => save(),
    saveas: () => save({ as: true }),
    pdf: openPdfExport,
    open: () => openDialog(),
    openPath: () => openFile(arg),
    folder: () => folderDialog(),
    new: () => newDoc(),
    reveal: revealFile,
    locale: () => changeLocale(arg),
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
    if (!editor.getText().trim() || state.sample) return { ok: true };
    return { ok: false, untitled: true };
  }
  await save({ as: saveAs && !state.path });
  return { ok: !state.dirty };
};

// Für Debugging in der Konsole
window.__mme = { editor, preview, state };
