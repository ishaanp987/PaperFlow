import { DatabaseSync } from "node:sqlite";
import { mkdir, chmod, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { AppError } from "./errors.ts";
import type { Lecture } from "./model.ts";

export async function createStore(directory: string) {
  await mkdir(join(directory, "uploads"), { recursive: true, mode: 0o700 });
  const databasePath = join(directory, "paperflow.sqlite");
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS lectures (id TEXT PRIMARY KEY, hash TEXT UNIQUE NOT NULL, record TEXT NOT NULL); CREATE TABLE IF NOT EXISTS courses (parent_id TEXT NOT NULL, name TEXT NOT NULL, page_id TEXT NOT NULL, PRIMARY KEY(parent_id, name));");
  await chmod(databasePath, 0o600).catch(() => {});
  const decode = (row: unknown): Lecture | null => row ? JSON.parse((row as { record: string }).record) : null;
  const get = (id: string) => decode(db.prepare("SELECT record FROM lectures WHERE id = ?").get(id));
  const requireLecture = (id: string) => { const record = get(id); if (!record) throw new AppError("Lecture not found.", 404); return record; };
  const save = (lecture: Lecture) => {
    lecture.updatedAt = new Date().toISOString();
    db.prepare("INSERT INTO lectures(id, hash, record) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET record = excluded.record").run(lecture.id, lecture.hash, JSON.stringify(lecture));
    return lecture;
  };
  const list = () => (db.prepare("SELECT record FROM lectures ORDER BY rowid DESC").all()).map(decode) as Lecture[];
  // A process restart cannot leave a lecture permanently spinning.
  for (const lecture of list()) {
    if (["extracting", "generating", "publishing"].includes(lecture.status)) {
      lecture.status = lecture.status === "publishing" ? "partial" : "processing_error";
      lecture.error = "The app stopped before this step finished. You can retry safely."; save(lecture);
    }
  }
  return {
    get, requireLecture, save, list,
    findHash: (hash: string) => decode(db.prepare("SELECT record FROM lectures WHERE hash = ?").get(hash)),
    pdf: (id: string) => readFile(join(directory, "uploads", `${requireLecture(id).id}.pdf`)),
    create: async (pdf: Uint8Array, filename: string, pageCount: number, source: "manual" | "demo" = "manual") => {
      const hash = (source === "demo" ? "demo:" : "") + createHash("sha256").update(pdf).digest("hex");
      const existing = decode(db.prepare("SELECT record FROM lectures WHERE hash = ?").get(hash));
      if (existing) return { lecture: existing, duplicate: true };
      const id = randomUUID(); const now = new Date().toISOString();
      await writeFile(join(directory, "uploads", `${id}.pdf`), pdf, { mode: 0o600, flag: "wx" });
      const lecture: Lecture = { id, hash, filename, pageCount, bytes: pdf.length, createdAt: now, updatedAt: now, source, status: "uploaded", error: null, transcription: null, study: null, model: null, usage: { input: 0, output: 0 }, notionParentId: null, coursePageId: null, notionPageId: null, notionUrl: null, fileAttached: false, publishStarted: false };
      save(lecture); return { lecture, duplicate: false };
    },
    course: (parent: string, course: string) => (db.prepare("SELECT page_id FROM courses WHERE parent_id = ? AND name = ?").get(parent, course) as { page_id: string } | undefined)?.page_id,
    saveCourse: (parent: string, course: string, id: string) => db.prepare("INSERT OR REPLACE INTO courses VALUES (?, ?, ?)").run(parent, course, id),
    close: () => db.close(),
  };
}
export type Store = Awaited<ReturnType<typeof createStore>>;
