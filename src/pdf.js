import { errorText, t, translate } from './i18n.js';

function addContents(output, headings) {
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
  output.prepend(nav);
}

function makeBreakOption(block) {
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  const line = document.createElement('span');
  line.className = 'pdf-line';
  const lineLabel = document.createElement('span');
  lineLabel.dataset.i18n = 'pdfLine';
  line.append(lineLabel, ' ' + (Number(block.dataset.line) + 1));
  const label = document.createElement('span');
  const excerpt = block.textContent.replace(/\s+/g, ' ').trim() || block.querySelector('img')?.alt;
  if (excerpt) label.textContent = excerpt.length > 120 ? excerpt.slice(0, 119) + '…' : excerpt;
  else label.dataset.i18n = block.classList.contains('mm-slot') ? 'diagram' : 'pdfBlock';
  const row = document.createElement('label');
  row.className = 'pdf-option';
  row.append(checkbox, line, label);
  return { row, checkbox, block };
}

export function createPdfExport({ preview, getText, getName, savePdf, toast }) {
  const dialog = document.querySelector('#pdf-dialog');
  const output = document.querySelector('#pdf-document');
  const toc = dialog.querySelector('#pdf-toc');
  const breaks = dialog.querySelector('#pdf-breaks');
  const breakList = dialog.querySelector('#pdf-break-list');
  const progress = dialog.querySelector('#pdf-progress');
  const submit = dialog.querySelector('#pdf-export');
  const cancel = dialog.querySelector('[value="cancel"]');
  if (savePdf) {
    dialog.querySelector('#pdf-browser-help').hidden = true;
    submit.dataset.i18n = 'pdfSave';
  }

  let job;
  let busy = false;
  function syncBreakOptions() {
    const first = job.options.find(({ startsDocument }) => startsDocument);
    if (first) first.row.hidden = !toc.checked;
    breaks.hidden = !job.options.some(({ row }) => !row.hidden);
  }

  function cleanup() {
    document.body.classList.remove('pdf-printing');
    output.replaceChildren();
    busy = false;
  }

  dialog.addEventListener('cancel', (event) => {
    if (busy) event.preventDefault();
  });
  dialog.addEventListener('close', () => { if (!dialog.open) job = null; });
  toc.addEventListener('change', syncBreakOptions);
  dialog.querySelector('form').addEventListener('submit', async (event) => {
    if (event.submitter === cancel) return;
    event.preventDefault();
    if (busy || !job) return;
    busy = true;
    toc.disabled = submit.disabled = cancel.disabled = true;
    breaks.inert = true;
    progress.hidden = false;
    try {
      const { content, diagrams, headings, options, name } = job;
      const includeContents = toc.checked;
      for (const { block, checkbox, row } of options) {
        block.classList.toggle('pdf-page-break', checkbox.checked && !row.hidden);
      }
      await preview.renderDocumentDiagrams(content, diagrams);
      output.replaceChildren(...content.childNodes);
      if (includeContents) addContents(output, headings);
      await Promise.allSettled(Array.from(output.querySelectorAll('img'), (img) => img.decode()));
      document.body.classList.add('pdf-printing');
      dialog.close();

      if (savePdf) {
        try { await savePdf(name); } finally { cleanup(); }
      } else {
        const appTitle = document.title;
        const afterPrint = () => {
          if (document.title === name) document.title = appTitle;
          cleanup();
        };
        document.title = name;
        window.addEventListener('afterprint', afterPrint, { once: true });
        try { window.print(); } catch (error) {
          window.removeEventListener('afterprint', afterPrint);
          afterPrint();
          throw error;
        }
      }
    } catch (error) {
      dialog.close();
      cleanup();
      toast('exportFailed', { reason: () => error?.data?.code ? errorText(error) : t('pdfGenerationFailed') });
    } finally {
      progress.hidden = true;
      breaks.inert = false;
      submit.disabled = cancel.disabled = false;
    }
  });

  return function openPdfExport() {
    if (busy || dialog.open) return;
    const { content, diagrams } = preview.renderDocument(getText());
    const headings = [...content.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter((h) => h.textContent.trim());
    const options = Array.from(content.children)
      .filter((block) => block.hasAttribute('data-line'))
      .map((block) => ({ ...makeBreakOption(block), startsDocument: block === content.firstElementChild }));
    job = { content, diagrams, headings, options, name: getName() };
    toc.checked = false;
    toc.disabled = !headings.length;
    breaks.open = false;
    breakList.replaceChildren(...options.map(({ row }) => row));
    syncBreakOptions();
    translate(breakList);
    dialog.showModal();
  };
}
