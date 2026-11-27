# Mermaid Editor

A small tool I built for fun to make writing Mermaid diagrams easier. Code on the left, live preview on the right. The UI is available in English and German. Maybe it’ll come in handy or spark an idea!

## Screenshots

![Mermaid code and live preview with the selected message highlighted](screenshots/message-highlight.png)

![A highlighted participant and controls to export as SVG or PNG](screenshots/participant-highlight.png)

![A Mermaid sequence diagram beside its source code](screenshots/live-preview.png)

## Funktionen

Leichtgewichtiger Editor für Markdown mit Mermaid-Diagrammen (`.md`) und reine Mermaid-Dateien (`.mmd`). Verfügbar für macOS und Android.

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

## Android

Die APK läuft ab Android 8 mit aktuellem Android System WebView und rendert Diagramme offline. Öffne lokale Dateien und Ordner über die Android-Dateiauswahl. Wenn Markdown relative Bildpfade enthält, öffne zuerst den Ordner und dann das Dokument in der Seitenleiste. Beim Wechsel zurück zur App prüft der Editor die geöffnete Datei auf externe Änderungen. Diagramme lassen sich als SVG oder PNG speichern. Für PDFs wähle im Android-Druckdialog «Als PDF speichern».

Lade die APK aus dem GitHub-Release herunter und öffne sie auf dem Android-Gerät. Die APK ist für die manuelle Installation signiert. Für ein Update braucht die neue APK denselben Signaturschlüssel wie die bereits installierte Version.

### Datenschutz unter Android

Die App rendert Dokumente auf dem Gerät. Sie hat keine Internetberechtigung und verwendet keine Telemetrie, Werbung oder Benutzerkonten. Dokumententwürfe, Einstellungen und die Liste freigegebener Dateien bleiben im App-Speicher. Die App schliesst diese Daten von Android-Backups und der Gerätemigration aus. Über «Speicherinhalt löschen» in den Android-App-Einstellungen kannst du die lokalen App-Daten und Dateifreigaben entfernen.

Beim Öffnen oder Speichern über die Android-Dateiauswahl gilt der gewählte Dateianbieter, etwa der Gerätespeicher oder ein Cloud-Anbieter. Angeklickte externe Links öffnen sich im Standardbrowser. Beim PDF-Export übernimmt das Android-Drucksystem den Inhalt. «Als Bild kopieren» übergibt das Diagramm an die Android-Zwischenablage und markiert es als sensibel.

## Unterstützte Zuordnung

Sehr genau: Sequenz- (Nachrichten, Notizen, alt/loop/else, Aktivierungen, Teilnehmer),
Flowchart- (Knoten, Kanten, Subgraphs), Klassen-, Zustands- und ER-Diagramme.
Andere Typen (Gantt, Pie, Mindmap, Timeline …) werden über den Text zugeordnet.

## Entwickeln

- Oberfläche: `src/` → gebündelt nach `public/dist/`
- Mac-App: `native/main.swift` (WKWebView, Dateizugriff, Menüs, Dialoge)
- Die Android-App liegt in `android/` und nutzt WebView und die Android-Dateiauswahl. Mit JDK 17, Android SDK Platform 34 und Build Tools 34.0.0 erzeugt `npm ci && npm run android` die Datei `android/build/Mermaid-Editor.apk`. Falls nötig, setze `ANDROID_HOME` auf das SDK.
- Neu bauen: `npm run app` (braucht Node für das Bündeln und die Xcode Command Line Tools)
- `npm run dev` startet dieselbe Oberfläche zum Debuggen auf `127.0.0.1`. Für den Dateizugriff gib beim Start eine Datei oder einen Ordner an, etwa mit `npm run dev -- ./docs`. Unter macOS kannst du weitere Dateien und Ordner im Öffnen-Dialog auswählen. Die Freigaben gelten bis zum Neustart des lokalen Servers.
