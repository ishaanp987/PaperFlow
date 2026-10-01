import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createConfig, normalizePageId } from "../src/config.ts";
import { createStore } from "../src/storage.ts";
import { samplePdf, validatePdf } from "../src/pdf.ts";
import { validateStudy, validateTranscription } from "../src/model.ts";
import { demoStudy, demoTranscription } from "../src/demo.ts";
import { flashcardCsv } from "../src/csv.ts";
import { safeError } from "../src/errors.ts";
const { PDFDocument } = createRequire(import.meta.url)("../vendor/pdf-lib.cjs");

test("PDF validation parses a real file and strips path components", async () => {
  const pdf = await samplePdf(); const result = await validatePdf(pdf, "../../functions.pdf");
  assert.equal(result.pageCount,1); assert.equal(result.filename,"functions.pdf");
});
test("PDF validation rejects renamed files, empty data, corrupt PDFs and excessive page counts", async () => {
  await assert.rejects(validatePdf(Buffer.from('not a pdf with content'), 'notes.pdf'));
  await assert.rejects(validatePdf(new Uint8Array(), 'empty.pdf'));
  await assert.rejects(validatePdf(Buffer.from('%PDF-1.7 corrupt data'), 'corrupt.pdf'));
  await assert.rejects(validatePdf(await samplePdf(), 'notes.txt'));
  const pdf = await PDFDocument.create(); for(let i=0;i<31;i++) pdf.addPage();
  await assert.rejects(validatePdf(await pdf.save(), 'long.pdf'), /30 pages/);
});
test("study validation rejects invented page references, malformed dates and oversized content", () => {
  assert.deepEqual(validateStudy(demoStudy,1),demoStudy);
  const guide = structuredClone(demoStudy); guide.flashcards[0].sourcePages = [2]; assert.throws(() => validateStudy(guide,1));
  guide.flashcards[0].sourcePages = [1]; guide.date = '2026-02-30'; assert.throws(() => validateStudy(guide,1));
  guide.date = null; guide.summary = 'a'.repeat(8001); assert.throws(() => validateStudy(guide,1));
  const extra = {...demoStudy,secret:'unexpected'}; assert.throws(() => validateStudy(extra,1));
});
test("transcription requires ordered physical pages and readable content", () => {
  assert.deepEqual(validateTranscription(demoTranscription,1),demoTranscription);
  assert.throws(() => validateTranscription(demoTranscription,2));
  assert.throws(() => validateTranscription({pages:[{page:1,text:'',diagrams:[],uncertainties:[]}]},1),/No readable/);
});
test("CSV uses Anki metadata and roundtrips quotes, commas and newlines", () => {
  const csv = flashcardCsv([{front:'What is "domain", exactly?',back:'First line\nSecond, line',sourcePages:[1]}]);
  assert.equal(csv,'#separator:Comma\n#html:false\n#columns:Front,Back\n"What is ""domain"", exactly?","First line\nSecond, line"\n');
  assert.equal(flashcardCsv([]),'#separator:Comma\n#html:false\n#columns:Front,Back\n\n');
});
test("credentials are persisted but never returned; blank removal and environment precedence work", async () => {
  const dir = await mkdtemp(join(tmpdir(),'paperflow-config-'));
  try {
    const config = await createConfig(dir,{});
    const result = await config.write({openaiKey:'sk-test-secret',notionKey:'ntn-test-secret',notionParentId:'https://www.notion.so/PaperFlow-0123456789abcdef0123456789abcdef?pvs=4'});
    assert.equal(result.ready,true); assert.equal(JSON.stringify(result).includes('test-secret'),false);
    assert.equal((await createConfig(dir,{})).read().openaiKey,'sk-test-secret');
    await config.write({openaiKey:''}); assert.equal(config.publicSettings().openaiConfigured,false);
    const overridden = await createConfig(dir,{OPENAI_API_KEY:'env-secret'});
    assert.equal(overridden.read().openaiKey,'env-secret');
    await assert.rejects(overridden.write({openaiKey:'overwrite'}),/environment variable/);
    assert.equal(JSON.stringify(overridden.publicSettings()).includes('env-secret'),false);
    await assert.rejects(config.write({openaiKey:'bad\nheader'}));
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test("Notion page URL normalization accepts IDs and rejects missing IDs", () => {
  assert.equal(normalizePageId('0123456789abcdef0123456789abcdef'),'01234567-89ab-cdef-0123-456789abcdef');
  assert.throws(() => normalizePageId('https://notion.so/just-a-title'));
});
test("saved lecture edits survive restart and duplicate PDFs resolve to one record", async () => {
  const dir = await mkdtemp(join(tmpdir(),'paperflow-store-')); let store = await createStore(dir);
  try {
    const pdf = await samplePdf(); const first = await store.create(pdf,'lecture.pdf',1); const second = await store.create(pdf,'renamed.pdf',1);
    assert.equal(second.duplicate,true); assert.equal(first.lecture.id,second.lecture.id);
    const demo = await store.create(pdf,'demo.pdf',1,'demo'); assert.notEqual(demo.lecture.id,first.lecture.id);
    first.lecture.study = structuredClone(demoStudy); first.lecture.study.summary = 'User-edited summary'; first.lecture.status = 'ready'; store.save(first.lecture);
    store.close(); store = await createStore(dir); assert.equal(store.requireLecture(first.lecture.id).study!.summary,'User-edited summary');
    assert.deepEqual(await store.pdf(first.lecture.id),Buffer.from(pdf));
  } finally { store.close(); await rm(dir,{recursive:true,force:true}); }
});
test("interrupted processing and publishing become retryable after restart", async () => {
  const dir = await mkdtemp(join(tmpdir(),'paperflow-recovery-')); let store = await createStore(dir);
  try {
    const lecture = (await store.create(await samplePdf(),'notes.pdf',1)).lecture;
    lecture.status = 'publishing'; lecture.publishStarted = true; store.save(lecture); store.close(); store = await createStore(dir);
    assert.equal(store.requireLecture(lecture.id).status,'partial'); assert.match(store.requireLecture(lecture.id).error!,/stopped/);
  } finally { store.close(); await rm(dir,{recursive:true,force:true}); }
});
test("unexpected errors never expose raw secrets or provider bodies", () => {
  assert.equal(safeError(new Error('sk-sensitive-key')).message.includes('sk-sensitive'),false);
});
