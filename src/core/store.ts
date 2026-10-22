/**
 * Chat history storage in <Zotero data dir>/zoteropi.sqlite.
 * Sessions belong to a paper (libraryID + item key of the parent item).
 */
export interface SessionMeta {
  id: string;
  libraryID: number;
  itemKey: string;
  paperTitle: string;
  title: string;
  conclusion: string;
  model: string;
  created: number;
  updated: number;
  messageCount: number;
}

let db: any = null;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sessions (
     id TEXT PRIMARY KEY,
     libraryID INT NOT NULL,
     itemKey TEXT NOT NULL,
     paperTitle TEXT NOT NULL DEFAULT '',
     title TEXT NOT NULL DEFAULT '',
     conclusion TEXT NOT NULL DEFAULT '',
     model TEXT NOT NULL DEFAULT '',
     created INT NOT NULL,
     updated INT NOT NULL,
     messageCount INT NOT NULL DEFAULT 0
   )`,
  `CREATE INDEX IF NOT EXISTS sessions_paper ON sessions(libraryID, itemKey)`,
  `CREATE TABLE IF NOT EXISTS messages (
     sessionID TEXT NOT NULL,
     seq INT NOT NULL,
     role TEXT NOT NULL,
     data TEXT NOT NULL,
     created INT NOT NULL,
     PRIMARY KEY (sessionID, seq)
   )`,
  `CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)`,
];

export async function openStore(): Promise<void> {
  if (db) return;
  db = new Zotero.DBConnection("zoteropi");
  for (const sql of SCHEMA) await db.queryAsync(sql);
}

export async function closeStore(): Promise<void> {
  if (!db) return;
  try {
    await db.closeDatabase(true);
  } catch (e) {
    Zotero.logError(e);
  }
  db = null;
}

function rowToMeta(r: any): SessionMeta {
  return {
    id: r.id,
    libraryID: r.libraryID,
    itemKey: r.itemKey,
    paperTitle: r.paperTitle,
    title: r.title,
    conclusion: r.conclusion,
    model: r.model,
    created: r.created,
    updated: r.updated,
    messageCount: r.messageCount,
  };
}

const META_COLS = "id, libraryID, itemKey, paperTitle, title, conclusion, model, created, updated, messageCount";

export function newSessionID(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function createSession(meta: Omit<SessionMeta, "created" | "updated" | "messageCount">): Promise<SessionMeta> {
  const now = Date.now();
  await db.queryAsync(
    `INSERT INTO sessions (id, libraryID, itemKey, paperTitle, title, conclusion, model, created, updated, messageCount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [meta.id, meta.libraryID, meta.itemKey, meta.paperTitle, meta.title, meta.conclusion, meta.model, now, now],
  );
  return { ...meta, created: now, updated: now, messageCount: 0 };
}

export async function getSession(id: string): Promise<SessionMeta | null> {
  const rows = await db.queryAsync(`SELECT ${META_COLS} FROM sessions WHERE id = ?`, [id]);
  return rows.length ? rowToMeta(rows[0]) : null;
}

export async function listSessionsForPaper(libraryID: number, itemKey: string): Promise<SessionMeta[]> {
  const rows = await db.queryAsync(
    `SELECT ${META_COLS} FROM sessions WHERE libraryID = ? AND itemKey = ? ORDER BY updated DESC`,
    [libraryID, itemKey],
  );
  return rows.map(rowToMeta);
}

export async function searchSessions(opts: { query?: string; excludeItemKey?: string; limit?: number }): Promise<SessionMeta[]> {
  const where: string[] = ["messageCount > 0"];
  const params: any[] = [];
  if (opts.excludeItemKey) {
    where.push("itemKey != ?");
    params.push(opts.excludeItemKey);
  }
  if (opts.query) {
    const like = `%${opts.query.replace(/[%_]/g, "")}%`;
    where.push(
      `(title LIKE ? OR conclusion LIKE ? OR paperTitle LIKE ? OR id IN (SELECT sessionID FROM messages WHERE data LIKE ? AND role IN ('user','assistant')))`,
    );
    params.push(like, like, like, like);
  }
  params.push(opts.limit || 20);
  const rows = await db.queryAsync(
    `SELECT ${META_COLS} FROM sessions WHERE ${where.join(" AND ")} ORDER BY updated DESC LIMIT ?`,
    params,
  );
  return rows.map(rowToMeta);
}

export async function updateSession(id: string, patch: Partial<Pick<SessionMeta, "title" | "conclusion" | "model" | "paperTitle">>): Promise<void> {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  await db.queryAsync(
    `UPDATE sessions SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated = ? WHERE id = ?`,
    [...keys.map((k) => (patch as any)[k]), Date.now(), id],
  );
}

export async function deleteSession(id: string): Promise<void> {
  await db.executeTransaction(async () => {
    await db.queryAsync(`DELETE FROM messages WHERE sessionID = ?`, [id]);
    await db.queryAsync(`DELETE FROM sessions WHERE id = ?`, [id]);
  });
}

export async function loadMessages(sessionID: string): Promise<any[]> {
  const rows = await db.queryAsync(`SELECT data FROM messages WHERE sessionID = ? ORDER BY seq`, [sessionID]);
  const out: any[] = [];
  for (const r of rows) {
    try {
      out.push(JSON.parse(r.data));
    } catch {
      // skip corrupt row
    }
  }
  return out;
}

/** Replace messages from index `from` onward with `messages.slice(from)`. */
export async function saveMessages(sessionID: string, messages: any[], from: number): Promise<void> {
  const now = Date.now();
  await db.executeTransaction(async () => {
    await db.queryAsync(`DELETE FROM messages WHERE sessionID = ? AND seq >= ?`, [sessionID, from]);
    for (let i = from; i < messages.length; i++) {
      const m = messages[i];
      await db.queryAsync(`INSERT INTO messages (sessionID, seq, role, data, created) VALUES (?, ?, ?, ?, ?)`, [
        sessionID,
        i,
        m.role,
        JSON.stringify(m),
        m.timestamp || now,
      ]);
    }
    await db.queryAsync(`UPDATE sessions SET messageCount = ?, updated = ? WHERE id = ?`, [messages.length, now, sessionID]);
  });
}

export async function kvGet(key: string): Promise<string | null> {
  const v = await db.valueQueryAsync(`SELECT value FROM kv WHERE key = ?`, [key]);
  return v === false || v === undefined ? null : v;
}

export async function kvSet(key: string, value: string): Promise<void> {
  await db.queryAsync(`INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)`, [key, value]);
}
