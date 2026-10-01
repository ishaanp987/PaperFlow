import { mkdir, readFile, writeFile, rename, chmod } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { AppError } from "./errors.ts";

export type Settings = { openaiKey: string; model: string; notionKey: string; notionParentId: string };
export const DEFAULT_MODEL = "gpt-4.1-mini";
const defaults: Settings = { openaiKey: "", model: DEFAULT_MODEL, notionKey: "", notionParentId: "" };
export function dataDirectory() { return resolve(process.env.PAPERFLOW_DATA_DIR || join(homedir(), ".paperflow")); }

export function normalizePageId(input: string): string {
  const value = input.trim();
  if (!value) return "";
  const matches = value.replace(/-/g, "").split("?")[0].match(/[a-f0-9]{32}/ig);
  const id = matches?.at(-1);
  if (!id) throw new AppError("Paste a Notion page URL or a valid 32-character page ID.");
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`.toLowerCase();
}

export async function createConfig(directory: string, env: NodeJS.ProcessEnv = process.env) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "settings.json");
  const overrides: Partial<Settings> = {};
  if (env.OPENAI_API_KEY) overrides.openaiKey = env.OPENAI_API_KEY;
  if (env.OPENAI_MODEL) overrides.model = env.OPENAI_MODEL;
  if (env.NOTION_API_KEY) overrides.notionKey = env.NOTION_API_KEY;
  if (env.NOTION_PARENT_PAGE_ID) overrides.notionParentId = normalizePageId(env.NOTION_PARENT_PAGE_ID);
  let saved: Settings = { ...defaults };
  try { saved = { ...defaults, ...JSON.parse(await readFile(path, "utf8")) }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new AppError("Local settings could not be read. Restore or remove settings.json in the PaperFlow data folder.", 500); }
  const read = (): Settings => ({ ...saved, ...overrides });
  const publicSettings = () => {
    const s = read();
    return { openaiConfigured: !!s.openaiKey, notionConfigured: !!s.notionKey, model: s.model, notionParentId: s.notionParentId, environmentFields: Object.keys(overrides), ready: !!(s.openaiKey && s.notionKey && s.notionParentId) };
  };
  const write = async (input: Record<string, unknown>) => {
    const next = { ...saved };
    if (Object.keys(input).some(k => !["openaiKey", "notionKey", "model", "notionParentId"].includes(k))) throw new AppError("Unknown setting.");
    for (const key of Object.keys(input) as (keyof Settings)[]) {
      if (key in overrides) throw new AppError("This setting is controlled by an environment variable. Remove that variable to change it here.");
      const value = input[key];
      if (typeof value !== "string" || value.length > 1024 || /[\r\n\0]/.test(value)) throw new AppError("A setting contains invalid characters.");
      next[key] = value.trim();
    }
    next.notionParentId = normalizePageId(next.notionParentId);
    if (!/^[a-zA-Z0-9._-]{1,100}$/.test(next.model)) throw new AppError("Enter a valid OpenAI model name.");
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
    await rename(temp, path); await chmod(path, 0o600).catch(() => {}); saved = next;
    return publicSettings();
  };
  return { read, write, publicSettings };
}
