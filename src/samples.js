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

const NEW_EN = `# New document

\`\`\`mermaid
sequenceDiagram
  actor U as User
  participant C as Client
  participant S as Server
  U->>C: Action
  activate C
  C->>S: Request
  S-->>C: Response
  deactivate C
\`\`\`
`;

const WELCOME_EN = `# Welcome to Mermaid Editor

Click an element in the diagram to jump to its source line.
Place the cursor on a line to highlight the corresponding element.

\`\`\`mermaid
---
title: Sequence diagram example
---
sequenceDiagram
  actor U as User
  participant C as :Client
  participant S as :Server
  U-)C: Print / Sync
  activate C
  C->>C: Preflight check
  alt Valid data
    C-)S: Check transfer
    activate S
    Note over S: Save
    S--)C: Code 0
    deactivate S
  else Error
    C-)U: Notification
  end
  deactivate C
\`\`\`

\`\`\`mermaid
flowchart LR
  A[Start] --> B{Valid?}
  B -->|yes| C[Save]
  B -->|no| D[Report error]
  D --> A
\`\`\`

Open: **⌘O** · Save: **⌘S** · View: **Ctrl+1 / 2 / 3**
`;

export const samples = {
  de: { newDoc: SAMPLE_NEW, welcome: SAMPLE_WELCOME },
  en: { newDoc: NEW_EN, welcome: WELCOME_EN },
};
