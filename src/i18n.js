const messages = {
  files: ['Dateien', 'Files'],
  untitled: ['Unbenannt', 'Untitled'],
  unsavedChanges: ['Ungespeicherte Änderungen', 'Unsaved changes'],
  unsaved: ['Nicht gespeichert', 'Unsaved'],
  code: ['Code', 'Code'],
  split: ['Beides', 'Split'],
  diagram: ['Diagramm', 'Diagram'],
  viewLabel: ['Editoransicht', 'Editor view'],
  codeTitle: ['Nur Code (Ctrl+1)', 'Code only (Ctrl+1)'],
  splitTitle: ['Code und Diagramm (Ctrl+2)', 'Code and diagram (Ctrl+2)'],
  diagramTitle: ['Nur Diagramm (Ctrl+3)', 'Diagram only (Ctrl+3)'],
  zoom: ['Zoom (auch ⌘+Scrollen / Pinch)', 'Zoom (also ⌘+scroll / pinch)'],
  zoomIn: ['Vergrössern', 'Zoom in'],
  zoomOut: ['Verkleinern', 'Zoom out'],
  zoomReset: ['Auf 100 % zurücksetzen', 'Reset to 100%'],
  open: ['Öffnen', 'Open'],
  openTitle: ['Datei öffnen (⌘O)', 'Open file (⌘O)'],
  save: ['Speichern', 'Save'],
  saveTitle: ['Speichern (⌘S)', 'Save (⌘S)'],
  more: ['Mehr', 'More'],
  newDoc: ['Neues Dokument', 'New document'],
  newMermaid: ['Neue Mermaid-Datei', 'New Mermaid file'],
  openMenu: ['Öffnen …', 'Open…'],
  openFolder: ['Ordner öffnen …', 'Open folder…'],
  find: ['Im Code suchen', 'Find in code'],
  saveAs: ['Speichern unter …', 'Save as…'],
  exportPdfMenu: ['Als PDF exportieren …', 'Export as PDF…'],
  exportPdf: ['Als PDF exportieren', 'Export as PDF'],
  pdfIncludeToc: ['Inhaltsverzeichnis aus Überschriften erstellen', 'Create a table of contents from headings'],
  pdfToc: ['Inhaltsverzeichnis', 'Table of contents'],
  pdfPageBreaks: ['Seitenumbrüche anzeigen', 'Show page breaks'],
  pdfBreakHelp: ['Klicke auf eine Linie mit +, um einen Umbruch zu setzen. Mit × löschst du ihn. Umbrüche lassen sich ziehen oder mit ↑ und ↓ verschieben.', 'Click a line with + to add a break. Use × to remove it. Drag a break or move it with ↑ and ↓.'],
  pdfResetBreaks: ['Alle automatisch', 'Reset all breaks'],
  pdfAutoBreak: ['Automatischer Umbruch · Seite {page}', 'Automatic break · Page {page}'],
  pdfManualBreak: ['Manueller Umbruch · Seite {page}', 'Manual break · Page {page}'],
  pdfContinued: ['Seite {page}', 'Page {page}'],
  pdfInsertBreak: ['Seitenumbruch vor diesem Block einfügen', 'Add a page break before this block'],
  pdfRemoveBreak: ['Umbruch vor Seite {page} löschen', 'Remove the break before page {page}'],
  pdfBrowserHelp: ['Wähle im Druckdialog «Als PDF speichern».', 'Choose “Save as PDF” in the print dialog.'],
  pdfContinue: ['Zum Druckdialog', 'Open print dialog'],
  pdfSave: ['PDF speichern', 'Save PDF'],
  pdfPreparing: ['PDF wird vorbereitet …', 'Preparing PDF…'],
  pdfGenerationFailed: ['Das PDF konnte nicht erstellt werden.', 'Could not create the PDF.'],
  reveal: ['Im Finder zeigen', 'Show in Finder'],
  autosave: ['Automatisch speichern', 'Autosave'],
  wrap: ['Zeilen umbrechen', 'Wrap lines'],
  appearance: ['Darstellung', 'Appearance'],
  system: ['System', 'System'],
  light: ['Hell', 'Light'],
  dark: ['Dunkel', 'Dark'],
  language: ['Sprache', 'Language'],
  german: ['Deutsch', 'German'],
  english: ['Englisch', 'English'],
  conflictNotice: ['Die Datei wurde ausserhalb des Editors geändert.', 'The file was changed outside the editor.'],
  reload: ['Version von der Festplatte laden', 'Reload from disk'],
  keep: ['Meine Version speichern', 'Save my version'],
  offline: ['Verbindung zum Editor-Server getrennt. Änderungen werden nicht gespeichert. Starte den Mermaid Editor neu.',
    'Disconnected from the editor server. Changes cannot be saved. Restart Mermaid Editor.'],
  refresh: ['Aktualisieren', 'Refresh'],
  changeFolder: ['Ordner wechseln …', 'Change folder…'],
  filter: ['Filtern …', 'Filter…'],
  divider: ['Ziehen zum Anpassen, Doppelklick = 50/50', 'Drag to resize. Double-click to reset to 50/50.'],
  conflict: ['Konflikt', 'Conflict'],
  saving: ['Speichert …', 'Saving…'],
  changes: ['Änderungen …', 'Changes…'],
  saved: ['Gespeichert', 'Saved'],
  exported: ['Gespeichert: {name}', 'Saved: {name}'],
  copied: ['Diagramm als Bild kopiert', 'Diagram copied as an image'],
  copyBlocked: ['Kopieren nicht möglich. Speichere das Diagramm als PNG.', 'Could not copy the image. Save the diagram as a PNG.'],
  diagramFile: ['Diagramm', 'Diagram'],
  reloaded: ['Extern geänderte Datei neu geladen', 'Reloaded externally modified file'],
  discard: ['Ungespeicherten Text verwerfen?', 'Discard unsaved text?'],
  cancel: ['Abbrechen', 'Cancel'],
  discardButton: ['Verwerfen', 'Discard'],
  openFailed: ['Öffnen fehlgeschlagen: {reason}', 'Could not open: {reason}'],
  saveFailed: ['Speichern fehlgeschlagen: {reason}', 'Could not save: {reason}'],
  newFile: ['Neue Datei – wird beim Speichern angelegt', 'New file – it will be created when saved'],
  noFiles: ['Keine .md / .mmd-Dateien', 'No .md / .mmd files'],
  saveSvg: ['Als SVG speichern', 'Save as SVG'],
  savePng: ['Als PNG speichern', 'Save as PNG'],
  copyImage: ['Als Bild kopieren', 'Copy as image'],
  copy: ['Kopieren', 'Copy'],
  mermaidError: ['Mermaid-Fehler', 'Mermaid error'],
  errorLine: ['→ Zeile {line}', '→ Line {line}'],
  renderFailed: ['Dieses Diagramm konnte nicht gerendert werden.', 'This diagram could not be rendered.'],
  unknownDiagram: ['Mermaid erkennt den Diagrammtyp nicht.', 'Mermaid does not recognize the diagram type.'],
  syntaxError: ['Mermaid kann die Syntax an dieser Stelle nicht lesen.', 'Mermaid cannot parse the syntax at this location.'],
  expectedToken: ['Erwartet: {tokens}', 'Expected: {tokens}'],
  foundToken: ['Gefunden: {token}', 'Found: {token}'],
  rendering: ['Diagramm wird gerendert …', 'Rendering diagram…'],
  exportInvalid: ['Export nicht möglich: Das Diagramm hat Fehler.', 'Could not export: The diagram has errors.'],
  exportFailed: ['Export fehlgeschlagen: {reason}', 'Could not export: {reason}'],
  pngFailed: ['PNG-Export fehlgeschlagen', 'PNG export failed'],
  requestFailed: ['Die Anfrage ist fehlgeschlagen.', 'The request failed.'],
  invalidPath: ['Ungültiger Pfad', 'Invalid path'],
  brokenLink: ['Symbolischer Link ohne Ziel', 'Symbolic link has no target'],
  unsupportedFile: ['Dateityp nicht erlaubt', 'File type not allowed'],
  missingFolder: ['Ordner fehlt', 'Folder is missing'],
  fileNotAllowed: ['Datei wurde nicht freigegeben', 'File access was not granted'],
  folderNotAllowed: ['Ordner wurde nicht freigegeben', 'Folder access was not granted'],
  notRegularFile: ['Keine reguläre Datei', 'Not a regular file'],
  missingToken: ['Token fehlt', 'Missing token'],
  invalidContent: ['Ungültiger Dateiinhalt', 'Invalid file content'],
  chooseSupportedFile: ['Bitte eine .md- oder .mmd-Datei wählen', 'Choose an .md or .mmd file'],
  imageNotAllowed: ['Bild wurde nicht freigegeben', 'Image access was not granted'],
  notFound: ['Nicht gefunden', 'Not found'],
  unknownRequest: ['Unbekannte Anfrage', 'Unknown request'],
  invalidRequest: ['Ungültige Anfrage', 'Invalid request'],
  unreadableFile: ['Datei nicht lesbar', 'File could not be read'],
  missingData: ['Keine Daten', 'No data received'],
  writeFailed: ['Datei konnte nicht geschrieben werden', 'File could not be written'],
  permissionDenied: ['Zugriff verweigert', 'Permission denied'],
  diskFull: ['Nicht genug Speicherplatz', 'Not enough disk space'],
  dialogsUnavailable: ['Dateidialoge sind nur unter macOS verfügbar.', 'File dialogs are only available on macOS.'],
};

let locale = 'en';
export function normalizeLocale(value) { return value === 'de' ? 'de' : 'en'; }
export function setLocale(value) {
  locale = normalizeLocale(value);
  document.documentElement.lang = locale;
}

export function t(key, params = {}) {
  return messages[key][locale === 'en' ? 1 : 0].replace(/\{(\w+)\}/g, (_, name) => {
    const value = params[name];
    return typeof value === 'function' ? value() : value;
  });
}

export function translate(root) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-title]')) {
    const label = t(el.dataset.i18nTitle);
    el.title = label;
    if (el.matches('button')) el.setAttribute('aria-label', label);
  }
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) {
    el.placeholder = t(el.dataset.i18nPlaceholder);
    el.setAttribute('aria-label', el.placeholder);
  }
  for (const el of root.querySelectorAll('[data-i18n-label]')) el.setAttribute('aria-label', t(el.dataset.i18nLabel));
}

export function errorText(error) {
  const code = error?.data?.code;
  return t(Object.hasOwn(messages, code) ? code : 'requestFailed');
}
