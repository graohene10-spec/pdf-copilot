import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const exe = fileURLToPath(new URL('../native-host/bin/PdfCopilotHost.exe', import.meta.url));
const realExe = process.env.PDF_COPILOT_REAL_HOST_PATH || exe;
const supported = process.platform === 'win32' && existsSync(exe);

function frame(value) {
  const body = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}

function host(mode = 'normal', real = false) {
  const child = spawn(real ? realExe : exe, real ? [] : ['--test-server', mode], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const messages = []; const waiters = []; let bytes = Buffer.alloc(0), diagnostics = '';
  child.stdout.on('data', chunk => {
    bytes = Buffer.concat([bytes, chunk]);
    while (bytes.length >= 4 && bytes.length >= bytes.readUInt32LE(0) + 4) {
      const count = bytes.readUInt32LE(0);
      assert.ok(count > 0 && count < 1024 * 1024, 'browser-safe native output frame');
      const message = JSON.parse(bytes.subarray(4, count + 4).toString('utf8'));
      bytes = bytes.subarray(count + 4); messages.push(message);
      for (const resolve of waiters.splice(0)) resolve();
    }
  });
  child.stderr.on('data', chunk => { diagnostics += chunk.toString(); });
  return {
    child, messages, diagnostics: () => diagnostics,
    send(value) { child.stdin.write(frame(value)); },
    async until(predicate, timeout = 15000) {
      const deadline = Date.now() + timeout;
      while (!messages.some(predicate)) {
        if (Date.now() >= deadline) throw Error(`native host timed out; received ${JSON.stringify(messages)}; ${diagnostics}`);
        await Promise.race([new Promise(resolve => waiters.push(resolve)), new Promise(resolve => setTimeout(resolve, 25))]);
      }
      return messages.find(predicate);
    },
    async close() {
      child.stdin.end();
      if (child.exitCode !== null) return;
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise((_, reject) => setTimeout(() => { child.kill(); reject(Error('native host did not exit after browser disconnect')); }, 3000))]);
      assert.equal(bytes.length, 0, 'native stdout contains framed JSON only');
    },
  };
}

test('native host status and model metadata use sanitized responses', { skip: !supported }, async () => {
  const client = host();
  try {
    client.send({ id: 'status', type: 'status' });
    const status = await client.until(m => m.id === 'status');
    assert.equal(status.ok, true); assert.equal(status.result.loggedIn, true); assert.equal(status.result.authType, 'chatgpt');
    assert.deepEqual(Object.keys(status.result).sort(), ['authType', 'compatible', 'diagnostic', 'loggedIn', 'path', 'requiredVersion', 'version']);
    assert.equal(status.result.path, exe); assert.equal(status.result.compatible, true); assert.equal(status.result.requiredVersion, '0.159.2'); assert.equal(status.result.diagnostic, null);
    client.send({ id: 'models', type: 'models' });
    const models = await client.until(m => m.id === 'models');
    assert.equal(models.ok, true); assert.equal(models.result[0].id, 'fixture-model');
    assert.deepEqual(models.result[0].efforts, ['low', 'high']); assert.equal(models.result[0].vision, true);
  } finally { await client.close(); }
});

test('native host reports an old configured version without pretending to know login', { skip: !supported }, async () => {
  const client = host('version-old');
  try {
    client.send({ id: 'status', type: 'status' });
    const status = await client.until(m => m.id === 'status');
    assert.equal(status.ok, true); assert.equal(status.result.compatible, false); assert.equal(status.result.version, 'codex-cli 0.149.1');
    assert.equal(status.result.path, exe); assert.equal(status.result.requiredVersion, '0.159.2');
    assert.equal(status.result.loggedIn, null); assert.equal(status.result.authType, null);
    assert.ok(status.result.diagnostic.includes(exe)); assert.ok(status.result.diagnostic.includes('0.149.1')); assert.ok(status.result.diagnostic.includes('0.159.2'));
    client.send({ id: 'models', type: 'models' });
    const models = await client.until(m => m.id === 'models');
    assert.equal(models.ok, false); assert.ok(models.error.includes(exe)); assert.ok(models.error.includes('0.149.1'));
  } finally { await client.close(); }
});

for (const mode of ['version-alpha', 'version-build']) {
  test(`native host accepts official semver suffix format for ${mode}`, { skip: !supported }, async () => {
    const client = host(mode);
    try {
      client.send({ id: 'status', type: 'status' });
      const status = await client.until(m => m.id === 'status');
      assert.equal(status.ok, true); assert.equal(status.result.compatible, true); assert.equal(status.result.loggedIn, true); assert.equal(status.result.diagnostic, null);
      assert.equal(status.result.version, mode === 'version-alpha' ? 'codex-cli 0.159.2-alpha.1' : 'codex-cli 0.160.0+build.windows.1');
    } finally { await client.close(); }
  });
}

for (const mode of ['version-invalid', 'version-missing', 'version-timeout', 'status-failed']) {
  test(`native host preserves safe diagnostics for ${mode}`, { skip: !supported }, async () => {
    const client = host(mode);
    try {
      client.send({ id: 'status', type: 'status' });
      const status = await client.until(m => m.id === 'status');
      assert.equal(status.ok, true); assert.equal(status.result.loggedIn, null); assert.equal(status.result.path, exe); assert.equal(status.result.authType, null);
      assert.equal(status.result.compatible, mode === 'status-failed' ? true : null);
      if (mode !== 'status-failed') assert.equal(status.result.version, null);
      assert.equal(typeof status.result.diagnostic, 'string'); assert.equal(JSON.stringify(status).includes('credential_must_not_be_forwarded'), false);
    } finally { await client.close(); }
  });
}

test('native host streams UTF-8 and inline images in restricted ephemeral threads', { skip: !supported }, async () => {
  const client = host();
  try {
    client.send({ id: 'chat', type: 'chat', model: 'fixture-model', effort: 'high', text: '解释这张图。', history: [{ role: 'user', content: '历史文本' }], images: ['data:image/png;base64,iVBORw=='] });
    await client.until(m => m.id === 'chat' && m.event === 'done');
    assert.equal(client.messages.filter(m => m.event === 'delta').map(m => m.text).join(''), '你好，PDF。');
    assert.equal(client.diagnostics(), '');
  } finally { await client.close(); }
});

test('native host rejects unsupported actions and remote images before forwarding', { skip: !supported }, async () => {
  const client = host();
  try {
    client.send({ id: 'bad', type: 'shell', command: 'not allowed' });
    assert.equal((await client.until(m => m.id === 'bad')).ok, false);
    client.send({ id: 'remote', type: 'chat', text: 'test', images: ['https://example.com/image.png'] });
    assert.equal((await client.until(m => m.id === 'remote')).ok, false);
    client.send({ id: 'malformed', type: 'chat', text: 'test', images: 'data:image/png;base64,iVBORw==' });
    assert.equal((await client.until(m => m.id === 'malformed')).ok, false);
  } finally { await client.close(); }
});

for (const mode of ['tool', 'tool-event', 'ephemeral-refused', 'sandbox-refused', 'lost-child']) {
  test(`native host fails closed for ${mode}`, { skip: !supported }, async () => {
    const client = host(mode);
    try {
      client.send({ id: 'chat', type: 'chat', text: 'test' });
      assert.equal((await client.until(m => m.id === 'chat' && m.event === 'error')).event, 'error');
      assert.equal(client.messages.some(m => m.event === 'done'), false);
    } finally { await client.close(); }
  });
}

test('native host cancels an active turn and clears it', { skip: !supported }, async () => {
  const client = host('hanging');
  try {
    client.send({ id: 'chat', type: 'chat', text: 'test' });
    await client.until(m => m.id === 'chat' && m.event === 'reasoning');
    client.send({ id: 'cancel', type: 'cancel', targetId: 'chat' });
    assert.equal((await client.until(m => m.id === 'cancel')).result.cancelled, true);
    await client.until(m => m.id === 'chat' && m.event === 'done');
  } finally { await client.close(); }
});

test('native host cancels a queued chat before app-server startup', { skip: !supported }, async () => {
  const client = host('hanging');
  try {
    client.child.stdin.write(Buffer.concat([
      frame({ id: 'chat', type: 'chat', text: 'test' }),
      frame({ id: 'cancel', type: 'cancel', targetId: 'chat' }),
    ]));
    assert.equal((await client.until(m => m.id === 'cancel')).result.cancelled, true);
    await client.until(m => m.id === 'chat' && m.event === 'done');
    assert.equal(client.messages.some(m => m.event === 'delta'), false);
  } finally { await client.close(); }
});

test('native host disconnect kills an unfinished app-server process', { skip: !supported }, async () => {
  const client = host('hanging');
  client.send({ id: 'chat', type: 'chat', text: 'test' });
  await client.until(m => m.id === 'chat' && m.event === 'reasoning');
  await client.close();
  assert.equal(client.child.exitCode, 0);
});

test('native host rejects a frame exceeding its size limit without allocation', { skip: !supported }, async () => {
  const client = host();
  const header = Buffer.alloc(4); header.writeUInt32LE(64 * 1024 * 1024);
  client.child.stdin.write(header);
  await new Promise(resolve => client.child.once('exit', resolve));
  assert.equal(client.child.exitCode, 2); assert.equal(client.messages.length, 0);
});

test('installed Codex metadata smoke does not start inference', { skip: !supported || !process.env.PDF_COPILOT_REAL_CODEX_SMOKE }, async () => {
  const client = host('normal', true);
  try {
    client.send({ id: 'status', type: 'status' });
    const status = await client.until(m => m.id === 'status', 30000);
    assert.equal(status.ok, true, status.error); assert.equal(typeof status.result.loggedIn, 'boolean');
    client.send({ id: 'models', type: 'models' });
    const models = await client.until(m => m.id === 'models', 30000);
    assert.equal(models.ok, true, models.error); assert.ok(models.result.length > 0);
    console.log(`Codex metadata: ${status.result.version}; logged in=${status.result.loggedIn}; models=${models.result.length}`);
  } finally { await client.close(); }
});
