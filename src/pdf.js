import { errorText, t } from './i18n.js';

function makeContents(headings) {
  const nav = document.createElement('nav');
  nav.className = 'pdf-toc';
  const title = document.createElement('h2');
  title.textContent = t('pdfToc');
  const list = document.createElement('ul');
  const topLevel = Math.min(...headings.map((h) => Number(h.tagName[1])));
  for (const [index, heading] of headings.entries()) {
    heading.id = 'pdf-heading-' + (index + 1);
    const item = document.createElement('li');
    item.style.paddingInlineStart = (Number(heading.tagName[1]) - topLevel) + 'em';
    const link = document.createElement('a');
    link.setAttribute('href', '#' + heading.id);
    link.textContent = heading.textContent;
    item.append(link);
    list.append(item);
  }
  nav.append(title, list);
  return nav;
}

function waitForImages(content, signal) {
  const images = [...content.querySelectorAll('img')];
  if (!images.length) return Promise.resolve();
  const pending = new Set(images);
  const loaded = images.map(async (image) => {
    try {
      await image.decode();
      pending.delete(image);
    } catch { /* Show the alternative text if the image cannot be loaded. */ }
  });
  return new Promise((resolve) => {
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      for (const image of pending) {
        image.removeAttribute('src');
        image.replaceWith(image.alt);
      }
      pending.clear();
      resolve();
    }
    const timer = setTimeout(finish, 3500);
    if (signal.aborted) finish();
    else signal.addEventListener('abort', finish, { once: true });
    Promise.all(loaded).then(finish);
  });
}

function makePage(start, continuation) {
  const sheet = document.createElement('section');
  sheet.className = 'pdf-sheet';
  const content = document.createElement('article');
  content.className = 'pdf-content markdown-body';
  sheet.append(content);
  return { sheet, content, start, continuation };
}

function fits(page) {
  return page.scrollHeight <= page.clientHeight;
}

// Preserve inline formatting when a single Markdown block spans several pages.
function splitBlock(block, page, emptyPage) {
  const points = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => node.parentElement?.closest('svg') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      for (const word of node.data.matchAll(/\S+\s*|\s+/gu)) {
        // Long unbroken strings can wrap at character boundaries.
        for (let i = 80; i < word[0].length; i += 80) {
          const offset = word.index + i;
          const code = node.data.charCodeAt(offset);
          if (code < 0xDC00 || code > 0xDFFF) points.push([node, offset]);
        }
        points.push([node, word.index + word[0].length]);
      }
    } else if (node.matches('svg, img, br, hr')) {
      const parent = node.parentNode;
      points.push([parent, Array.prototype.indexOf.call(parent.childNodes, node) + 1]);
    }
  }

  const part = (point, prefix) => {
    const range = document.createRange();
    range.selectNodeContents(block);
    if (prefix) range.setEnd(...point);
    else range.setStart(...point);
    const clone = block.cloneNode(false);
    clone.append(range.cloneContents());
    if (!prefix) {
      clone.removeAttribute('id');
      // An ordered list continued on a new page keeps its numbering.
      if (block.matches('ol')) {
        const item = (point[0].nodeType === Node.ELEMENT_NODE ? point[0] : point[0].parentElement).closest('li');
        if (item?.parentElement === block) clone.start = block.start + [...block.children].indexOf(item);
      }
    }
    return clone;
  };

  let low = 0;
  let high = points.length - 1;
  let last = -1;
  block.remove();
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const prefix = part(points[mid], true);
    page.append(prefix);
    if (fits(page)) { last = mid; low = mid + 1; }
    else high = mid - 1;
    prefix.remove();
  }

  if (last < 0) {
    if (emptyPage) {
      page.append(block);
      block.style.zoom = Math.min(1, page.clientHeight / page.scrollHeight);
    }
    return emptyPage ? null : block;
  }
  page.append(part(points[last], true));
  const rest = part(points[last], false);
  return rest.textContent.trim() || rest.querySelector('img, svg, hr') ? rest : null;
}

function paginate(target, blocks, breaks) {
  const pages = [];
  const newPage = (start, continuation = false) => {
    const page = makePage(start, continuation);
    pages.push(page);
    target.append(page.sheet);
    return page.content;
  };
  target.replaceChildren();
  let page = newPage(0);
  for (const [index, source] of blocks.entries()) {
    let block = source.cloneNode(true);
    block.dataset.pdfBlock = index;
    if (breaks.has(index) && page.firstElementChild) page = newPage(index);

    page.append(block);
    if (fits(page)) continue;
    while (!fits(page)) {
      const previous = block.previousElementSibling;
      const emptyPage = page.firstElementChild === block;
      const oversized = block.getBoundingClientRect().height > page.clientHeight;
      const rest = emptyPage || oversized ? splitBlock(block, page, emptyPage) : block;
      if (!rest) break;
      const keepHeading = rest === block && previous?.matches('h1, h2, h3, h4, h5, h6') && previous.previousElementSibling;
      page = newPage(keepHeading ? index - 1 : index, block !== rest);
      if (keepHeading) page.append(previous);
      block = rest;
      page.append(block);
    }
  }
  return pages;
}

function blockAnchors(content, text) {
  const lines = text.split(/\r\n?|\n/);
  const counts = new Map();
  return [...content.children].map((block) => {
    const source = lines[Number(block.dataset.line)] ?? block.textContent;
    const key = JSON.stringify([block.tagName, source.trim()]);
    const occurrence = counts.get(key) ?? 0;
    counts.set(key, occurrence + 1);
    return key + ':' + occurrence;
  });
}

export function createPdfExport({ preview, getText, getName, getSettingsKey, readSettings, writeSettings, savePdf, toast }) {
  const dialog = document.querySelector('#pdf-dialog');
  const output = document.querySelector('#pdf-document');
  const toc = dialog.querySelector('#pdf-toc');
  const showBreaks = dialog.querySelector('#pdf-show-breaks');
  const previewPanel = dialog.querySelector('#pdf-preview');
  const pagesEl = dialog.querySelector('#pdf-pages');
  const reset = dialog.querySelector('#pdf-reset-breaks');
  const progress = dialog.querySelector('#pdf-progress');
  const submit = dialog.querySelector('#pdf-export');
  const cancel = dialog.querySelector('[value="cancel"]');
  if (savePdf) {
    dialog.querySelector('#pdf-browser-help').hidden = true;
    submit.dataset.i18n = 'pdfSave';
  }

  let job;
  let printing = false;
  let drag;
  let resizeFrame;

  function resizeSheets() {
    const zoom = Math.max(0.1, Math.min(1, (pagesEl.clientWidth - 22) / (210 * 96 / 25.4)));
    for (const sheet of pagesEl.querySelectorAll('.pdf-sheet')) sheet.style.zoom = zoom;
  }
  new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(resizeSheets);
  }).observe(pagesEl);

  function layout(current) {
    const scroll = pagesEl.scrollTop;
    const includeContents = toc.checked;
    const blocks = includeContents ? [current.contents, ...current.blocks] : current.blocks;
    // Breaks use the source block index even when the contents page is toggled.
    const shift = Number(includeContents);
    const breaks = new Set([...current.breaks].map((index) => index + shift));
    const pages = paginate(pagesEl, blocks, breaks);
    current.pages = pages;
    current.layoutContents = includeContents;
    reset.disabled = !current.breaks.size;
    const seen = new Set();
    for (const [number, page] of pages.entries()) {
      const first = page.start - shift;
      if (number) {
        const manual = !page.continuation && current.breaks.has(first);
        const gap = document.createElement('div');
        gap.className = 'pdf-break';
        gap.classList.toggle('pdf-break-manual', manual);
        const handle = document.createElement(page.continuation ? 'span' : 'button');
        if (!page.continuation) {
          handle.type = 'button';
          handle.dataset.pdfHandle = first;
        }
        const message = page.continuation ? 'pdfContinued' : manual ? 'pdfManualBreak' : 'pdfAutoBreak';
        handle.textContent = t(message, { page: number + 1 });
        gap.append(handle);
        if (manual) {
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.dataset.pdfRemove = first;
          remove.setAttribute('aria-label', t('pdfRemoveBreak', { page: number + 1 }));
          remove.title = t('pdfRemoveBreak', { page: number + 1 });
          remove.textContent = '×';
          gap.append(remove);
        }
        page.sheet.before(gap);
      }
      const sheetTop = page.sheet.getBoundingClientRect().top;
      const buttons = [];
      for (const block of page.content.children) {
        const index = Number(block.dataset.pdfBlock) - shift;
        block.dataset.pdfBlock = index;
        if (index < Number(!includeContents) || seen.has(index)) continue;
        seen.add(index);
        if (current.breaks.has(index)) continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pdf-add-break';
        button.dataset.pdfAdd = index;
        button.setAttribute('aria-label', t('pdfInsertBreak'));
        button.title = t('pdfInsertBreak');
        button.style.top = (block.getBoundingClientRect().top - sheetTop) + 'px';
        button.textContent = '+';
        buttons.push(button);
      }
      page.sheet.append(...buttons);
    }
    resizeSheets();
    pagesEl.scrollTop = scroll;
  }

  function prepare(current) {
    if (current.ready) return current.ready;
    const { content, diagrams, controller: { signal } } = current;
    progress.hidden = false;
    current.ready = Promise.all([
      preview.renderDocumentDiagrams(content, diagrams, signal),
      waitForImages(content, signal),
    ]).then(() => {
      if (job !== current) return;
      const headings = [...content.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter((h) => !h.closest('svg') && h.textContent.trim());
      current.contents = headings.length ? makeContents(headings) : null;
      toc.disabled = !current.contents;
      if (toc.disabled) toc.checked = false;
      current.blocks = [...content.children];
    }).finally(() => { if (job === current) progress.hidden = true; });
    return current.ready;
  }

  function report(error) {
    toast('exportFailed', { reason: () => error?.data?.code ? errorText(error) : t('pdfGenerationFailed') });
  }

  async function refresh() {
    const current = job;
    if (!current || !showBreaks.checked) return;
    try {
      await prepare(current);
      if (job === current && showBreaks.checked) layout(current);
    } catch (error) { report(error); }
  }

  function saveSettings() {
    writeSettings(job.settingsKey, {
      contents: toc.checked,
      breaks: [...job.breaks].map((index) => job.anchors[index]),
    });
  }

  function updateBreaks() {
    saveSettings();
    layout(job);
  }

  function moveBreak(from, to) {
    if (from === to || to < Number(!toc.checked) || to >= job.blocks.length || job.breaks.has(to)) return;
    job.breaks.delete(from);
    job.breaks.add(to);
    updateBreaks();
    const handle = pagesEl.querySelector(`[data-pdf-handle="${to}"]`);
    handle?.focus({ preventScroll: true });
    handle?.scrollIntoView({ block: 'nearest' });
  }

  function aimAt(clientY) {
    const y = clientY - pagesEl.getBoundingClientRect().top + pagesEl.scrollTop;
    let best;
    for (const candidate of drag.targets) {
      if (!best || Math.abs(candidate.y - y) < Math.abs(best.y - y)) best = candidate;
    }
    if (best === drag.target) return;
    drag.target?.element.removeAttribute('data-pdf-drop');
    drag.target = best;
    best?.element.setAttribute('data-pdf-drop', '');
  }

  pagesEl.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest('[data-pdf-handle]');
    if (drag || !handle || event.button !== 0) return;
    const from = Number(handle.dataset.pdfHandle);
    const handles = [...pagesEl.querySelectorAll('[data-pdf-handle]')];
    const at = handles.indexOf(handle);
    const previous = handles[at - 1]?.dataset.pdfHandle;
    const next = handles[at + 1]?.dataset.pdfHandle;
    const min = previous == null ? Number(!toc.checked) : Number(previous) + 1;
    const max = next == null ? job.blocks.length - 1 : Number(next) - 1;
    const rect = pagesEl.getBoundingClientRect();
    const targets = [];
    for (const element of pagesEl.querySelectorAll('[data-pdf-block]')) {
      const index = Number(element.dataset.pdfBlock);
      if (index < min || index > max || targets.at(-1)?.index === index) continue;
      targets.push({ element, index, y: element.getBoundingClientRect().top - rect.top + pagesEl.scrollTop });
    }
    drag = { from, targets, id: event.pointerId, y: event.clientY, startY: event.clientY };
    handle.setPointerCapture(event.pointerId);
  });

  function trackDrag() {
    if (!drag || !drag.moving) return;
    const rect = pagesEl.getBoundingClientRect();
    if (drag.y < rect.top + 26) pagesEl.scrollTop -= 12;
    if (drag.y > rect.bottom - 26) pagesEl.scrollTop += 12;
    aimAt(drag.y);
    drag.frame = requestAnimationFrame(trackDrag);
  }

  pagesEl.addEventListener('pointermove', (event) => {
    if (drag?.id !== event.pointerId) return;
    drag.y = event.clientY;
    if (drag.moving || Math.abs(drag.y - drag.startY) < 4) return;
    drag.moving = true;
    pagesEl.classList.add('pdf-dragging');
    trackDrag();
  });
  function finishDrag(event) {
    if (drag?.id !== event.pointerId) return;
    if (drag.moving && event.type === 'pointerup') aimAt(event.clientY);
    const { from, target, frame } = drag;
    drag = null;
    cancelAnimationFrame(frame);
    pagesEl.classList.remove('pdf-dragging');
    target?.element.removeAttribute('data-pdf-drop');
    if (target && event.type === 'pointerup') moveBreak(from, target.index);
  }
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) pagesEl.addEventListener(event, finishDrag);
  pagesEl.addEventListener('keydown', (event) => {
    const handle = event.target.closest('[data-pdf-handle]');
    if (!handle || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const from = Number(handle.dataset.pdfHandle);
    moveBreak(from, from + (event.key === 'ArrowUp' ? -1 : 1));
  });
  pagesEl.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-pdf-remove]');
    if (remove) {
      const index = Number(remove.dataset.pdfRemove);
      job.breaks.delete(index);
      updateBreaks();
      pagesEl.querySelector(`[data-pdf-add="${index}"]`)?.focus();
      return;
    }
    const add = event.target.closest('[data-pdf-add]');
    if (!add) return;
    const index = Number(add.dataset.pdfAdd);
    job.breaks.add(index);
    updateBreaks();
    pagesEl.querySelector(`[data-pdf-handle="${index}"]`)?.focus();
  });
  reset.addEventListener('click', () => { job.breaks.clear(); updateBreaks(); });
  showBreaks.addEventListener('change', () => {
    previewPanel.hidden = !showBreaks.checked;
    refresh();
  });
  toc.addEventListener('change', () => {
    saveSettings();
    refresh();
  });

  function dismiss() {
    job?.controller.abort();
    job = null;
    cancelAnimationFrame(drag?.frame);
    drag = null;
    pagesEl.classList.remove('pdf-dragging');
    pagesEl.replaceChildren();
    progress.hidden = true;
    submit.disabled = false;
  }
  dialog.addEventListener('close', () => { if (!dialog.open) dismiss(); });
  dialog.addEventListener('cancel', (event) => { if (printing) event.preventDefault(); });
  cancel.addEventListener('click', () => dialog.close());

  function cleanPrint() {
    document.body.classList.remove('pdf-printing');
    output.replaceChildren();
    printing = false;
  }

  function printableSheets(pages, clone) {
    return pages.map(({ sheet }) => {
      const printable = clone ? sheet.cloneNode(true) : sheet;
      printable.style.removeProperty('zoom');
      printable.querySelectorAll('.pdf-add-break').forEach((button) => button.remove());
      return printable;
    });
  }

  dialog.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!job || submit.disabled) return;
    const current = job;
    submit.disabled = true;
    try {
      await prepare(current);
      if (job !== current || !dialog.open) return;
      if (!current.pages || current.layoutContents !== toc.checked) layout(current);
      printing = true;
      if (savePdf) {
        const markup = printableSheets(current.pages, true).map((sheet) => sheet.outerHTML).join('');
        cancel.disabled = showBreaks.disabled = previewPanel.inert = true;
        toc.disabled = true;
        progress.hidden = false;
        try {
          await savePdf(current.name, markup);
          dialog.close();
        } finally {
          progress.hidden = true;
          cancel.disabled = showBreaks.disabled = previewPanel.inert = false;
          toc.disabled = !current.contents;
          cleanPrint();
        }
        return;
      }
      output.replaceChildren(...printableSheets(current.pages, false));
      dialog.close();
      document.body.classList.add('pdf-printing');
      const oldTitle = document.title;
      const beforePrint = () => clearTimeout(watchdog);
      const afterPrint = () => {
        beforePrint();
        window.removeEventListener('beforeprint', beforePrint);
        window.removeEventListener('afterprint', afterPrint);
        if (document.title === current.name) document.title = oldTitle;
        cleanPrint();
      };
      const watchdog = setTimeout(() => {
        afterPrint();
        report();
      }, 5000);
      document.title = current.name;
      window.addEventListener('beforeprint', beforePrint, { once: true });
      window.addEventListener('afterprint', afterPrint, { once: true });
      try { window.print(); } catch (error) {
        afterPrint();
        throw error;
      }
    } catch (error) {
      if (job === current) submit.disabled = false;
      report(error);
    }
  });

  return function openPdfExport() {
    if (printing || dialog.open) return;
    const text = getText();
    const { content, diagrams } = preview.renderDocument(text);
    const settingsKey = getSettingsKey();
    const settings = readSettings(settingsKey);
    const anchors = blockAnchors(content, text);
    const savedBreaks = new Set(settings?.breaks ?? []);
    const breaks = new Set();
    for (const [index, anchor] of anchors.entries()) {
      if (savedBreaks.has(anchor)) breaks.add(index);
    }
    job = { content, diagrams, name: getName(), settingsKey, anchors, breaks, controller: new AbortController() };
    toc.disabled = !content.querySelector('h1, h2, h3, h4, h5, h6');
    toc.checked = !toc.disabled && Boolean(settings?.contents);
    reset.disabled = true;
    showBreaks.checked = true;
    previewPanel.hidden = false;
    dialog.showModal();
    refresh();
  };
}
