# Architecture

PaperFlow is a local single-process application. Node.js 24 supplies the HTTP server, TypeScript type stripping, SQLite, and HTTP client. The browser uses ordinary JavaScript and CSS; no external CDN or package installation is needed at runtime.

## Modules

| Module | Responsibility |
| --- | --- |
| `src/server.ts` | Loopback HTTP server, request protection, routes, bounded uploads |
| `src/config.ts` | Persist credentials outside the repository, environment overrides, redacted public settings |
| `src/pdf.ts` | Parse/validate PDFs, enforce file/page limits, produce synthetic sample |
| `src/storage.ts` | Lecture records, course mapping, PDF storage, restart recovery |
| `src/model.ts` | Domain types, strict JSON schemas, runtime validation |
| `src/providers.ts` | OpenAI Responses requests and Notion REST/file-upload operations |
| `src/pipeline.ts` | Durable processing stages, publication serialization and reconciliation |
| `src/csv.ts` | Anki-compatible UTF-8 text export |
| `public/` | Library, Settings, review/editor and progress UI |

The PDF validation boundary returns `{ filename, pageCount }`. The ingestion storage boundary accepts bytes, a sanitized filename, page count, and source and returns `{ lecture, duplicate }`. Future source adapters should invoke these boundaries before processing. They must not bypass validation, deduplication, or explicit publication consent.

## Processing and recovery

`uploaded → extracting → generating → ready → publishing → published`

Extraction or generation failure produces `processing_error`. The transcription is saved before generation so retries can reuse it. Publication failure produces `partial`. On startup, interrupted processing becomes `processing_error` and interrupted publishing becomes `partial`.

Each lecture has an immutable ID, a unique content hash, original PDF, structured transcription, editable study guide, token counts, timestamps, errors, publishing state, and saved Notion page identifiers. Demo hashes occupy a separate namespace to prevent prewritten demo output from appearing on an uploaded user PDF.

Notion page creation contains the guide and source marker in one request. Before creating a lecture page, retry logic scans the course's children for that source marker. Before attaching a PDF it checks for the attachment caption marker. This recovers a successful remote mutation whose response was lost. Providers are not automatically retried during mutations. Publishing operations are serialized in-process to avoid simultaneous course creation. This design assumes one PaperFlow server uses the data folder at a time. Notion cannot provide a cross-system transaction; eventual consistency, manually removed markers, or running multiple servers against the same destination can still undermine reconciliation.

Once publishing begins, guide edits are locked so every retry sends the same reviewed version. Published page updates are deliberately outside this first release.

## HTTP routes

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/settings` | Non-secret settings and configured flags |
| POST | `/api/settings` | Save only provided settings; empty secret explicitly removes it |
| POST | `/api/settings/test` | Verify OpenAI model access or Notion destination readability |
| GET | `/api/lectures` | Library summaries |
| POST | `/api/lectures` | Raw PDF body, `X-Filename` URI-encoded header; validated saved record |
| GET | `/api/lectures/:id` | Saved lecture |
| POST | `/api/lectures/:id` | Save a validated edited guide before publication |
| POST | `/api/lectures/:id/process` | Run extraction/generation and return final record |
| POST | `/api/lectures/:id/publish` | Run or retry publication and return final record |
| GET | `/api/lectures/:id/pdf` | Original PDF |
| GET | `/api/lectures/:id/csv` | CSV from saved edited cards |
| POST | `/api/demo` | Explicitly labeled prewritten sample |

Mutation routes require a matching local Origin header. JSON routes require `application/json`; the upload route requires `application/pdf`. HTTP error responses use safe messages without provider bodies. UI progress polls the persisted lecture status while the long request runs.

## Extension points

New sources should return PDF bytes plus filename and source metadata through the validation/ingestion boundary. Add source types when implementing the adapter. Reuse processing and expose original source provenance in the review UI.

AnkiConnect can be implemented as a separate exporter consuming the edited `StudyGuide.flashcards`; keep the CSV exporter available. Its local endpoint must be explicitly configured and should not be automatically invoked merely by creating cards.

Cloud deployment needs a separate design for authentication, per-user data isolation, secret storage, queues, and durable object storage. The current loopback server is not a hosted multi-user application.
