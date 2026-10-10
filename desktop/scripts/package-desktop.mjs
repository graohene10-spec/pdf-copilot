import { access, cp, mkdir, readdir, readFile, writeFile, stat, rename, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, relative } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const native = JSON.parse(await readFile(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
if (pkg.version !== native.version) throw new Error('Desktop package versions must agree.');
const cargo = await readFile(join(root, 'src-tauri/Cargo.toml'), 'utf8');
if (cargo.match(/\[package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/)?.[1] !== pkg.version) throw new Error('Rust and desktop package versions must agree.');
const productName = native.productName;
if (typeof productName !== 'string' || !productName.trim() || /[<>:"/\\|?*\u0000-\u001f]/.test(productName) || /[. ]$/.test(productName)) {
  throw new Error('Desktop productName must be a valid Windows filename.');
}
const output = join(root, 'release');
const portable = join(output, `${productName}-portable`);
const portableExecutable = `${productName}.exe`;
const setupName = `${productName}_${pkg.version}_x64-setup.exe`;
const setup = join(root, 'src-tauri/target/release/bundle/nsis', setupName);
const executable = join(root, 'src-tauri/target/release/phydog.exe');
const helper = join(root, 'src-tauri/target/release/native-host/PdfCopilotHost.exe');
for (const path of [setup, executable, helper]) await access(path);
await mkdir(join(portable, 'native-host'), { recursive: true });
await cp(setup, join(output, setupName));
await cp(executable, join(portable, portableExecutable));
await cp(helper, join(portable, 'native-host/PdfCopilotHost.exe'));
await cp(join(root, 'README.md'), join(output, 'README.md'));
await cp(join(root, 'public/samples'), join(portable, 'samples'), { recursive: true });
await cp(join(root, 'public/samples'), join(output, 'samples'), { recursive: true });
await cp(join(root, '../LICENSE'), join(portable, 'LICENSE.txt'));
await writeFile(join(portable, '开始阅读.txt'), `双击 ${portableExecutable} 打开${productName}。\r\n使用左栏的「加入文档」，可先试 samples 中的示例。\r\n在「设置」→「AI」中连接服务。Codex 需要本机已安装并登录。\r\n阅读与快捷键选项也在集中设置中调整。\r\n这个免安装目录需要系统 WebView2；若运行环境缺失，请使用上级目录中的安装版。\r\n请保持 native-host 文件夹与 ${portableExecutable} 在一起。\r\n文档库和设置保存在当前 Windows 账号的应用数据目录；免安装版和安装版共用该文档库。\r\n从上一版本升级时，已有文档记录、阅读进度、设置和已保存的 API Key 会继续使用。\r\n`);
async function licenses(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) await licenses(path);
    else if (/license|notice|copyright/i.test(item.name)) {
      const destination = join(portable, 'licenses', relative(join(root, 'public/vendor'), path));
      await mkdir(resolve(destination, '..'), { recursive: true });
      await cp(path, destination);
    }
  }
}
await licenses(join(root, 'public/vendor'));
const portableZip = join(output, `${productName}_${pkg.version}_x64-portable.zip`);
const temporaryZip = `${portableZip}.partial.zip`;
async function removeTemporaryZip() { await unlink(temporaryZip).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
await removeTemporaryZip();
// Use Windows' built-in ZIP library, without depending on PowerShell modules.
// Keep the command fixed; pass paths as environment values, not shell code.
try {
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($env:PHYDOG_PACKAGE_PORTABLE, $env:PHYDOG_PACKAGE_ZIP, [IO.Compression.CompressionLevel]::Optimal, $true)`], {
    windowsHide: true, env: { ...process.env, PHYDOG_PACKAGE_PORTABLE: portable, PHYDOG_PACKAGE_ZIP: temporaryZip },
  });
  await rename(temporaryZip, portableZip);
} finally { await removeTemporaryZip(); }
const manifest = { productName, version: pkg.version, architecture: 'x64', runtime: 'system WebView2', files: [] };
for (const path of [join(output, setupName), join(portable, portableExecutable), join(portable, 'native-host/PdfCopilotHost.exe'), portableZip]) {
  const data = await readFile(path);
  manifest.files.push({ path: relative(output, path).replaceAll('\\','/'), bytes: (await stat(path)).size, sha256: createHash('sha256').update(data).digest('hex') });
}
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
