# TextDB

TextDB is a **non-destructive**, completely offline, local-first text editor with built-in Markdown preview **and local AI conversion**. Its core promise is simple: your edits never overwrite your history. Every manual save is immutable and append-only, and autosaves are kept as a separate draft layer. It can also convert plain text to Markdown using a local Ollama model (recommended: `ministral:3b`). No accounts, no telemetry, no remote fonts, and no network calls.

## Features

- Non-destructive editing: immutable manual saves + safe autosaved drafts.
- Version history panel with quick restore.
- Markdown preview mode with split view.
- Convert plain text to Markdown via local Ollama (recommended model: `ministral:3b`).
- Sort your texts in nested folders with expandable tree; move items around via right-click.
- Open/import `.txt` and `.md` files; export to `.txt` or print / `.pdf`.
- Settings for theme, text size, and optional display of line numbers in the textarea.

Ollama: `https://ollama.com`

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
- UI settings (theme, text size, line numbers, sidebar + folder collapse state, last selected text) are stored in localStorage.
