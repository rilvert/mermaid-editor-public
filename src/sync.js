// Zuordnung SVG-Element ↔ Codezeile (relativ zum Mermaid-Block, 0-basiert).
//
// Mermaid liefert keine Source-Maps. Wir kombinieren deshalb
//   – die Parser-Datenbank von Mermaid (Reihenfolge/IDs der Elemente),
//   – data-id / id-Attribute im SVG und
//   – einen kleinen eigenen Zeilen-Parser (welche Zeile erzeugt welches Element).
// Was danach noch keinen Platz hat, wird über den Text zugeordnet.

// ---------------------------------------------------------------- Helfer

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function tokenRe(name, flags = 'u') {
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(name)}(?![\\p{L}\\p{N}_])`, flags);
}

export function normText(s) {
  return String(s)
    .toLowerCase()
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/#\w+;/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function textMatches(lineNorm, t) {
  if (!t) return false;
  if ((' ' + lineNorm + ' ').includes(' ' + t + ' ')) return true;
  const ct = t.replace(/ /g, '');
  return ct.length >= 4 && lineNorm.replace(/ /g, '').includes(ct);
}

function textOf(el) {
  if (el.tagName.toLowerCase() === 'foreignobject') return el.textContent;
  const leaves = [];
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) { if (c.nodeValue.trim()) leaves.push(c.nodeValue.trim()); }
      else if (c.nodeType === 1) walk(c);
    }
  };
  walk(el);
  return leaves.join(' ');
}

/** Struktur eines Mermaid-Blocks: Frontmatter, Kopfzeile, Inhaltszeilen. */
export function analyze(code) {
  const lines = code.split('\n');
  let fmEnd = -1;
  if (lines[0]?.trim() === '---') {
    for (let j = 1; j < lines.length; j++) if (lines[j].trim() === '---') { fmEnd = j; break; }
  }
  let header = -1;
  const content = [];
  for (let j = fmEnd + 1; j < lines.length; j++) {
    const t = lines[j].trim();
    if (!t || t.startsWith('%%')) continue;
    if (header < 0) { header = j; continue; }
    content.push(j);
  }
  const fm = [];
  for (let j = 1; j < fmEnd; j++) fm.push(j);
  return { lines, fmEnd, header, content, textLines: [...fm, ...content], norm: lines.map(normText) };
}

// ---------------------------------------------------------------- Map

export class SyncMap {
  constructor() {
    this.entries = [];
    this.elMap = new Map();
    this.lineMap = new Map();
    this.names = new Map(); // Knoten-/Akteurname → Eintrag (für Verweise wie "style A …")
  }

  /** hl: Liste von Element-Gruppen; jede Gruppe ergibt einen Markierungsrahmen. */
  add({ hl, click, line, lines = [], name }) {
    hl = (hl || []).map((g) => g.filter(Boolean)).filter((g) => g.length);
    if (!hl.length || line == null || line < 0) return null;
    const entry = { hl, line, lines: new Set([line, ...lines.filter((l) => l != null && l >= 0)]) };
    this.entries.push(entry);
    for (const el of click || hl.flat()) {
      if (!el) continue;
      if (!this.elMap.has(el)) this.elMap.set(el, entry);
      el.classList?.add('sync-el');
    }
    for (const l of entry.lines) {
      if (!this.lineMap.has(l)) this.lineMap.set(l, []);
      this.lineMap.get(l).push(entry);
    }
    if (name && !this.names.has(name)) this.names.set(name, entry);
    return entry;
  }

  isMapped(el, stop) {
    for (let n = el; n && n !== stop; n = n.parentNode) if (this.elMap.has(n)) return true;
    return false;
  }

  hit(target, stop) {
    for (let n = target; n && n !== stop; n = n.parentNode) {
      const e = this.elMap.get(n);
      if (e) return e;
    }
    return null;
  }

  /** Einträge für eine (relative) Zeile; ohne direkten Treffer: erwähnte Knoten. */
  forLine(rel, lineText) {
    const direct = this.lineMap.get(rel);
    if (direct?.length) return { entries: direct, ref: false };
    if (lineText && this.names.size) {
      const refs = [];
      for (const [name, entry] of this.names) {
        if (name.length && tokenRe(name).test(lineText)) refs.push(entry);
      }
      if (refs.length) return { entries: refs, ref: true };
    }
    return { entries: [], ref: false };
  }
}

// ---------------------------------------------------------------- Einstieg

export function buildSyncMap(svg, code, diag) {
  const A = analyze(code);
  const map = new SyncMap();
  const type = diag?.type || '';
  try {
    if (type === 'sequence') mapSequence(svg, A, diag.db, map);
    else if (type.startsWith('flowchart')) mapFlowchart(svg, A, diag.db, map);
    else mapGraph(svg, A, type, map);
  } catch (e) {
    console.warn('Sync-Mapping (spezifisch) fehlgeschlagen:', e);
  }
  try {
    mapTexts(svg, A, map);
  } catch (e) {
    console.warn('Sync-Mapping (Text) fehlgeschlagen:', e);
  }
  return map;
}

// ---------------------------------------------------------------- Sequenzdiagramm

const ARROW_RE = /(<<)?(\(\))?([\\/]\|)?(-{1,2})(>>|>|x|\)|\|\\|\|\/|\/\/|\\\\|\(\))?/g;

function parseSignal(t) {
  const colon = t.indexOf(':');
  const pre = colon >= 0 ? t.slice(0, colon) : t;
  ARROW_RE.lastIndex = 0;
  let m;
  while ((m = ARROW_RE.exec(pre))) {
    const hasHead = m[1] || m[2] || m[3] || m[5];
    if (!hasHead) continue;
    const from = pre.slice(0, m.index).trim();
    let rest = pre.slice(m.index + m[0].length).trim();
    let act = '';
    if (rest[0] === '+' || rest[0] === '-') { act = rest[0]; rest = rest.slice(1).trim(); }
    if (!from || !rest) return null;
    return { from, to: rest, act };
  }
  return null;
}

function mapSequence(svg, A, db, map) {
  const { lines } = A;
  const expected = [];
  const decl = new Map();
  const firstUse = new Map();
  const stack = [];
  const rects = [];
  const actStacks = new Map();
  const activations = [];
  let actOrder = 0;

  const use = (n, j) => { if (n && !firstUse.has(n)) firstUse.set(n, j); };
  const startAct = (actor, j) => {
    if (!actStacks.has(actor)) actStacks.set(actor, []);
    actStacks.get(actor).push({ line: j, order: actOrder++ });
  };
  const endAct = (actor, j) => {
    const a = actStacks.get(actor)?.pop();
    if (a) activations.push({ start: a.line, end: j, order: a.order });
  };

  for (const j of A.content) {
    const t = lines[j].trim();
    let m;
    if ((m = t.match(/^(?:create\s+)?(?:participant|actor)\s+(.+)$/i))) {
      const name = m[1].split(/\s+as\s+/i)[0].replace(/@\{.*$/, '').trim();
      if (!decl.has(name)) decl.set(name, j);
      continue;
    }
    if (/^(destroy|title|acc(Title|Descr)|links?|properties|details)\b/i.test(t)) continue;
    if (/^box\b/i.test(t)) { stack.push({ kind: 'box', line: j, sections: [] }); continue; }
    if ((m = t.match(/^(loop|alt|opt|par_over|par|critical|break|rect)\b/i))) {
      stack.push({ kind: m[1].toLowerCase(), line: j, sections: [] });
      expected.push({ cat: 'blockStart', line: j });
      continue;
    }
    if (/^(else|and|option)\b/i.test(t)) {
      stack.at(-1)?.sections.push(j);
      expected.push({ cat: 'section', line: j });
      continue;
    }
    if (/^end\s*$/i.test(t)) {
      const b = stack.pop();
      if (!b) continue;
      b.end = j;
      if (b.kind === 'box') continue;
      expected.push({ cat: 'blockEnd', line: j, block: b });
      if (b.kind === 'rect') rects.push(b);
      continue;
    }
    if ((m = t.match(/^note\s+(?:left of|right of|over)\s+([^:]+):/i))) {
      expected.push({ cat: 'note', line: j });
      m[1].split(',').forEach((n) => use(n.trim(), j));
      continue;
    }
    if ((m = t.match(/^activate\s+(.+)$/i))) {
      startAct(m[1].trim(), j);
      expected.push({ cat: 'activeStart', line: j });
      continue;
    }
    if ((m = t.match(/^deactivate\s+(.+)$/i))) {
      endAct(m[1].trim(), j);
      expected.push({ cat: 'activeEnd', line: j });
      continue;
    }
    if (/^autonumber\b/i.test(t)) { expected.push({ cat: 'autonumber', line: j }); continue; }
    const s = parseSignal(t);
    if (s) {
      expected.push({ cat: 'signal', line: j });
      use(s.from, j);
      use(s.to, j);
      if (s.act === '+') { startAct(s.to, j); expected.push({ cat: 'activeStart', line: j }); }
      if (s.act === '-') { endAct(s.from, j); expected.push({ cat: 'activeEnd', line: j }); }
    }
  }

  // Mermaid-Nachrichtenliste mit unseren Zeilen abgleichen
  const ltName = {};
  for (const [k, v] of Object.entries(db.LINETYPE || {})) ltName[v] = k;
  const catOf = (msg) => {
    const n = ltName[msg.type] || '';
    if (n === 'NOTE') return 'note';
    if (n === 'ACTIVE_START') return 'activeStart';
    if (n === 'ACTIVE_END') return 'activeEnd';
    if (n === 'AUTONUMBER') return 'autonumber';
    if (/^(ALT_ELSE|PAR_AND|CRITICAL_OPTION)$/.test(n)) return 'section';
    if (/_START$/.test(n)) return 'blockStart';
    if (/_END$/.test(n)) return 'blockEnd';
    return 'signal';
  };
  const msgs = db.getMessages();
  const byIndex = new Map();
  let p = 0;
  msgs.forEach((msg, i) => {
    const c = catOf(msg);
    let k = p;
    while (k < expected.length && k < p + 6 && expected[k].cat !== c) k++;
    if (k < expected.length && expected[k].cat === c) { byIndex.set(i, expected[k]); p = k + 1; }
  });
  const findById = (i) =>
    svg.querySelector(`[data-id="i${i}"]`) || (msgs[i]?.id != null ? svg.querySelector(`[data-id="${CSS.escape(String(msgs[i].id))}"]`) : null);

  // Nachrichten: Texte + Pfeil (+ Nummer) gruppieren
  const groups = [];
  let pending = [];
  for (const el of svg.querySelectorAll('.messageText, [class^="messageLine"], .sequenceNumber')) {
    const cls = el.getAttribute('class') || '';
    if (cls.includes('messageText')) { pending.push(el); continue; }
    if (cls.startsWith('messageLine')) { groups.push({ els: [...pending, el], id: el.getAttribute('data-id') }); pending = []; continue; }
    if (cls.includes('sequenceNumber') && groups.length) {
      const g = groups.at(-1);
      const prev = el.previousElementSibling;
      if (prev && prev.tagName === 'line' && !prev.getAttribute('class')) g.els.push(prev);
      g.els.push(el);
    }
  }
  const signalLines = expected.filter((e) => e.cat === 'signal');
  groups.forEach((g, k) => {
    const idx = g.id && /^i\d+$/.test(g.id) ? Number(g.id.slice(1)) : -1;
    const exp = byIndex.get(idx) || signalLines[k];
    if (exp) map.add({ hl: [g.els], line: exp.line });
  });

  // Notizen und Blöcke (loop/alt/…)
  for (const [i, exp] of byIndex) {
    if (exp.cat === 'note') {
      const g = findById(i);
      if (g) map.add({ hl: [[g]], line: exp.line });
    } else if (exp.cat === 'blockEnd' && exp.block.kind !== 'rect') {
      const g = findById(i);
      if (!g) continue;
      const b = exp.block;
      // Abschnitte (else/and/option) zuerst – sie sind spezifischer als der ganze Block
      const titles = [...g.querySelectorAll('.sectionTitle')];
      const seps = [...g.querySelectorAll('.loopLine')].slice(4);
      b.sections.forEach((line, k) => {
        map.add({ hl: [[titles[k], seps[k]]], line });
      });
      const head = [g.querySelector('.labelBox'), g.querySelector('.labelText'), g.querySelector('.loopText')];
      map.add({ hl: [[g]], click: [g, ...head], line: b.line, lines: [b.end] });
    }
  }

  // Hintergrund-Rechtecke (rect … end): im DOM in umgekehrter End-Reihenfolge
  const rectEls = [...svg.querySelectorAll('rect.rect')].reverse();
  if (rectEls.length === rects.length) {
    rects.forEach((b, k) => map.add({ hl: [[rectEls[k]]], line: b.line, lines: [b.end] }));
  }

  // Aktivierungsbalken: DOM-Reihenfolge = Start-Reihenfolge der beendeten Aktivierungen
  const actEls = [...svg.querySelectorAll('rect[class^="activation"]')];
  activations.sort((a, b) => a.order - b.order);
  if (actEls.length === activations.length) {
    activations.forEach((a, k) => map.add({ hl: [[actEls[k]]], line: a.start, lines: [a.end] }));
  }

  // Teilnehmer: Kopf-/Fussboxen (+ Lebenslinie klickbar)
  const actors = new Map();
  for (const el of svg.querySelectorAll('[name]')) {
    const name = el.getAttribute('name');
    if (!actors.has(name)) actors.set(name, { boxes: [], click: [] });
    const a = actors.get(name);
    const tag = el.tagName.toLowerCase();
    if (tag === 'line') { a.click.push(el); continue; }
    let box = el;
    if (tag === 'rect' && el.parentNode?.tagName.toLowerCase() === 'g' && el.parentNode.children.length <= 4) box = el.parentNode;
    a.boxes.push([box]);
    a.click.push(box);
  }
  for (const [name, a] of actors) {
    const line = decl.has(name) ? decl.get(name) : firstUse.get(name);
    if (line != null) map.add({ hl: a.boxes, click: a.click, line, name });
  }
}

// ---------------------------------------------------------------- Flowchart

function stripLabels(s) {
  return s
    .replace(/"[^"]*"/g, ' ')
    .replace(/\|[^|]*\|/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/%%.*$/, '');
}

function defLine(name, A, kw = /^(?:class|state|subgraph|entity)\s+/i) {
  const { lines, content } = A;
  const def = new RegExp(`(?<![\\p{L}\\p{N}_-])${escapeRe(name)}(?=\\s*(?:\\[|\\(|\\{|>|@\\{|:::))`, 'u');
  const tok = tokenRe(name);
  let first = -1;
  for (const j of content) {
    const raw = lines[j];
    const t = raw.trim();
    const m = t.match(kw);
    if (m && tok.test(t.slice(m[0].length).split(/[\s{[(:]/)[0])) return j;
    if (def.test(raw)) return j;
    if (first < 0 && tok.test(stripLabels(raw))) first = j;
  }
  return first;
}

const EDGE_HINT = /(--|==|-\.|\.-|~~~)/;

function mapFlowchart(svg, A, db, map) {
  const { lines, content } = A;
  const svgId = svg.id;
  const q = (sel) => { try { return svg.querySelector(sel); } catch { return null; } };

  // Knoten
  for (const [id, v] of db.getVertices()) {
    const el = q(`[id="${CSS.escape(`${svgId}-${v.domId}`)}"]`) || q(`[id$="-${CSS.escape(v.domId)}"]`);
    if (!el) continue;
    const line = defLine(id, A);
    map.add({ hl: [[el]], line, name: id });
  }

  // Kanten: in Quellreihenfolge den Zeilen zuordnen
  const edges = db.getEdges();
  let ptr = 0;
  const stripped = new Map(content.map((j) => [j, stripLabels(lines[j])]));
  const hasEdge = (j, e) => {
    const s = stripped.get(j);
    return EDGE_HINT.test(lines[j]) && tokenRe(e.start).test(s) && tokenRe(e.end).test(s);
  };
  for (const e of edges) {
    let line = -1;
    for (let k = ptr; k < content.length; k++) if (hasEdge(content[k], e)) { line = content[k]; ptr = k; break; }
    if (line < 0) for (const j of content) if (hasEdge(j, e)) { line = j; break; }
    if (line < 0) continue;
    const path = q(`path[data-id="${CSS.escape(e.id)}"]`);
    const label = q(`.edgeLabel [data-id="${CSS.escape(e.id)}"]`)?.closest('.edgeLabel');
    const hasLabel = label && textOf(label).trim();
    map.add({ hl: [[path, hasLabel ? label : null]], line });
  }

  // Subgraphs
  for (const sg of db.getSubGraphs?.() || []) {
    const el = q(`[id="${CSS.escape(`${svgId}-${sg.id}`)}"]`) || q(`.cluster[data-id="${CSS.escape(sg.id)}"]`);
    if (!el) continue;
    let line = content.find((j) => new RegExp(`^\\s*subgraph\\s+${escapeRe(sg.id)}(?![\\p{L}\\p{N}_])`, 'u').test(lines[j]));
    if (line == null && sg.title) {
      const t = normText(sg.title);
      line = content.find((j) => /^\s*subgraph\b/.test(lines[j]) && textMatches(A.norm[j], t));
    }
    if (line != null) map.add({ hl: [[el]], line, name: sg.id });
  }
}

// ---------------------------------------------------------------- Klassen/Zustände/ER/…

const EDGE_LINE = {
  class: /(<\|--|--\|>|\*--|--\*|o--|--o|<--|-->|\.\.>|<\.\.|\.\.\|>|<\|\.\.|\s--\s|\s\.\.\s)/,
  classDiagram: /(<\|--|--\|>|\*--|--\*|o--|--o|<--|-->|\.\.>|<\.\.|\.\.\|>|<\|\.\.|\s--\s|\s\.\.\s)/,
  stateDiagram: /-->/,
  state: /-->/,
  er: /([|}o][|o]|[|o][|{o])(--|\.\.)([|o][|{o]|[|}o][|o])|\bto\b/,
  requirement: /-\s*\w+\s*->|<-\s*\w+\s*-/,
};

function mapGraph(svg, A, type, map) {
  const { lines, content } = A;
  const svgId = svg.id;
  const strip = (id) => (id && id.startsWith(svgId + '-') ? id.slice(svgId.length + 1) : id || '');
  const isState = type.startsWith('state');

  const nameOf = (el) => {
    const d = el.getAttribute('data-id');
    if (d && !el.hasAttribute('data-edge')) return d;
    const m = strip(el.id).match(/^[A-Za-z]+-(.+)-\d+$/);
    return m ? m[1] : null;
  };

  const lineFor = (name) => {
    if (isState && /(^|_)start$/.test(name)) return content.find((j) => /^\s*\[\*\]\s*-->/.test(lines[j])) ?? -1;
    if (isState && /(^|_)end$/.test(name)) return content.find((j) => /-->\s*\[\*\]/.test(lines[j])) ?? -1;
    return defLine(name, A);
  };

  // Cluster (Composite States, Subgraphs)
  for (const el of svg.querySelectorAll('g.cluster, g.statediagram-cluster')) {
    const name = nameOf(el);
    if (!name) continue;
    const line = lineFor(name);
    if (line >= 0) map.add({ hl: [[el]], line, name });
  }

  // Knoten
  for (const el of svg.querySelectorAll('g.node')) {
    if (map.isMapped(el, svg)) continue;
    const name = nameOf(el);
    if (!name) continue;
    const line = lineFor(name);
    if (line >= 0) map.add({ hl: [[el]], line, name });
  }

  // Klassen-Member einzeln anklickbar
  for (const t of svg.querySelectorAll('.members-group text, .methods-group text, .members-group foreignObject, .methods-group foreignObject')) {
    const n = normText(textOf(t));
    if (!n) continue;
    const line = content.find((j) => textMatches(A.norm[j], n));
    if (line != null) map.add({ hl: [[t]], line });
  }

  // Kanten über Reihenfolge, wenn die Anzahl passt
  const re = EDGE_LINE[type];
  if (!re) return;
  let depth = 0;
  const edgeLines = [];
  for (const j of content) {
    const t = lines[j];
    const open = (t.match(/\{/g) || []).length;
    const close = (t.match(/\}/g) || []).length;
    const inBody = depth > 0 && !(type === 'er' || isState);
    if (!inBody && !/^\s*(note|classDef|style|click|link|callback|cssClass)\b/i.test(t) && re.test(t)) edgeLines.push(j);
    if (type !== 'er' && !isState) depth += open - close;
  }
  const paths = [...svg.querySelectorAll('path[data-edge="true"]')];
  if (!paths.length || paths.length !== edgeLines.length) return;
  paths.forEach((path, k) => {
    const id = path.getAttribute('data-id');
    let label = null;
    try { label = id ? svg.querySelector(`.edgeLabel [data-id="${CSS.escape(id)}"]`)?.closest('.edgeLabel') : null; } catch { /* */ }
    const hasLabel = label && textOf(label).trim();
    map.add({ hl: [[path, hasLabel ? label : null]], line: edgeLines[k] });
  });
}

// ---------------------------------------------------------------- Text-Fallback

function mapTexts(svg, A, map) {
  const groups = new Map();
  for (const el of svg.querySelectorAll('text, foreignObject')) {
    if (el.closest('.tick, .mm-ignore')) continue;
    if (el.tagName.toLowerCase() === 'text' && el.closest('foreignObject')) continue;
    if (map.isMapped(el, svg)) continue;
    const t = normText(textOf(el));
    if (!t) continue;
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t).push(el);
  }
  for (const [t, els] of groups) {
    const ls = A.textLines.filter((j) => textMatches(A.norm[j], t));
    if (!ls.length) continue;
    els.forEach((el, i) => {
      const node = el.closest('g.node');
      const target = node && !map.isMapped(node, svg) ? node : el;
      // Gantt: Balken "#a1" gehört zum Text "#a1-text"
      let partner = null;
      if (el.id && el.id.endsWith('-text')) {
        try { partner = svg.querySelector('#' + CSS.escape(el.id.slice(0, -5))); } catch { /* */ }
      }
      map.add({ hl: [[target, partner]], line: ls[Math.min(i, ls.length - 1)] });
    });
  }
}

/** Zeile eines Mermaid-Fehlers (relativ zum Block) oder -1. */
export function errorLine(code, err) {
  const A = analyze(code);
  const offset = A.fmEnd >= 0 ? A.fmEnd + 1 : 0;
  const h = err?.hash?.loc?.first_line;
  if (h) return offset + h - 1;
  const m = String(err?.message || err).match(/line (\d+)/i);
  return m ? offset + Number(m[1]) - 1 : -1;
}
