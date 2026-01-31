# TextDB

TextDB is a **non-destructive**, completely offline, local-first text editor. Its core promise is simple: your edits never overwrite your history. Every manual save is immutable and append-only, and autosaves are kept as a separate draft layer. No accounts, no telemetry, no remote fonts, and no network calls.

## Features

- Non-destructive editing: manual saves are immutable; drafts never overwrite manual versions.
- Sidebar list of texts with live search (titles + version bodies).
- Editor with title, content area, and clear save status.
- Cmd/Ctrl+S creates a new immutable manual version.
- Markdown preview mode with external link support and printable output.
- Tab toggles Edit/Preview mode.
- Autosave draft (debounced) that can be safely discarded.
- History panel listing versions by timestamp (drafts included when present).
- Settings: theme (default/bright), text size slider, and optional line numbers.
- Collapsible sidebar with persistent state.
- Export the current text to a `.txt` file.
- Open `.txt` or `.md` files to create new entries from file content.
- Drag and drop `.txt` or `.md` files onto the window to import them.
- Registers `.txt` and `.md` file associations for using TextDB as a default editor.

## Use cases

- **Non-destructive notepad**: jot ideas without fear of losing earlier thoughts.
- **Safe editor for authors**: keep every revision and compare or roll back at any time.
- **Research notes**: maintain evolving notes with an audit trail of changes.
- **Sensitive drafts**: keep local-only writing with immutable history and zero cloud sync.
- **Prompt or snippet library**: store and iterate on reusable text safely.

## Tech stack

- Tauri v2
- React + Vite + TypeScript
- SQLite via `@tauri-apps/plugin-sql`

## Install & run

1) Install dependencies:

```
npm install
```

2) Start the app:

```
npm run tauri dev
```

## Autosave + versioning behavior

- Typing triggers a debounced autosave (~600ms) that writes to the draft record.
- Manual saves (Cmd/Ctrl+S or the button) append a new version and clear any draft.
- Autosave only overwrites the single draft row; manual versions are never overwritten.
- History shows all manual versions plus the current draft (if any).

## Local storage

- SQLite is loaded via `Database.load("sqlite:text.db")`.
- The database file is stored in the Tauri app data directory.
- The app is fully offline by design: no telemetry, no external fonts, no CDNs.
- UI settings (theme, text size, line numbers, sidebar state, last selected text) are stored in localStorage.
