# Mermaid Editor

A small tool I built for fun to make writing Mermaid diagrams easier. Code on the left, live preview on the right. The UI is available in English and German. Maybe it’ll come in handy or spark an idea!

## Screenshots

![Mermaid code and live preview with the selected message highlighted](screenshots/message-highlight.png)

![A highlighted participant and controls to export as SVG or PNG](screenshots/participant-highlight.png)

![A Mermaid sequence diagram beside its source code](screenshots/live-preview.png)

## Funktionen

Leichtgewichtige Mac-App für Markdown mit Mermaid-Diagrammen (`.md`) und reine Mermaid-Dateien (`.mmd`).

- **Code / Beides / Diagramm** umschalten (oben Mitte oder `⌘1 / ⌘2 / ⌘3`)
- **Diagramm → Code:** Element anklicken → Cursor springt zur Zeile
- **Code → Diagramm:** Cursor in eine Zeile setzen (oder mehrere markieren) → Element wird markiert, die Vorschau scrollt mit
- Funktioniert auch für normalen Markdown-Text (Klick auf ein Wort → Zeile)
- Sichert automatisch, übernimmt Änderungen von aussen (z. B. VS Code / Claude Code) live
- Export pro Diagramm: SVG, PNG oder als Bild kopieren (immer im hellen Stil)

## Starten

- **Mermaid Editor.app** doppelklicken – oder in den Programme-Ordner / ins Dock ziehen.
- Dateien aufs App-Symbol ziehen oder im Finder: Rechtsklick → Öffnen mit → Mermaid Editor.
- Aus dem Terminal: `open -a "Mermaid Editor" datei.md`

## Tastenkürzel

| | |
|---|---|
| `⌘N` / `⌘O` | Neues Fenster / Öffnen |
| `⌘S` / `⇧⌘S` | Sichern / Sichern unter |
| `⌘F` | Suchen im Code |
| `⌘1 / ⌘2 / ⌘3` | Code / Beides / Diagramm |
| `⌃⌘S` | Dateien-Seitenleiste |
| `⌘+ / ⌘- / ⌘0` | Diagramme zoomen (auch Pinch) |

## Unterstützte Zuordnung

Sehr genau: Sequenz- (Nachrichten, Notizen, alt/loop/else, Aktivierungen, Teilnehmer),
Flowchart- (Knoten, Kanten, Subgraphs), Klassen-, Zustands- und ER-Diagramme.
Andere Typen (Gantt, Pie, Mindmap, Timeline …) werden über den Text zugeordnet.

## Entwickeln

- Oberfläche: `src/` → gebündelt nach `public/dist/`
- Mac-App: `native/main.swift` (WKWebView, Dateizugriff, Menüs, Dialoge)
- Neu bauen: `npm run app` (braucht Node für das Bündeln und die Xcode Command Line Tools)
- `npm run dev` startet dieselbe Oberfläche zum Debuggen auf `127.0.0.1`. Für den Dateizugriff gib beim Start eine Datei oder einen Ordner an, etwa mit `npm run dev -- ./docs`. Unter macOS kannst du weitere Dateien und Ordner im Öffnen-Dialog auswählen. Die Freigaben gelten bis zum Neustart des lokalen Servers.
