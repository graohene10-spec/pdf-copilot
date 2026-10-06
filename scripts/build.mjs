import { cp, mkdir, readFile, writeFile, rm, lstat, readdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { generateIcons } from './icons.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = process.argv.slice(2);
if (options.length > 1 || options.some(option => !['--math=embedded', '--math=plain'].includes(option))) throw new Error('Use --math=embedded (default) or --math=plain');
const embeddedMath = options[0] !== '--math=plain';
const output = resolve(root, 'dist', embeddedMath ? 'extension' : 'extension-lite');
if (dirname(output) !== join(root, 'dist')) throw new Error('Invalid build directory');
try { if ((await lstat(output)).isSymbolicLink()) throw new Error('Build directory must not be a symlink'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(join(root, 'extension'), output, { recursive: true });
await writeFile(join(output, 'common', 'build-profile.js'), `export const EMBEDDED_MATH = ${embeddedMath};\n`);
if (!embeddedMath) {
  const chatHtml = join(output, 'chat', 'index.html');
  await writeFile(chatHtml, (await readFile(chatHtml, 'utf8')).replace(/<link\b[^>]*href="\.\.\/vendor\/katex\/[^"<>]+"[^>]*>/g, ''));
}
const pdfRoot = join(root, 'node_modules', 'pdfjs-dist');
const pdfVersion = JSON.parse(await readFile(join(pdfRoot, 'package.json'), 'utf8')).version;
const expected = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).dependencies['pdfjs-dist'];
if (pdfVersion !== expected) throw new Error('Run npm ci: PDF.js version does not match lockfile');
const vendor = join(output, 'vendor', 'pdfjs');
await mkdir(vendor, { recursive: true });
for (const file of ['pdf.mjs', 'pdf.worker.mjs']) await cp(join(pdfRoot, 'build', file), join(vendor, file));
await cp(join(pdfRoot, 'web', 'pdf_viewer.css'), join(vendor, 'pdf_viewer.css'));
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) await cp(join(pdfRoot, dir), join(vendor, dir), { recursive: true });
await cp(join(pdfRoot, 'LICENSE'), join(vendor, 'LICENSE'));
let katexVersion = null;
if (embeddedMath) {
  const katexRoot = join(root, 'node_modules', 'katex');
  katexVersion = JSON.parse(await readFile(join(katexRoot, 'package.json'), 'utf8')).version;
  const expectedKatex = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).dependencies.katex;
  if (katexVersion !== expectedKatex) throw new Error('Run npm ci: KaTeX version does not match lockfile');
  const katexVendor = join(output, 'vendor', 'katex');
  await mkdir(join(katexVendor, 'fonts'), { recursive: true });
  for (const file of ['katex.mjs', 'katex.min.css']) await cp(join(katexRoot, 'dist', file), join(katexVendor, file));
  // Chromium 132+ supports WOFF2; do not ship the legacy WOFF/TTF fallback fonts.
  for (const file of (await readdir(join(katexRoot, 'dist', 'fonts'))).filter(file => file.endsWith('.woff2'))) {
    await cp(join(katexRoot, 'dist', 'fonts', file), join(katexVendor, 'fonts', file));
  }
  await cp(join(katexRoot, 'LICENSE'), join(katexVendor, 'LICENSE'));
}
await generateIcons(join(output, 'icons'));
// A public development key keeps unpacked extension IDs stable across machines.
// No private signing key is stored; store IDs still come from each store.
const keyFile = join(root, 'extension', 'development-key.json');
let key;
try { key = JSON.parse(await readFile(keyFile, 'utf8')).key; }
catch {
  key = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  await writeFile(keyFile, JSON.stringify({ key }, null, 2) + '\n');
}
const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
manifest.key = key;
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await rm(join(output, 'development-key.json'), { force: true });
const id = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32).split('').map(char => String.fromCharCode(97 + parseInt(char, 16))).join('');
await writeFile(join(root, 'dist', 'extension-id.txt'), id + '\n');
await writeFile(join(root, 'dist', embeddedMath ? 'build-info.json' : 'build-info-lite.json'), JSON.stringify({ version: manifest.version, pdfjs: pdfVersion, katex: katexVersion, extensionId: id }, null, 2) + '\n');
console.log('Built extension: ' + output + '\nDevelopment extension ID: ' + id + '\nPDF.js: ' + pdfVersion + '\nMath: ' + (katexVersion ? 'embedded KaTeX ' + katexVersion : 'plain source'));
