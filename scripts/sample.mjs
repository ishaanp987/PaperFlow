import { writeFile } from 'node:fs/promises';
import { samplePdf } from '../src/pdf.ts';
await writeFile(new URL('../examples/functions.pdf',import.meta.url), await samplePdf());
console.log('Created examples/functions.pdf. This is a typed sample, not a handwriting accuracy test.');
