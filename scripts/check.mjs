import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const directories = ['src','public','scripts','test'];
let failed = false;
for (const directory of directories) {
  for (const filename of await readdir(directory)) {
    if (!/\.(ts|js|mjs)$/.test(filename)) continue;
    const result = spawnSync(process.execPath, ['--check', `${directory}/${filename}`], { encoding: 'utf8' });
    if (result.status !== 0) { failed = true; console.error(result.stderr); }
  }
}
const vendorHash = createHash('sha256').update(await readFile('vendor/pdf-lib.cjs')).digest('hex');
const expected = (await readFile('vendor/SHA256SUMS','utf8')).split(/\s+/)[0];
if (vendorHash !== expected) { failed = true; console.error('Vendored PDF parser integrity check failed.'); }
if (failed) process.exit(1);
console.log('Source syntax and vendored PDF parser integrity verified. No bundle step is required.');
