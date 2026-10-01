import { createRequire } from "node:module";
import { AppError } from "./errors.ts";
const { PDFDocument } = createRequire(import.meta.url)("../vendor/pdf-lib.cjs");
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_PDF_PAGES = 30;

export async function validatePdf(bytes: Uint8Array, filename: string): Promise<{ filename: string; pageCount: number }> {
  if (!/\.pdf$/i.test(filename)) throw new AppError("Choose a PDF file.", 415);
  if (bytes.length < 16 || bytes.length > MAX_PDF_BYTES) throw new AppError("PDFs must contain data and be no larger than 20 MB.", 413);
  if (Buffer.from(bytes).subarray(0, 5).toString() !== "%PDF-") throw new AppError("This file is not a valid PDF.", 415);
  try {
    const document = await PDFDocument.load(bytes, { throwOnInvalidObject: true });
    const pageCount = document.getPageCount();
    if (pageCount < 1) throw new AppError("The PDF has no pages.");
    if (pageCount > MAX_PDF_PAGES) throw new AppError("Upload up to 30 pages at a time. Split longer notebooks into lectures.", 413);
    const cleaned = filename.split(/[\\/]/).at(-1)!.replace(/[\x00-\x1f\x7f<>:"|?*]/g, "_").slice(0, 160);
    return { filename: cleaned || "notes.pdf", pageCount };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("This PDF could not be opened. Export it again without a password.", 422);
  }
}

export async function samplePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(new Date("2026-09-29T00:00:00Z")); pdf.setModificationDate(new Date("2026-09-29T00:00:00Z"));
  const page = pdf.addPage([595, 842]);
  page.drawText("PaperFlow sample - Functions", { x: 50, y: 780, size: 21 });
  const lines = ["Course: MATH 006A", "Topic: Functions", "Date: 2026-09-29", "", "A function assigns exactly one output to each input.", "Domain: the set of permitted inputs.", "Range: the set of outputs produced by a function.", "Example: f(x) = 2x + 3, so f(4) = 11.", "For g(x) = 1 / (x - 2), the domain excludes x = 2.", "Review: distinguish the domain from the range."];
  lines.forEach((line, i) => page.drawText(line, { x: 50, y: 728 - i * 28, size: 12 }));
  return pdf.save();
}
