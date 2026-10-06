import { readdir, readFile, access } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function walk(path) {
  const files = [];
  for (const item of await readdir(path, { withFileTypes: true })) {
    const next = join(path, item.name);
    if (item.isDirectory()) files.push(...await walk(next)); else files.push(next);
  }
  return files;
}
for (const file of [...await walk(join(root, 'extension')), ...await walk(join(root, 'scripts'))].filter(file => /\.(mjs|js)$/.test(file))) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
}
const embeddedMath = !process.argv.includes('--math=plain');
const dist = join(root, 'dist', embeddedMath ? 'extension' : 'extension-lite');
const manifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'));
for (const file of [manifest.background.service_worker, manifest.options_page, manifest.side_panel.default_path, ...Object.values(manifest.icons), 'reader/index.html', 'capture/index.html', 'vendor/pdfjs/pdf.mjs', 'vendor/pdfjs/pdf.worker.mjs', ...(embeddedMath ? ['vendor/katex/katex.mjs', 'vendor/katex/katex.min.css', 'vendor/katex/fonts/KaTeX_Main-Regular.woff2'] : [])]) await access(join(dist, file));
const buildProfile = await readFile(join(dist, 'common', 'build-profile.js'), 'utf8');
if (!buildProfile.includes(`EMBEDDED_MATH = ${embeddedMath}`)) throw new Error('Math build profile mismatch');
for (const file of (await walk(dist)).filter(file => file.endsWith('.html'))) {
  const html = await readFile(file, 'utf8');
  if (/<script[^>]*>(?!\s*<\/script>)/i.test(html.replace(/<script[^>]*\bsrc=[^>]*><\/script>/gi, ''))) throw new Error('Inline script violates MV3 CSP: ' + file);
}
if (manifest.host_permissions?.includes('<all_urls>')) throw new Error('Unexpected broad permanent host access');
console.log('Syntax, manifest paths and MV3 inline-script checks passed.');
