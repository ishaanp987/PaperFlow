import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AppError, safeError } from "./errors.ts";
import { createConfig, dataDirectory } from "./config.ts";
import { createStore } from "./storage.ts";
import { validatePdf, MAX_PDF_BYTES, samplePdf } from "./pdf.ts";
import { validateStudy } from "./model.ts";
import { createPipeline } from "./pipeline.ts";
import { createOpenAI, createNotion } from "./providers.ts";
import { flashcardCsv } from "./csv.ts";
import { demoStudy, demoTranscription } from "./demo.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApiFetch } from "./providers.ts";

const publicDirectory = fileURLToPath(new URL("../public/", import.meta.url));
const contentTypes: Record<string, string> = { "index.html": "text/html; charset=utf-8", "app.js": "text/javascript; charset=utf-8", "style.css": "text/css; charset=utf-8", "favicon.svg": "image/svg+xml" };

export async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const length = Number(request.headers["content-length"] || 0);
  if (length > limit) throw new AppError("The upload exceeds the allowed size.", 413);
  const chunks: Buffer[] = []; let total = 0;
  for await (const chunk of request) { total += chunk.length; if (total > limit) throw new AppError("The upload exceeds the allowed size.", 413); chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks);
}

function protect(request: IncomingMessage) {
  const host = request.headers.host || "";
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new AppError("PaperFlow accepts requests from localhost only.", 403);
  const origin = request.headers.origin;
  if (origin && origin !== `http://${host}`) throw new AppError("Requests from other websites are blocked.", 403);
  if (["cross-site", "same-site"].includes(String(request.headers["sec-fetch-site"]))) throw new AppError("Requests from other websites are blocked.", 403);
  if (!["GET", "HEAD"].includes(request.method || "") && !origin) throw new AppError("A matching local Origin header is required.", 403);
}

function headers(response: ServerResponse) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
}
function json(response: ServerResponse, value: unknown, status = 200) { response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); response.end(JSON.stringify(value)); }
async function readJson(request: IncomingMessage) {
  if (request.headers["content-type"]?.split(";")[0] !== "application/json") throw new AppError("Send JSON data.", 415);
  try { return JSON.parse((await readBody(request, 600000)).toString()); }
  catch (error) { if (error instanceof AppError) throw error; throw new AppError("The request contains invalid JSON."); }
}

export async function createApplication(options: { directory?: string; env?: NodeJS.ProcessEnv; apiFetch?: ApiFetch } = {}) {
  const directory = options.directory || dataDirectory();
  const config = await createConfig(directory, options.env || process.env);
  const store = await createStore(directory);
  const pipeline = createPipeline(store, config.read, options.apiFetch);
  let uploading = false;
  const server = createServer(async (request, response) => {
    headers(response);
    try {
      protect(request);
      const url = new URL(request.url || "/", `http://${request.headers.host}`);
      const path = url.pathname; const method = request.method;
      if (method === "GET" && path === "/api/settings") return json(response, config.publicSettings());
      if (method === "POST" && path === "/api/settings") {
        const input = await readJson(request);
        if (!input || typeof input !== "object" || Array.isArray(input)) throw new AppError("Invalid settings.");
        return json(response, await config.write(input));
      }
      if (method === "POST" && path === "/api/settings/test") {
        const { provider } = await readJson(request);
        if (provider === "openai") {
          await createOpenAI(config.read(), options.apiFetch).test();
          return json(response, { message: "Key and model access verified. Handwriting quality and billing will be checked when you process a PDF." });
        }
        if (provider === "notion") {
          await createNotion(config.read(), options.apiFetch).test();
          return json(response, { message: "Destination page access verified. Write and PDF upload permissions are checked during publishing." });
        }
        throw new AppError("Choose OpenAI or Notion.");
      }
      if (method === "GET" && path === "/api/lectures") {
        return json(response, store.list().map(lecture => ({ id: lecture.id, filename: lecture.filename, title: lecture.study?.title || lecture.filename, course: lecture.study?.course || null, date: lecture.study?.date || null, pageCount: lecture.pageCount, status: lecture.status, createdAt: lecture.createdAt, flashcardCount: lecture.study?.flashcards.length || 0, source: lecture.source })));
      }
      if (method === "POST" && path === "/api/lectures") {
        if (uploading) throw new AppError("Another upload is finishing. Try again in a moment.", 409);
        if (request.headers["content-type"]?.split(";")[0] !== "application/pdf") throw new AppError("Upload a PDF.", 415);
        uploading = true;
        try {
          const bytes = await readBody(request, MAX_PDF_BYTES);
          let filename: string;
          try { filename = decodeURIComponent(String(request.headers["x-filename"] || "notes.pdf")); } catch { throw new AppError("Invalid filename."); }
          const valid = await validatePdf(bytes, filename);
          const result = await store.create(bytes, valid.filename, valid.pageCount);
          return json(response, result, result.duplicate ? 200 : 201);
        } finally { uploading = false; }
      }
      if (method === "POST" && path === "/api/demo") {
        if (uploading) throw new AppError("Another upload is finishing. Try again in a moment.", 409);
        uploading = true;
        try {
          const result = await store.create(await samplePdf(), "PaperFlow sample.pdf", 1, "demo");
          if (!result.lecture.study) {
            result.lecture.transcription = structuredClone(demoTranscription); result.lecture.study = structuredClone(demoStudy); result.lecture.status = "ready"; store.save(result.lecture);
          }
          return json(response, result.lecture);
        } finally { uploading = false; }
      }
      const match = path.match(/^\/api\/lectures\/([a-f0-9-]{36})(?:\/(process|publish|pdf|csv))?$/);
      if (match) {
        const [, id, action] = match;
        const lecture = store.requireLecture(id);
        if (method === "GET" && !action) return json(response, lecture);
        if (method === "POST" && !action) {
          if (lecture.publishStarted || ["extracting", "generating"].includes(lecture.status)) throw new AppError("This guide is locked because processing or publishing has started.", 409);
          const input = await readJson(request);
          lecture.study = validateStudy(input, lecture.pageCount); store.save(lecture); return json(response, lecture);
        }
        if (method === "POST" && action === "process") { await readJson(request); return json(response, await pipeline.processLecture(id)); }
        if (method === "POST" && action === "publish") { await readJson(request); return json(response, await pipeline.publishLecture(id)); }
        if (method === "GET" && action === "pdf") {
          response.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="notes.pdf"; filename*=UTF-8''${encodeURIComponent(lecture.filename)}` }); return response.end(await store.pdf(id));
        }
        if (method === "GET" && action === "csv") {
          if (!lecture.study) throw new AppError("No flashcards have been generated yet.", 409);
          response.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=paperflow-flashcards.csv" }); return response.end(flashcardCsv(lecture.study.flashcards));
        }
      }
      if (method === "GET" || method === "HEAD") {
        const name = path === "/" ? "index.html" : path.slice(1);
        if (Object.hasOwn(contentTypes, name)) {
          const body = await readFile(join(publicDirectory, name));
          response.writeHead(200, { "Content-Type": contentTypes[name] }); return response.end(method === "HEAD" ? undefined : body);
        }
      }
      throw new AppError("Page not found.", 404);
    } catch (error) {
      if (!response.headersSent) { const safe = safeError(error); json(response, { error: safe.message, code: safe.code }, safe.status); }
      else response.end();
    }
  });
  server.requestTimeout = 300000;
  server.on("close", () => store.close());
  return { server, store, config, pipeline };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 24) { console.error("PaperFlow requires Node.js 24 or newer. Install it from https://nodejs.org/"); process.exit(1); }
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error("PORT must be a number between 1 and 65535."); process.exit(1); }
  const { server } = await createApplication();
  server.on("error", () => { console.error("PaperFlow could not start. Check whether the port is already in use."); process.exitCode = 1; });
  server.listen(port, "127.0.0.1", () => console.log(`PaperFlow is ready at http://127.0.0.1:${port}\nOpen Settings to enter your keys. Your data stays in ${dataDirectory()}.`));
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close(() => process.exit(0)));
}
