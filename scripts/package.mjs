import { cp, mkdir, rm, lstat, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('Invalid version');
const release = resolve(root, 'release', pkg.version);
if (dirname(release) !== join(root, 'release')) throw new Error('Invalid release path');
for (const name of ['extension', 'extension-lite']) {
  const manifest = JSON.parse(await readFile(join(root, 'dist', name, 'manifest.json'), 'utf8'));
  if (manifest.version !== pkg.version) throw new Error('Build both current distributions before packaging');
  const embedded = name === 'extension';
  const profile = await readFile(join(root, 'dist', name, 'common', 'build-profile.js'), 'utf8');
  if (!profile.includes(`EMBEDDED_MATH = ${embedded}`)) throw new Error('Wrong math distribution profile');
}
try { if ((await lstat(release)).isSymbolicLink()) throw new Error('Release path must not be a symlink'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await rm(release, { recursive: true, force: true }); await mkdir(release, { recursive: true });
const full = join(release, 'pdf-copilot');
await mkdir(join(full, 'windows-helper', 'scripts'), { recursive: true });
await cp(join(root, 'dist', 'extension'), join(full, 'extension'), { recursive: true });
await cp(join(root, 'native-host', 'bin', 'PdfCopilotHost.exe'), join(full, 'windows-helper', 'PdfCopilotHost.exe'));
await cp(join(root, 'docs', 'WINDOWS_HELPER.md'), join(full, 'windows-helper', 'README.md'));
for (const file of ['install-host.ps1', 'uninstall-host.ps1']) await cp(join(root, 'scripts', file), join(full, 'windows-helper', 'scripts', file));
for (const file of ['README.md', 'LICENSE', 'PRIVACY.md', 'THIRD_PARTY_NOTICES.md']) await cp(join(root, file), join(full, file));
await cp(join(root, 'docs'), join(full, 'docs'), { recursive: true });
await cp(join(root, 'native-host', 'README.md'), join(full, 'docs', 'native-host.md'));
await cp(join(root, 'dist', 'extension-id.txt'), join(full, 'windows-helper', 'extension-id.txt'));
await writeFile(join(full, 'windows-helper', 'install.cmd'), '@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\\install-host.ps1"\r\npause\r\n');
await writeFile(join(full, 'windows-helper', 'uninstall.cmd'), '@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\\uninstall-host.ps1"\r\npause\r\n');
const lite = join(release, 'pdf-copilot-lite');
await mkdir(lite, { recursive: true });
await cp(join(root, 'dist', 'extension-lite'), join(lite, 'extension'), { recursive: true });
for (const name of ['windows-helper', 'docs', 'LICENSE', 'PRIVACY.md', 'THIRD_PARTY_NOTICES.md']) await cp(join(full, name), join(lite, name), { recursive: true });
const liteReadme = '# 极简发行版（公式显示原文）\n\n本版不包含 KaTeX 公式渲染模块。公式以原始文字显示；滚动阅读、模型连接和等待提示与默认版本一致。需要直接显示公式，请选择默认 pdf-copilot-' + pkg.version + '.zip，它已自带渲染模块与字体，无需另外安装。两个发行版使用同一扩展 ID，只需选择一个。\n\n' + (await readFile(join(full, 'README.md'), 'utf8'));
await writeFile(join(lite, 'README.md'), liteReadme);
function quoted(text) { return "'" + text.replaceAll("'", "''") + "'"; }
function zip(source, destination) {
  execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory(' + quoted(source) + ', ' + quoted(destination) + ')'], { stdio: 'inherit', windowsHide: true });
}
const bundles = [
  ['pdf-copilot-' + pkg.version + '.zip', full],
  ['pdf-copilot-extension-' + pkg.version + '.zip', join(full, 'extension')],
  ['pdf-copilot-windows-helper-' + pkg.version + '.zip', join(full, 'windows-helper')],
  ['pdf-copilot-lite-' + pkg.version + '.zip', lite],
  ['pdf-copilot-extension-lite-' + pkg.version + '.zip', join(lite, 'extension')],
];
const source = join(release, 'source');
await mkdir(source);
for (const name of ['extension', 'native-host', 'scripts', 'tests', 'docs']) {
  await cp(join(root, name), join(source, name), { recursive: true, filter: path => !/[/\\](bin|\.schema)([/\\]|$)/.test(path) });
}
for (const name of ['package.json', 'package-lock.json', '.gitignore', '.gitattributes', 'README.md', 'LICENSE', 'PRIVACY.md', 'THIRD_PARTY_NOTICES.md']) await cp(join(root, name), join(source, name));
bundles.push(['pdf-copilot-source-' + pkg.version + '.zip', source]);
const checksums = [];
const sizes = new Map();
for (const [name, source] of bundles) {
  const output = join(release, name); zip(source, output);
  const bytes = await readFile(output);
  sizes.set(name, bytes.length);
  checksums.push(createHash('sha256').update(bytes).digest('hex') + '  ' + name);
  console.log(name + ' · ' + (bytes.length / 1024 / 1024).toFixed(2) + ' MiB');
}
await writeFile(join(release, 'SHA256SUMS.txt'), checksums.join('\n') + '\n');
const fullBytes = sizes.get('pdf-copilot-' + pkg.version + '.zip');
const liteBytes = sizes.get('pdf-copilot-lite-' + pkg.version + '.zip');
await writeFile(join(release, 'DISTRIBUTIONS.md'), '# 发行版选择\n\n| 发行版 | 公式 | 完整 ZIP 体积 |\n|---|---|---|\n| 默认版 | 自带本地 KaTeX 模块与字体，直接排版，无需安装或联网加载 | ' + (fullBytes / 1024 / 1024).toFixed(2) + ' MiB |\n| 极简版 | 显示公式原文，其他功能相同 | ' + (liteBytes / 1024 / 1024).toFixed(2) + ' MiB |\n\n自带公式版体积增加约 ' + ((fullBytes - liteBytes) / 1024 / 1024).toFixed(2) + ' MiB。建议选择默认版。两个版本使用相同扩展 ID，不同时安装。完整安装包包含扩展与可选 Windows 小助手；扩展独立 ZIP 只包含浏览器资源。\n');
console.log('Release: ' + release);
