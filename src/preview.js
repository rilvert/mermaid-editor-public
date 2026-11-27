// Vorschau: Markdown + Mermaid rendern, Elemente markieren, Klicks zurückmelden.
import mermaid from 'mermaid';
import MarkdownIt from 'markdown-it';
import { buildSyncMap, errorLine } from './sync.js';
import { errorText, t, translate } from './i18n.js';

const FONT = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif';

function mermaidConfig(dark) {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: dark ? 'dark' : 'default',
    fontFamily: FONT,
    htmlLabels: false,
    flowchart: { htmlLabels: false },
  };
}

// Mermaid-Aufrufe strikt nacheinander
let chain = Promise.resolve();
function enqueue(fn) {
  const p = chain.then(fn);
  chain = p.catch(() => {});
  return p;
}

let seq = 0;
async function renderSvg(code, withSync = true) {
  const id = 'mmd-' + ++seq;
  try {
    const { svg } = await mermaid.render(id, code);
    let diag = null;
    if (withSync) {
      try { diag = await mermaid.mermaidAPI.getDiagramFromText(code); } catch { /* nur für Sync */ }
    }
    return { ok: true, svg, diag };
  } catch (error) {
    document.getElementById('d' + id)?.remove();
    document.getElementById(id)?.remove();
    // A failed text measurement can leave a temporary SVG in the page layout.
    document.querySelectorAll('body > svg:not([id])').forEach((svg) => svg.remove());
    return { ok: false, error };
  }
}

function union(rects) {
  let r = null;
  for (const b of rects) {
    if (!b || (!b.width && !b.height)) continue;
    if (!r) r = { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
    else {
      r.left = Math.min(r.left, b.left); r.top = Math.min(r.top, b.top);
      r.right = Math.max(r.right, b.right); r.bottom = Math.max(r.bottom, b.bottom);
    }
  }
  return r;
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function createPreview(scrollEl, contentEl, opts) {
  const { onJump, onHover, onErrors, lineText, toast, assetUrl } = opts;

  let dark = false;
  let kind = 'markdown';
  let zoom = 1;
  let version = 0;
  let blocks = [];
  let lastSel = [];
  const cache = new Map(); // key → Wrapper (gerendert)
  const inflight = new Map(); // key → Promise<Wrapper>

  mermaid.initialize(mermaidConfig(dark));

  // ------------------------------------------------------------ Markdown
  const md = new MarkdownIt({ html: false, linkify: true, breaks: false });
  md.core.ruler.push('source_lines', (state) => {
    for (const tok of state.tokens) {
      if (tok.map && tok.nesting >= 0 && tok.type !== 'inline' && tok.type !== 'fence') {
        if (tok.nesting === 1 || tok.nesting === 0) {
          tok.attrSet('data-line', String(tok.map[0]));
          tok.attrSet('data-end', String(tok.map[1]));
        }
      }
    }
  });
  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, slf) => {
    const tok = tokens[idx];
    const info = tok.info.trim().split(/\s+/)[0].toLowerCase();
    if (info === 'mermaid' || info === 'mmd') {
      const i = env.blocks.length;
      env.blocks.push({ code: tok.content.replace(/\n$/, ''), fence: tok.map[0], codeStart: tok.map[0] + 1, end: tok.map[1] });
      return `<div class="mm-slot" data-idx="${i}" data-line="${tok.map[0]}"></div>\n`;
    }
    tok.attrSet('data-line', String(tok.map[0]));
    tok.attrSet('data-end', String(tok.map[1]));
    const html = defaultFence(tokens, idx, options, env, slf);
    return html.replace('<pre>', `<pre data-line="${tok.map[0]}" data-end="${tok.map[1]}">`);
  };
  const defaultLinkOpen = md.renderer.rules.link_open || ((t, i, o, e, s) => s.renderToken(t, i, o));
  md.renderer.rules.link_open = (tokens, idx, options, env, slf) => {
    tokens[idx].attrSet('target', '_blank');
    tokens[idx].attrSet('rel', 'noopener noreferrer');
    return defaultLinkOpen(tokens, idx, options, env, slf);
  };
  const defaultImage = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, idx, options, env, slf) => {
    const src = tokens[idx].attrGet('src');
    if (src && !/^([a-z]+:|\/\/|#)/i.test(src)) tokens[idx].attrSet('src', assetUrl(src));
    return defaultImage(tokens, idx, options, env, slf);
  };

  function renderDocument(text, documentKind) {
    const env = { blocks: [] };
    const content = document.createElement('div');
    if (documentKind === 'mermaid') {
      env.blocks.push({ code: text, fence: -1, codeStart: 0, end: text.split('\n').length });
      content.innerHTML = '<div class="mm-slot" data-idx="0" data-line="0"></div>';
    } else {
      content.innerHTML = md.render(text, env);
    }
    return { content, diagrams: env.blocks };
  }

  // ------------------------------------------------------------ Wrapper
  function makeWrapper() {
    const w = document.createElement('div');
    w.className = 'mm-block';
    w.innerHTML =
      '<div class="mm-tools">' +
      '<button data-act="svg" data-i18n-title="saveSvg">SVG</button>' +
      '<button data-act="png" data-i18n-title="savePng">PNG</button>' +
      '<button data-act="copy" data-i18n-title="copyImage" data-i18n="copy"></button>' +
      '</div><div class="mm-scroll"><div class="mm-overlay"></div></div>';
    translate(w);
    return w;
  }

  function prepSvg(svg) {
    const natural = parseFloat(svg.style.maxWidth) || svg.viewBox?.baseVal?.width || svg.getBoundingClientRect().width;
    svg.dataset.natural = String(natural);
    svg.removeAttribute('height');
    applyZoomTo(svg);
  }

  // Zoom ist relativ zur eingepassten Grösse (100 % = passt in die Breite, max. Originalgrösse)
  let avail = 0;
  function measureAvail() {
    const cs = getComputedStyle(contentEl);
    const w = contentEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (w > 50) avail = w;
    return avail;
  }

  function applyZoomTo(svg) {
    const n = parseFloat(svg.dataset.natural);
    if (!n) return;
    const base = avail ? Math.min(n, avail) : n;
    svg.style.width = base * zoom + 'px';
    svg.style.maxWidth = avail ? 'none' : '100%';
    svg.style.height = 'auto';
  }

  function applyZoomAll() {
    contentEl.querySelectorAll('.mm-scroll > svg').forEach(applyZoomTo);
    for (const w of cache.values()) { const s = w.querySelector('.mm-scroll > svg'); if (s && !s.isConnected) applyZoomTo(s); }
  }

  function buildWrapper(code, res, prevSvg) {
    const w = makeWrapper();
    const scroll = w.querySelector('.mm-scroll');
    w._code = code;
    if (res.ok) {
      scroll.insertAdjacentHTML('afterbegin', res.svg);
      const svg = scroll.querySelector('svg');
      prepSvg(svg);
      w._sync = buildSyncMap(svg, code, res.diag);
      w._title = res.diag?.db?.getDiagramTitle?.() || '';
    } else {
      w.classList.add('mm-has-error');
      if (prevSvg) {
        const clone = prevSvg.cloneNode(true);
        clone.classList.add('mm-stale');
        clone.querySelectorAll('.sync-el').forEach((el) => el.classList.remove('sync-el'));
        scroll.prepend(clone);
      }
      const rel = errorLine(code, res.error);
      w._errLine = rel;
      const err = document.createElement('div');
      err.className = 'mm-error';
      err.innerHTML = `<div class="mm-error-head"><span data-i18n="mermaidError"></span>${rel >= 0 ? ` <button class="mm-errline" data-rel="${rel}"></button>` : ''}</div><pre></pre>`;
      w._renderError = res.error;
      w.appendChild(err);
      translate(err);
      updateErrorDetails(w);
    }
    return w;
  }

  function updateErrorDetails(w) {
    if (!w.classList.contains('mm-has-error')) return;
    const error = w._renderError;
    const message = String(error?.message || error);
    const hash = error?.hash;
    const unknown = error?.name === 'UnknownDiagramError' || message.startsWith('No diagram type detected');
    const syntax = hash || w._errLine >= 0;
    const details = [t(unknown ? 'unknownDiagram' : syntax ? 'syntaxError' : 'renderFailed')];
    const source = w._code.split('\n')[w._errLine];
    if (source) details.push(source);
    if (hash?.expected?.length) details.push(t('expectedToken', { tokens: hash.expected.join(', ') }));
    if (hash?.token) details.push(t('foundToken', { token: hash.token }));
    w.querySelector('.mm-error pre').textContent = details.join('\n');
  }

  function getOrRender(key, code, prevSvg) {
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    if (inflight.has(key)) return inflight.get(key);
    const p = enqueue(() => renderSvg(code)).then((res) => {
      const w = buildWrapper(code, res, prevSvg);
      cache.set(key, w);
      inflight.delete(key);
      return w;
    });
    inflight.set(key, p);
    return p;
  }

  // ------------------------------------------------------------ Update
  async function update(text) {
    const v = ++version;
    const { content: frag, diagrams } = renderDocument(text, kind);

    const dup = new Map();
    const jobs = [];
    const next = diagrams.map((b, i) => {
      const n = dup.get(b.code) || 0;
      dup.set(b.code, n + 1);
      const key = `${dark ? 'd' : 'l'}|${n}|${b.code}`;
      let w = cache.get(key);
      if (!w) {
        w = makeWrapper();
        w.classList.add('mm-pending');
        const prevSvg = blocks[i]?.wrapper?.querySelector('.mm-scroll > svg');
        if (prevSvg) {
          const clone = prevSvg.cloneNode(true);
          clone.querySelectorAll('.sync-el').forEach((el) => el.classList.remove('sync-el'));
          w.querySelector('.mm-scroll').prepend(clone);
        } else {
          const loading = document.createElement('div');
          loading.className = 'mm-loading';
          loading.dataset.i18n = 'rendering';
          loading.textContent = t('rendering');
          w.querySelector('.mm-scroll').prepend(loading);
        }
        jobs.push({ i, key, b, placeholder: w, prevSvg });
      }
      const slot = frag.querySelector(`.mm-slot[data-idx="${i}"]`);
      slot?.replaceWith(w);
      return { ...b, key, wrapper: w };
    });
    for (const b of next) {
      b.wrapper.dataset.line = String(b.fence >= 0 ? b.fence : 0);
      b.wrapper.dataset.end = String(b.end);
    }

    const top = scrollEl.scrollTop;
    contentEl.replaceChildren(...frag.childNodes);
    scrollEl.scrollTop = top;
    blocks = next;
    refresh();
    reportErrors();

    for (const job of jobs) {
      const w = await getOrRender(job.key, job.b.code, job.prevSvg);
      if (v !== version) return;
      job.placeholder.replaceWith(w);
      blocks[job.i].wrapper = w;
      w.dataset.line = String(job.b.fence >= 0 ? job.b.fence : 0);
      w.dataset.end = String(job.b.end);
      const svg = w.querySelector('.mm-scroll > svg');
      if (svg) applyZoomTo(svg);
      refresh();
      reportErrors();
    }

    // Cache aufräumen
    const keep = new Set(blocks.map((b) => b.key));
    if (cache.size > keep.size + 30) {
      for (const k of cache.keys()) if (!keep.has(k) && cache.size > keep.size + 15) cache.delete(k);
    }
  }

  function reportErrors() {
    const lines = [];
    for (const b of blocks) {
      if (b.wrapper._errLine == null || b.wrapper._errLine < 0) continue;
      const abs = b.codeStart + b.wrapper._errLine;
      lines.push(abs);
      const btn = b.wrapper.querySelector('.mm-errline');
      if (btn) btn.textContent = t('errorLine', { line: abs + 1 });
    }
    onErrors?.(lines);
  }

  // ------------------------------------------------------------ Markieren
  function clearMarks(cls) {
    contentEl.querySelectorAll('.hl.' + cls).forEach((d) => d.remove());
    if (cls === 'hl-sel' || cls === 'hl-ref') contentEl.querySelectorAll('.sync-active').forEach((e) => e.classList.remove('sync-active'));
  }

  function drawBoxes(wrapper, entries, cls) {
    const layer = wrapper.querySelector('.mm-overlay');
    if (!layer) return [];
    const base = layer.getBoundingClientRect();
    const out = [];
    for (const e of entries) {
      for (const group of e.hl) {
        const r = union(group.map((el) => el.getBoundingClientRect()));
        if (!r) continue;
        const pad = 4;
        const d = document.createElement('div');
        d.className = 'hl ' + cls;
        d.style.left = r.left - base.left - pad + 'px';
        d.style.top = r.top - base.top - pad + 'px';
        d.style.width = r.right - r.left + 2 * pad + 'px';
        d.style.height = r.bottom - r.top + 2 * pad + 'px';
        layer.appendChild(d);
        out.push(d);
      }
    }
    return out;
  }

  function scrollIntoViewIfNeeded(el) {
    if (!el || !scrollEl.offsetParent) return;
    const sc = el.closest('.mm-scroll');
    if (sc && sc.scrollWidth > sc.clientWidth + 1) {
      const r = el.getBoundingClientRect();
      const s = sc.getBoundingClientRect();
      if (r.left < s.left || r.right > s.right) {
        sc.scrollTo({ left: Math.max(0, sc.scrollLeft + (r.left - s.left) - Math.max(20, (s.width - r.width) / 2)), behavior: 'smooth' });
      }
    }
    const r = el.getBoundingClientRect();
    const v = scrollEl.getBoundingClientRect();
    const margin = 24;
    if (r.top >= v.top + margin && r.bottom <= v.bottom - margin) return;
    let target;
    if (r.height > v.height - 2 * margin) target = scrollEl.scrollTop + (r.top - v.top) - margin;
    else target = scrollEl.scrollTop + (r.top - v.top) - (v.height - r.height) / 2;
    scrollEl.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }

  /** Markiert die Elemente zu den (absoluten) Zeilen. */
  function highlightLines(lines, { scroll = true } = {}) {
    lastSel = lines;
    clearMarks('hl-sel');
    clearMarks('hl-ref');
    if (!lines.length) return;
    let first = null;
    let inBlock = false;
    for (const b of blocks) {
      const inside = lines.filter((l) => l >= b.codeStart && l < b.end - (b.fence >= 0 ? 1 : 0));
      const onFence = b.fence >= 0 && lines.some((l) => l === b.fence || l === b.end - 1);
      if (!inside.length && !onFence) continue;
      inBlock = true;
      const sync = b.wrapper._sync;
      let found = [];
      let refs = [];
      if (sync) {
        for (const l of inside) {
          const r = sync.forLine(l - b.codeStart, lineText(l));
          if (r.ref) refs.push(...r.entries); else found.push(...r.entries);
        }
      }
      found = [...new Set(found)];
      refs = [...new Set(refs)].filter((e) => !found.includes(e));
      const boxes = [...drawBoxes(b.wrapper, found, 'hl-sel'), ...drawBoxes(b.wrapper, refs, 'hl-ref')];
      if (!boxes.length) b.wrapper.classList.add('sync-active');
      first ||= boxes[0] || b.wrapper;
    }
    if (!inBlock) {
      const l = lines[0];
      let best = null;
      for (const el of contentEl.querySelectorAll('[data-line]')) {
        if (el.closest('.mm-block')) continue;
        const a = +el.dataset.line;
        const e = +el.dataset.end;
        if (l >= a && l < e && (!best || a >= +best.dataset.line)) best = el;
      }
      if (best) { best.classList.add('sync-active'); first = best; }
    }
    if (scroll && first) scrollIntoViewIfNeeded(first);
  }

  function refresh() {
    const before = avail;
    if (measureAvail() !== before) applyZoomAll();
    highlightLines(lastSel, { scroll: false });
  }

  // ------------------------------------------------------------ Maus
  function blockOf(wrapper) {
    return blocks.find((b) => b.wrapper === wrapper);
  }

  function hitAt(target) {
    const w = target.closest?.('.mm-block');
    if (!w) return null;
    const b = blockOf(w);
    if (!b) return null;
    const svg = w.querySelector('.mm-scroll > svg');
    const entry = w._sync && svg ? w._sync.hit(target, svg) : null;
    return { b, w, entry, line: entry ? b.codeStart + entry.line : null };
  }

  let hoverEntry = null;
  contentEl.addEventListener('mousemove', (e) => {
    const h = hitAt(e.target);
    const entry = h?.entry || null;
    if (entry === hoverEntry) return;
    hoverEntry = entry;
    clearMarks('hl-hover');
    if (entry) {
      drawBoxes(h.w, [entry], 'hl-hover');
      onHover?.([h.line]);
    } else onHover?.([]);
  });
  contentEl.addEventListener('mouseleave', () => {
    hoverEntry = null;
    clearMarks('hl-hover');
    onHover?.([]);
  });

  function wordAt(x, y) {
    let node, offset;
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      node = p?.offsetNode; offset = p?.offset;
    } else if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      node = r?.startContainer; offset = r?.startOffset;
    }
    if (!node || node.nodeType !== 3) return '';
    const s = node.nodeValue;
    let a = offset, b = offset;
    while (a > 0 && /[\p{L}\p{N}_]/u.test(s[a - 1])) a--;
    while (b < s.length && /[\p{L}\p{N}_]/u.test(s[b])) b++;
    return s.slice(a, b);
  }

  contentEl.addEventListener('click', async (e) => {
    if (e.target.closest('a')) return;
    const tool = e.target.closest('.mm-tools button');
    if (tool) {
      try { await exportBlock(tool.closest('.mm-block'), tool.dataset.act); }
      catch (error) { toast('exportFailed', { reason: () => errorText(error) }); }
      return;
    }
    const errBtn = e.target.closest('.mm-errline');
    if (errBtn) {
      const b = blockOf(errBtn.closest('.mm-block'));
      if (b) onJump(b.codeStart + Number(errBtn.dataset.rel));
      return;
    }
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && contentEl.contains(sel.anchorNode)) return;

    const h = hitAt(e.target);
    if (h) {
      onJump(h.line != null ? h.line : h.b.codeStart);
      return;
    }
    const el = e.target.closest('[data-line]');
    if (!el) return;
    const a = +el.dataset.line;
    const end = +el.dataset.end;
    let line = a;
    const w = wordAt(e.clientX, e.clientY);
    if (w) {
      for (let l = a; l < end; l++) if (lineText(l).includes(w)) { line = l; break; }
    }
    onJump(line);
  });

  // Zoom per Pinch / ⌘-Scroll
  scrollEl.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom(zoom * Math.exp(-e.deltaY * 0.01));
  }, { passive: false });
  let gestureBase = 1;
  scrollEl.addEventListener('gesturestart', (e) => { e.preventDefault(); gestureBase = zoom; });
  scrollEl.addEventListener('gesturechange', (e) => { e.preventDefault(); setZoom(gestureBase * e.scale); });

  new ResizeObserver(() => refresh()).observe(scrollEl);

  // ------------------------------------------------------------ Export
  async function exportBlock(w, act) {
    const b = blockOf(w);
    if (!b) return;
    if (act === 'copy' && !opts.copyImage) {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
        toast('copyBlocked');
        return;
      }
      const file = renderExport(b, w, 'png');
      const image = file.then((result) => {
        if (!result) throw new Error('Missing export image');
        return result.blob;
      });
      // WebKit requires the write to begin during the click, before the image is ready.
      image.catch(() => {});
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': image })]);
        toast('copied');
      } catch {
        if (await file) toast('copyBlocked');
      }
      return;
    }

    const file = await renderExport(b, w, act === 'svg' ? 'svg' : 'png');
    if (!file) return;
    if (act === 'copy') await opts.copyImage(file.blob);
    else await (opts.saveFile || download)(file.blob, file.name);
  }

  function renderLightSvg(code) {
    return enqueue(async () => {
      mermaid.initialize(mermaidConfig(false));
      try { return await renderSvg(code, false); } finally { mermaid.initialize(mermaidConfig(dark)); }
    });
  }

  async function renderDocumentDiagrams(content, diagrams, signal) {
    for (const slot of content.querySelectorAll('.mm-slot')) {
      if (signal.aborted) return;
      const { code } = diagrams[Number(slot.dataset.idx)];
      const result = await renderLightSvg(code);
      if (result.ok) {
        slot.classList.replace('mm-slot', 'pdf-diagram');
        slot.innerHTML = result.svg;
        const svg = slot.querySelector('svg');
        const { width, height } = svg.viewBox.baseVal;
        if (width > 0 && height > 0) {
          // Fit tall diagrams within the printable area of an A4 page.
          svg.style.width = Math.min(width, width * 900 / height) + 'px';
        }
      } else {
        const fallback = document.createElement('pre');
        fallback.textContent = `${t('mermaidError')}\n\n${code}`;
        slot.replaceWith(fallback);
      }
    }
  }

  async function renderExport(b, w, format) {
    const res = await renderLightSvg(b.code);
    if (!res.ok) { toast('exportInvalid'); return; }
    const doc = new DOMParser().parseFromString(res.svg, 'image/svg+xml');
    const svg = doc.documentElement;
    const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    const W = Math.ceil(vb[2] || parseFloat(svg.style.maxWidth) || 800);
    const H = Math.ceil(vb[3] || 600);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.style.maxWidth = '';
    const text = new XMLSerializer().serializeToString(svg);
    const base = (w._title || opts.baseName() + (blocks.length > 1 ? '-' + (blocks.indexOf(b) + 1) : ''))
      .replace(/[\\/:*?"<>|]+/g, '_').trim() || t('diagramFile').toLowerCase();
    if (format === 'svg') return { blob: new Blob([text], { type: 'image/svg+xml' }), name: base + '.svg' };

    const scale = 2;
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
    try { await img.decode(); } catch { toast('pngFailed'); return; }
    const canvas = document.createElement('canvas');
    canvas.width = W * scale;
    canvas.height = H * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) { toast('pngFailed'); return; }
    return { blob, name: base + '.png' };
  }

  // ------------------------------------------------------------ Zoom/Theme
  function setZoom(z) {
    zoom = Math.max(0.25, Math.min(5, z));
    measureAvail();
    applyZoomAll();
    opts.onZoom?.(zoom);
    refresh();
  }

  return {
    update,
    renderDocument: (text) => renderDocument(text, kind),
    renderDocumentDiagrams,
    highlightLines,
    refresh,
    setLocale() {
      for (const w of new Set([...cache.values(), ...blocks.map((b) => b.wrapper)])) {
        translate(w);
        updateErrorDetails(w);
      }
      reportErrors();
    },
    setKind(k) { kind = k; },
    setDark(d) {
      if (d === dark) return;
      dark = d;
      enqueue(() => mermaid.initialize(mermaidConfig(dark)));
    },
    setZoom,
    getZoom: () => zoom,
  };
}
