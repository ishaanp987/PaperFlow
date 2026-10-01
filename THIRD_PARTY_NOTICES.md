# Third-party notices

`vendor/pdf-lib.cjs` is the unchanged UMD minified distribution of **pdf-lib 1.17.1**, renamed from `dist/pdf-lib.min.js` for CommonJS loading in an ES module project. It is bundled so downloaded copies can parse PDFs without an installation step or network fetch.

- Upstream: https://github.com/Hopding/pdf-lib
- Package: https://www.npmjs.com/package/pdf-lib/v/1.17.1
- License: MIT; see `vendor/pdf-lib.LICENSE.md`.
- Integrity: the pinned SHA-256 is in `vendor/SHA256SUMS` and checked by `node scripts/check.mjs`.

The upstream distribution includes `@pdf-lib/standard-fonts`, `@pdf-lib/upng`, `pako`, and `tslib`. Their license notices are retained under `vendor/licenses/`. The bundled parser is used only on the server and is not served to browsers.

When updating this distribution, obtain it from the official package, retain license notices, update its checksum, and run the PDF validation tests.
