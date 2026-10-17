// Turns `npm run package:desktop` output (release/) into the GitHub Release assets
// the in-app updater reads: kaizhi_<ver>_x64-setup.exe, kaizhi_<ver>_x64-portable.zip,
// kaizhi_<ver>_source.zip, manifest.json and SHA256SUMS.txt in release/github/.
// Usage: node scripts/release-assets.mjs [--tag desktop-vX.Y.Z]
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
const run = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const repository = resolve(root, '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const tagIndex = process.argv.indexOf('--tag');
const tag = tagIndex > 0 ? process.argv[tagIndex + 1] : process.env.RELEASE_TAG || `desktop-v${version}`;
if (tag !== `desktop-v${version}`) throw new Error(`Tag ${tag} does not match desktop version ${version}.`);
const release = join(root, 'release');
const manifest = JSON.parse(await readFile(join(release, 'manifest.json'), 'utf8'));
if (manifest.version !== version) throw new Error('release/manifest.json is from another version; run npm run package:desktop first.');
const product = manifest.productName;
const output = join(release, 'github');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const names = {
  setup: [`${product}_${version}_x64-setup.exe`, `kaizhi_${version}_x64-setup.exe`],
  portable: [`${product}_${version}_x64-portable.zip`, `kaizhi_${version}_x64-portable.zip`],
};
for (const [source, target] of Object.values(names)) await copyFile(join(release, source), join(output, target));
const sourceZip = `kaizhi_${version}_source.zip`;
const { stdout } = await run('git', ['rev-parse', 'HEAD'], { cwd: repository });
const commit = stdout.trim();
await run('git', ['archive', '--format=zip', `--prefix=pdf-copilot-${version}/`, '-o', join(output, sourceZip), commit], { cwd: repository });
const sha256 = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const renamed = new Map(Object.values(names));
manifest.files = manifest.files.map(file => ({ ...file, path: renamed.get(file.path) || file.path }));
manifest.files.push({ path: sourceZip, bytes: (await stat(join(output, sourceZip))).size, sha256: await sha256(join(output, sourceZip)) });
manifest.sourceCommit = commit;
manifest.sourceTag = tag;
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
// sha256sum format, LF endings: "<hex>  <name>". The updater reads the setup line.
const listed = [names.setup[1], names.portable[1], sourceZip, 'manifest.json'];
const sums = [];
for (const name of listed) sums.push(`${await sha256(join(output, name))}  ${name}`);
await writeFile(join(output, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);
console.log(`Release assets for ${tag} (${commit}) in ${output}:\n${listed.concat('SHA256SUMS.txt').join('\n')}`);
