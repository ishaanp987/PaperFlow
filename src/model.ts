import { AppError } from "./errors.ts";

export type SourceItem = { sourcePages: number[] };
export type Flashcard = SourceItem & { front: string; back: string };
export type StudyGuide = {
  course: string; title: string; date: string | null; cleanedNotes: string; summary: string;
  keyConcepts: (SourceItem & { title: string; explanation: string })[];
  definitions: (SourceItem & { term: string; meaning: string })[];
  formulas: (SourceItem & { expression: string; explanation: string })[];
  reviewPoints: string[]; flashcards: Flashcard[];
};
export type Transcription = { pages: { page: number; text: string; diagrams: string[]; uncertainties: string[] }[] };
export type LectureStatus = "uploaded" | "extracting" | "generating" | "ready" | "processing_error" | "publishing" | "partial" | "published";
export type Lecture = {
  id: string; hash: string; filename: string; pageCount: number; bytes: number;
  createdAt: string; updatedAt: string; status: LectureStatus; error: string | null;
  transcription: Transcription | null; study: StudyGuide | null;
  source: "manual" | "demo"; model: string | null; usage: { input: number; output: number };
  notionParentId: string | null; coursePageId: string | null; notionPageId: string | null;
  notionUrl: string | null; fileAttached: boolean; publishStarted: boolean;
};

const string = { type: "string" };
const strings = { type: "array", items: string };
const sourcePages = { type: "array", items: { type: "integer" } };
function object(properties: Record<string, unknown>) {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}
export const transcriptionSchema = object({ pages: { type: "array", items: object({ page: { type: "integer" }, text: string, diagrams: strings, uncertainties: strings }) } });
export const studySchema = object({
  course: string, title: string, date: { type: ["string", "null"] }, cleanedNotes: string, summary: string,
  keyConcepts: { type: "array", items: object({ title: string, explanation: string, sourcePages }) },
  definitions: { type: "array", items: object({ term: string, meaning: string, sourcePages }) },
  formulas: { type: "array", items: object({ expression: string, explanation: string, sourcePages }) },
  reviewPoints: strings, flashcards: { type: "array", items: object({ front: string, back: string, sourcePages }) },
});

function checkObject(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !(key in value))) fail();
}
function fail(): never { throw new AppError("The study content has an invalid shape or exceeds the allowed length. Check the fields and try again.", 422, "invalid_content"); }
function text(value: unknown, max: number, required = false): asserts value is string {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) fail();
}
function array(value: unknown, max: number): asserts value is unknown[] { if (!Array.isArray(value) || value.length > max) fail(); }
function pages(value: unknown, count: number) { array(value, count); value.forEach(n => { if (!Number.isInteger(n) || Number(n) < 1 || Number(n) > count) fail(); }); }

export function validateTranscription(value: unknown, count: number): Transcription {
  checkObject(value, ["pages"]); array(value.pages, count);
  if (value.pages.length !== count) fail();
  value.pages.forEach((page, i) => {
    checkObject(page, ["page", "text", "diagrams", "uncertainties"]);
    if (page.page !== i + 1) fail();
    text(page.text, 16000); array(page.diagrams, 20); array(page.uncertainties, 30);
    page.diagrams.forEach(x => text(x, 3000)); page.uncertainties.forEach(x => text(x, 1000));
  });
  if (JSON.stringify(value).length > 240000) fail();
  if (value.pages.every(page => !(page as { text: string }).text.trim())) throw new AppError("No readable notes were found. Try a clearer PDF export.", 422, "unreadable_notes");
  return value as Transcription;
}

export function validateStudy(value: unknown, count: number): StudyGuide {
  checkObject(value, Object.keys(studySchema.properties));
  text(value.course, 120, true); text(value.title, 200, true); text(value.cleanedNotes, 40000, true); text(value.summary, 8000, true);
  if (value.date !== null) {
    text(value.date, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value.date) || Number.isNaN(Date.parse(value.date)) || new Date(value.date).toISOString().slice(0, 10) !== value.date) fail();
  }
  const lists: [string, string[], number][] = [["keyConcepts", ["title", "explanation"], 25], ["definitions", ["term", "meaning"], 25], ["formulas", ["expression", "explanation"], 25], ["flashcards", ["front", "back"], 60]];
  for (const [key, fields, limit] of lists) {
    array(value[key], limit);
    value[key].forEach(item => {
      checkObject(item, [...fields, "sourcePages"]); fields.forEach(field => text(item[field], 1800, true)); pages(item.sourcePages, count);
    });
  }
  array(value.reviewPoints, 30); value.reviewPoints.forEach(item => text(item, 1800, true));
  if (JSON.stringify(value).length > 120000) fail();
  return value as StudyGuide;
}
