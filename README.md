# TextDB

TextDB is a **non-destructive**, completely offline, local-first text editor with built-in Markdown preview and local AI writing tools. Its core promise is simple: your edits never overwrite your history. Every manual save is immutable and append-only, and autosaves are kept as a separate draft layer. With a local Ollama model (recommended: `ministral:3b`), it can convert plain text to Markdown, proofread, summarize, translate, rewrite, change style, or run a custom instruction against a whole text or a selected passage. No accounts, no telemetry, no remote fonts, and no outside network calls.

## Features

- Non-destructive editing: immutable manual saves + safe autosaved drafts.
- Version history panel with quick restore.
- Markdown preview mode with split view, printable output, clickable links, and automatic raw URL detection.
- Local AI tools via Ollama for Markdown conversion, proofreading, summarizing, translation, rewriting, style changes, and custom prompts.
- AI edits can run on the whole text or just the selected part, and results are written back as drafts.
- In-document search with Cmd/Ctrl+F, result highlighting, and next / previous navigation.
- Live document stats in the footer: characters, words, sentences, and estimated tokens.
- Sort your texts in nested folders with expandable tree; move items around via right-click.
- Open/import text files from the file picker or system “Open With”; export to `.txt`, export the database, or print / `.pdf`.
- Settings for theme, text size, line numbers, split view, Ollama connection, and editable AI prompt templates.

## Use cases

- **Non-destructive notepad**: jot ideas without fear of losing earlier thoughts.
- **Safe editor for authors**: keep every revision and compare or roll back at any time.
- **Research notes**: maintain evolving notes with an audit trail of changes.
- **Sensitive drafts**: keep local-only writing with immutable history and zero cloud sync.
- **Prompt or snippet library**: store and iterate on reusable text safely.
- **Offline writing assistant**: run local AI edits without sending text to external services.

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

For local AI tools, install Ollama: `https://ollama.com`

## Autosave + versioning behavior

- Typing triggers a debounced autosave (~600ms) that writes to the draft record.
- Manual saves (Cmd/Ctrl+S or the button) append a new version and clear any draft.
- AI edits preserve the current text state first when needed, then write the AI result back as a new draft.
- Autosave only overwrites the single draft row; manual versions are never overwritten.
- History shows all manual versions plus the current draft (if any).

## Local storage

- SQLite is loaded via `Database.load("sqlite:text.db")`.
- The database file is stored in the Tauri app data directory.
- The app is fully offline by design: no telemetry, no external fonts, no CDNs.
- UI settings (theme, text size, line numbers, split view, sidebar + folder collapse state, last selected text, and AI prompt templates) are stored in localStorage.
