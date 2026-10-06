import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const windows = process.env.WINDIR || 'C:\\Windows';
const powershell = path.join(windows, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const compiler = path.join(windows, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe');
const supported = process.platform === 'win32' && existsSync(compiler) && existsSync(path.join(root, 'native-host', 'bin', 'PdfCopilotHost.exe'));

test('installer checks CLI versions, discovers npm and preserves an explicit executable', { skip: !supported }, async () => {
  const cache = path.join(root, '.cache');
  await mkdir(cache, { recursive: true });
  const fixture = await mkdtemp(path.join(cache, 'installer-test-'));
  const local = path.join(fixture, 'local');
  const appdata = path.join(fixture, 'roaming');
  async function cli(relative, version) {
    const folder = path.join(fixture, relative);
    await mkdir(folder, { recursive: true });
    const source = path.join(folder, 'fixture.cs');
    const executable = path.join(folder, 'codex.exe');
    await writeFile(source, `using System; class Fixture { static int Main(string[] args) { if (args.Length != 1 || args[0] != "--version") return 2; Console.WriteLine("codex-cli ${version}"); return 0; } }`);
    const compiled = spawnSync(compiler, ['/nologo', '/target:exe', `/out:${executable}`, source], { windowsHide: true, encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    return executable;
  }
  function install(extra = [], localRoot = local) {
    const result = spawnSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', 'install-host.ps1'), '-ExtensionId', 'a'.repeat(32), '-WhatIf', ...extra], {
      cwd: root, windowsHide: true, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, LOCALAPPDATA: localRoot, APPDATA: appdata, PATH: path.join(windows, 'System32') },
    });
    const output = result.stdout + result.stderr;
    return { ...result, output, compact: output.replaceAll(/\s+/g, ''), prose: output.replaceAll(/\s+/g, ' ') };
  }
  try {
    const old = await cli('custom-legacy', '0.149.1');
    const fresh = await cli('roaming/npm/node_modules/@openai/codex/vendor/x86_64-pc-windows-msvc/codex', '0.999.0');
    const prerelease = await cli('local/Programs/OpenAI/Codex/bin', '0.159.2-alpha.1+build.7');
    const config = path.join(local, 'PdfCopilot', 'NativeHost');
    await mkdir(config, { recursive: true });
    await writeFile(path.join(config, 'host-config.json'), JSON.stringify({ codexPath: old }));

    const auto = install();
    assert.equal(auto.status, 0, auto.output);
    assert.ok(auto.output.includes('Selected Codex CLI: codex-cli 0.999.0'), auto.output);
    assert.ok(auto.output.includes(fresh), auto.output);
    assert.equal(existsSync(path.join(config, 'PdfCopilotHost.exe')), false, '-WhatIf must not install or register');

    const explicit = install(['-CodexPath', prerelease]);
    assert.equal(explicit.status, 0, explicit.output);
    assert.ok(explicit.output.includes('codex-cli 0.159.2-alpha.1+build.7'), explicit.output);
    assert.ok(explicit.output.includes(prerelease), explicit.output);

    const outdated = install(['-CodexPath', old]);
    assert.notEqual(outdated.status, 0);
    assert.ok(outdated.output.includes('0.149.1') && outdated.compact.includes(old.replaceAll(/\s+/g, '')), outdated.output);
    assert.ok(outdated.prose.includes('Login has not been checked'), outdated.output);

    // A config outside standard install roots is still considered; an old CLI
    // must yield a version diagnostic rather than an instruction to log in.
    const isolated = path.join(fixture, 'isolated');
    await mkdir(path.join(isolated, 'PdfCopilot', 'NativeHost'), { recursive: true });
    await writeFile(path.join(isolated, 'PdfCopilot', 'NativeHost', 'host-config.json'), JSON.stringify({ codexPath: old }));
    const npmExe = path.join(fixture, 'roaming', 'npm', 'node_modules', '@openai', 'codex', 'vendor', 'x86_64-pc-windows-msvc', 'codex', 'codex.exe');
    await copyFile(old, npmExe);
    const onlyOld = install([], isolated);
    assert.notEqual(onlyOld.status, 0);
    assert.ok(onlyOld.output.includes('0.149.1') && onlyOld.prose.includes('Login has not been checked'), onlyOld.output);
  } finally {
    assert.equal(path.dirname(path.resolve(fixture)), path.resolve(cache), 'cleanup must remain in workspace cache');
    await rm(fixture, { recursive: true, force: true });
  }
});
