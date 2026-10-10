import { cp, mkdir, access, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const pdf = dirname(require.resolve('pdfjs-dist/package.json'));
const katex = dirname(require.resolve('katex/package.json'));
const vendor = resolve(root, 'public/vendor/pdfjs');
await mkdir(vendor, { recursive: true });
await cp(resolve(katex, 'LICENSE'), resolve(root, 'public/vendor/KaTeX-LICENSE.txt'));
await cp(resolve(root, '../LICENSE'), resolve(root, 'public/vendor/开智-LICENSE.txt'));
await rm(resolve(root, 'public/vendor/Phydog-LICENSE.txt'), { force: true });
for (const name of ['cmaps', 'standard_fonts', 'wasm', 'iccs', 'LICENSE']) {
  await cp(resolve(pdf, name), resolve(vendor, name), { recursive: true });
}
const helper = resolve(root, '../native-host/bin/PdfCopilotHost.exe');
await access(helper);
await mkdir(resolve(root, 'src-tauri/resources'), { recursive: true });
await cp(helper, resolve(root, 'src-tauri/resources/PdfCopilotHost.exe'));
await writeFile(resolve(root, 'public/vendor/NOTICE.txt'), 'PDF.js and included fonts/CMaps retain their original Apache-2.0 and resource licenses.\nSee pdfjs/LICENSE and resource notices. KaTeX MIT license is retained in the source dependencies.\n');
console.log('Prepared offline PDF assets and Codex helper.');
