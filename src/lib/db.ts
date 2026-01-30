import Database from "@tauri-apps/plugin-sql";

export type Text = {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  last_saved_version_id: string | null;
};

export type TextVersion = {
  id: string;
  prompt_id: string;
  body: string;
  created_at: number;
  kind: "manual" | "autosave";
  note: string | null;
};

export type TextDraft = {
  prompt_id: string;
  body: string;
  updated_at: number;
  base_version_id: string | null;
};

const MIGRATIONS = [
  "PRAGMA foreign_keys = ON;",
  `CREATE TABLE IF NOT EXISTS prompts(
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_saved_version_id TEXT
  );`,
  `CREATE TABLE IF NOT EXISTS prompt_versions(
    id TEXT PRIMARY KEY,
    prompt_id TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('manual','autosave')),
    note TEXT,
    FOREIGN KEY(prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS prompt_drafts(
    prompt_id TEXT PRIMARY KEY,
    body TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    base_version_id TEXT,
    FOREIGN KEY(prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
  );`,
  "CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt_time ON prompt_versions(prompt_id, created_at DESC);",
  "CREATE INDEX IF NOT EXISTS idx_prompts_updated ON prompts(updated_at DESC);"
];

let dbPromise: Promise<Database> | null = null;

async function migrate(db: Database) {
  for (const statement of MIGRATIONS) {
    await db.execute(statement);
  }
}

export async function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await Database.load("sqlite:text.db");
      await migrate(db);
      return db;
    })();
  }
  return dbPromise;
}

export async function initDb() {
  await getDb();
}

export async function listTexts(): Promise<Text[]> {
  const db = await getDb();
  const rows = await db.select<Text[]>(
    "SELECT * FROM prompts ORDER BY updated_at DESC"
  );
  return rows;
}

export async function searchTexts(term: string): Promise<Text[]> {
  const db = await getDb();
  const normalized = `%${term.toLowerCase()}%`;
  const rows = await db.select<Text[]>(
    `SELECT p.*
     FROM prompts p
     WHERE LOWER(p.title) LIKE $1
        OR EXISTS (
          SELECT 1
          FROM prompt_versions v
          WHERE v.prompt_id = p.id
            AND LOWER(v.body) LIKE $1
        )
     ORDER BY p.updated_at DESC`,
    [normalized]
  );
  return rows;
}

export async function getText(promptId: string): Promise<Text | null> {
  const db = await getDb();
  const rows = await db.select<Text[]>(
    "SELECT * FROM prompts WHERE id = $1 LIMIT 1",
    [promptId]
  );
  return rows[0] ?? null;
}

export async function getLatestManualVersion(
  promptId: string
): Promise<TextVersion | null> {
  const db = await getDb();
  const rows = await db.select<TextVersion[]>(
    "SELECT * FROM prompt_versions WHERE prompt_id = $1 AND kind = 'manual' ORDER BY created_at DESC LIMIT 1",
    [promptId]
  );
  return rows[0] ?? null;
}

export async function listVersions(
  promptId: string
): Promise<TextVersion[]> {
  const db = await getDb();
  return db.select<TextVersion[]>(
    "SELECT * FROM prompt_versions WHERE prompt_id = $1 ORDER BY created_at DESC",
    [promptId]
  );
}

export async function getDraft(promptId: string): Promise<TextDraft | null> {
  const db = await getDb();
  const rows = await db.select<TextDraft[]>(
    "SELECT * FROM prompt_drafts WHERE prompt_id = $1 LIMIT 1",
    [promptId]
  );
  return rows[0] ?? null;
}

export async function createText(
  title: string,
  body: string
): Promise<{ textId: string; versionId: string; createdAt: number }> {
  const db = await getDb();
  const now = Date.now();
  const textId = crypto.randomUUID();
  const versionId = crypto.randomUUID();

  await db.execute(
    "INSERT INTO prompts(id, title, created_at, updated_at, last_saved_version_id) VALUES($1, $2, $3, $4, $5)",
    [textId, title, now, now, versionId]
  );

  await db.execute(
    "INSERT INTO prompt_versions(id, prompt_id, body, created_at, kind, note) VALUES($1, $2, $3, $4, 'manual', NULL)",
    [versionId, textId, body, now]
  );

  await db.execute("DELETE FROM prompt_drafts WHERE prompt_id = $1", [textId]);

  return { textId, versionId, createdAt: now };
}

export async function saveManualVersion(
  promptId: string,
  title: string,
  body: string
): Promise<{ versionId: string; savedAt: number }> {
  const db = await getDb();
  const now = Date.now();
  const versionId = crypto.randomUUID();

  await db.execute(
    "INSERT INTO prompt_versions(id, prompt_id, body, created_at, kind, note) VALUES($1, $2, $3, $4, 'manual', NULL)",
    [versionId, promptId, body, now]
  );

  await db.execute(
    "UPDATE prompts SET title = $1, updated_at = $2, last_saved_version_id = $3 WHERE id = $4",
    [title, now, versionId, promptId]
  );

  await db.execute("DELETE FROM prompt_drafts WHERE prompt_id = $1", [promptId]);

  return { versionId, savedAt: now };
}

export async function updateTextTitle(
  promptId: string,
  title: string
) {
  const db = await getDb();
  const now = Date.now();
  await db.execute("UPDATE prompts SET title = $1, updated_at = $2 WHERE id = $3", [
    title,
    now,
    promptId
  ]);
}

export async function upsertDraft(
  promptId: string,
  body: string,
  baseVersionId: string | null
) {
  const db = await getDb();
  const now = Date.now();
  await db.execute(
    `INSERT INTO prompt_drafts(prompt_id, body, updated_at, base_version_id)
     VALUES($1, $2, $3, $4)
     ON CONFLICT(prompt_id) DO UPDATE SET
       body = excluded.body,
       updated_at = excluded.updated_at,
       base_version_id = excluded.base_version_id`,
    [promptId, body, now, baseVersionId]
  );
}

export async function discardDraft(promptId: string) {
  const db = await getDb();
  await db.execute("DELETE FROM prompt_drafts WHERE prompt_id = $1", [promptId]);
}

export async function deleteText(promptId: string) {
  const db = await getDb();
  await db.execute("DELETE FROM prompts WHERE id = $1", [promptId]);
}

export async function deleteTextVersion(promptId: string, versionId: string) {
  const db = await getDb();
  await db.execute("DELETE FROM prompt_versions WHERE id = $1", [versionId]);

  const promptRows = await db.select<{ last_saved_version_id: string | null }[]>(
    "SELECT last_saved_version_id FROM prompts WHERE id = $1 LIMIT 1",
    [promptId]
  );
  const currentLastSaved = promptRows[0]?.last_saved_version_id ?? null;
  if (currentLastSaved !== versionId) return;

  const nextRows = await db.select<{ id: string }[]>(
    "SELECT id FROM prompt_versions WHERE prompt_id = $1 AND kind = 'manual' ORDER BY created_at DESC LIMIT 1",
    [promptId]
  );
  const nextId = nextRows[0]?.id ?? null;

  await db.execute(
    "UPDATE prompts SET last_saved_version_id = $1 WHERE id = $2",
    [nextId, promptId]
  );
}
