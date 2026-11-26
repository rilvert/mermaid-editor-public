// CodeMirror-Setup: Markdown mit eingebettetem Mermaid, Markierungen für den Sync.
import { basicSetup } from 'codemirror';
import { EditorView, Decoration, keymap } from '@codemirror/view';
import { EditorState, StateField, StateEffect, Compartment } from '@codemirror/state';
import { StreamLanguage, LanguageSupport, LanguageDescription, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { indentWithTab } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { tags as t } from '@lezer/highlight';

// ---------------------------------------------------------------- Mermaid-Syntax

const HEADER = /^(sequenceDiagram|flowchart|graph|classDiagram(-v2)?|stateDiagram(-v2)?|erDiagram|gantt|pie|journey|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|C4\w+|sankey(-beta)?|xychart(-beta)?|block(-beta)?|packet(-beta)?|kanban|architecture(-beta)?|radar(-beta)?|treemap(-beta)?|zenuml|info)\b/;
const KEYWORDS = /^(participant|actor|as|note|over|left of|right of|loop|alt|else|opt|par_over|par|and|critical|option|break|end|rect|box|activate|deactivate|autonumber|create|destroy|title|subgraph|direction|classDef|class|style|linkStyle|click|state|section|dateFormat|axisFormat|excludes|todayMarker|accTitle|accDescr|TB|TD|BT|RL|LR)\b/i;

const mermaidStream = StreamLanguage.define({
  name: 'mermaid',
  startState: () => ({ front: 0, afterColon: false }),
  token(stream, state) {
    if (stream.sol()) {
      state.afterColon = false;
      if (state.front < 2 && stream.match(/^\s*---\s*$/)) { state.front++; return 'meta'; }
      if (state.front === 0) state.front = 2;
    }
    if (state.front === 1) { stream.skipToEnd(); return 'meta'; }
    if (state.afterColon) { stream.skipToEnd(); return 'string'; }
    if (stream.eatSpace()) return null;
    if (stream.match(/^%%.*/)) return 'comment';
    if (stream.match(HEADER)) return 'heading';
    if (stream.match(/^"[^"]*"?/)) return 'string';
    if (stream.match(/^(<<)?(-{1,2}(>>|>|x|\)|\|[\\/]|[\\/]{2})|[ox<]?(--+|==+|-\.+-?|~~~)[>ox]?|[|}o]{1,2}(--|\.\.)[|{o]{1,2}|<\|--|--\|>|\*--|o--|\.\.>|\.\.\|>)/)) {
      stream.match(/^[+-](?=\s*\w)/);
      return 'operator';
    }
    if (stream.peek() === ':' ) {
      stream.next();
      state.afterColon = true;
      return 'punctuation';
    }
    if (stream.match(/^\|[^|]*\|/)) return 'string';
    const ch = stream.peek();
    if (ch === '[' || ch === '(' || ch === '{' || ch === '>') {
      const close = { '[': ']', '(': ')', '{': '}', '>': ']' }[ch];
      stream.next();
      let depth = 1;
      while (!stream.eol()) {
        const c = stream.next();
        if (c === ch && ch !== '>') depth++;
        else if (c === close && --depth === 0) break;
      }
      return 'string';
    }
    if (stream.match(KEYWORDS)) return 'keyword';
    if (stream.match(/^\d+(\.\d+)?(px|%|d|h|w|m|s)?\b/)) return 'number';
    if (stream.match(/^[\p{L}\p{N}_.-]+/u)) return 'variableName';
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: '%%' } },
});

const mermaidSupport = new LanguageSupport(mermaidStream);
const mermaidDesc = LanguageDescription.of({ name: 'mermaid', alias: ['mmd'], support: mermaidSupport });

const lightHighlight = HighlightStyle.define([
  { tag: t.heading, color: '#7b30d0', fontWeight: '600' },
  { tag: [t.keyword], color: '#0b62c4', fontWeight: '500' },
  { tag: t.operator, color: '#d14b00' },
  { tag: t.string, color: '#0a7a3a' },
  { tag: t.comment, color: '#8a8f98', fontStyle: 'italic' },
  { tag: t.meta, color: '#8a6d00' },
  { tag: t.number, color: '#b0257a' },
  { tag: t.variableName, color: '#1f2328' },
  { tag: t.punctuation, color: '#6e7781' },
  { tag: t.link, color: '#0b62c4', textDecoration: 'underline' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.monospace, color: '#7b30d0' },
  { tag: t.processingInstruction, color: '#8a8f98' },
]);

const darkHighlight = HighlightStyle.define([
  { tag: t.heading, color: '#c792ea', fontWeight: '600' },
  { tag: [t.keyword], color: '#61afef', fontWeight: '500' },
  { tag: t.operator, color: '#e5a15b' },
  { tag: t.string, color: '#98c379' },
  { tag: t.comment, color: '#7f848e', fontStyle: 'italic' },
  { tag: t.meta, color: '#d19a66' },
  { tag: t.number, color: '#d19a66' },
  { tag: t.variableName, color: '#e0e4ea' },
  { tag: t.punctuation, color: '#9aa4b2' },
  { tag: t.link, color: '#61afef', textDecoration: 'underline' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.monospace, color: '#c792ea' },
  { tag: t.processingInstruction, color: '#7f848e' },
]);

// ---------------------------------------------------------------- Markierungen

const setFlash = StateEffect.define();
const setHover = StateEffect.define();
const setErrors = StateEffect.define();

function lineDeco(state, lines, cls) {
  const decos = [];
  for (const l of [...new Set(lines)].sort((a, b) => a - b)) {
    if (l < 0 || l >= state.doc.lines) continue;
    decos.push(Decoration.line({ class: cls }).range(state.doc.line(l + 1).from));
  }
  return Decoration.set(decos);
}

function decoField(effect, cls) {
  return StateField.define({
    create: () => Decoration.none,
    update(value, tr) {
      value = value.map(tr.changes);
      for (const e of tr.effects) if (e.is(effect)) value = lineDeco(tr.state, e.value, cls);
      return value;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}

const flashField = decoField(setFlash, 'cm-sync-flash');
const hoverField = decoField(setHover, 'cm-sync-hover');
const errorField = decoField(setErrors, 'cm-error-line');

const baseTheme = EditorView.theme({
  '&': { height: '100%', fontSize: 'var(--editor-font-size, 13.5px)' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.55' },
  '.cm-content': { padding: '10px 0 40vh' },
  '.cm-gutters': { border: 'none' },
  '.cm-sync-flash': { animation: 'cm-flash 1.6s ease-out' },
  '.cm-sync-hover': { backgroundColor: 'var(--hl-soft)' },
  '.cm-error-line': { backgroundColor: 'var(--err-soft)', boxShadow: 'inset 3px 0 0 var(--err)' },
});

// ---------------------------------------------------------------- API

export function createEditor(parent, { onChange, onSelection }) {
  const themeC = new Compartment();
  const langC = new Compartment();
  const wrapC = new Compartment();

  const lang = (kind) => (kind === 'mermaid' ? mermaidSupport : markdown({ codeLanguages: [mermaidDesc] }));
  const theme = (dark) => (dark ? [oneDark, syntaxHighlighting(darkHighlight)] : [syntaxHighlighting(lightHighlight)]);

  let dark = false;
  let kind = 'markdown';
  let wrap = true;

  const extensions = () => [
    basicSetup,
    keymap.of([indentWithTab]),
    langC.of(lang(kind)),
    themeC.of(theme(dark)),
    wrapC.of(wrap ? EditorView.lineWrapping : []),
    flashField,
    hoverField,
    errorField,
    baseTheme,
    EditorState.tabSize.of(2),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) onChange?.(u);
      if (u.selectionSet || u.docChanged) onSelection?.(u);
    }),
  ];

  const view = new EditorView({ parent, state: EditorState.create({ doc: '', extensions: extensions() }) });

  let flashTimer = null;

  return {
    view,
    getText: () => view.state.doc.toString(),
    /** Neuer Inhalt (z. B. Datei geöffnet) – Verlauf zurücksetzen. */
    setDoc(text, k = kind) {
      kind = k;
      view.setState(EditorState.create({ doc: text, extensions: extensions() }));
    },
    /** Externe Änderung übernehmen, Cursor möglichst erhalten. */
    replaceDoc(text) {
      const old = view.state.doc.toString();
      if (old === text) return;
      let a = 0;
      while (a < old.length && a < text.length && old[a] === text[a]) a++;
      let b = 0;
      while (b < old.length - a && b < text.length - a && old[old.length - 1 - b] === text[text.length - 1 - b]) b++;
      view.dispatch({ changes: { from: a, to: old.length - b, insert: text.slice(a, text.length - b) } });
    },
    setDark(d) { dark = d; view.dispatch({ effects: themeC.reconfigure(theme(d)) }); },
    setWrap(w) { wrap = w; view.dispatch({ effects: wrapC.reconfigure(w ? EditorView.lineWrapping : []) }); },
    /** Zu Zeile (0-basiert) springen und kurz aufleuchten lassen. */
    jumpTo(line, { focus = true } = {}) {
      const doc = view.state.doc;
      const l = doc.line(Math.max(1, Math.min(doc.lines, line + 1)));
      const indent = l.text.match(/^\s*/)[0].length;
      view.dispatch({
        selection: { anchor: l.from + indent },
        effects: [EditorView.scrollIntoView(l.from, { y: 'center' }), setFlash.of([line])],
      });
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => view.dispatch({ effects: setFlash.of([]) }), 1700);
      if (focus) view.focus();
    },
    setHoverLines(lines) { view.dispatch({ effects: setHover.of(lines) }); },
    setErrorLines(lines) { view.dispatch({ effects: setErrors.of(lines) }); },
    /** Zeilen der aktuellen Auswahl (0-basiert). */
    selectedLines() {
      const { state } = view;
      const r = state.selection.main;
      const a = state.doc.lineAt(r.from).number - 1;
      let b = state.doc.lineAt(r.to).number - 1;
      if (r.to > r.from && state.doc.lineAt(r.to).from === r.to && b > a) b--; // Auswahl endet am Zeilenanfang
      const out = [];
      for (let l = a; l <= Math.min(b, a + 300); l++) out.push(l);
      return out;
    },
    lineText: (line) => (line >= 0 && line < view.state.doc.lines ? view.state.doc.line(line + 1).text : ''),
    focus: () => view.focus(),
    openSearch: () => { view.focus(); openSearchPanel(view); },
  };
}
