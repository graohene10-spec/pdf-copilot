// Explicit real Codex smoke: a tiny synthetic tool result, no PDF or credentials read.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const exe = fileURLToPath(new URL('../native-host/bin/PdfCopilotHost.exe', import.meta.url));
const child = spawn(exe, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
let buffer = Buffer.alloc(0), answer = '', settled = false;
const calls = [], result = { status: 'running' };
const send = value => { const body = Buffer.from(JSON.stringify(value)); const head = Buffer.alloc(4); head.writeUInt32LE(body.length); child.stdin.write(Buffer.concat([head, body])); };
let finish;
const completed = new Promise((resolve, reject) => { finish = (error) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(); }; });
const timer = setTimeout(() => finish(new Error('Real Codex tool smoke timed out.')), 90000);
child.stderr.on('data', () => {});
child.on('error', finish); child.on('exit', () => { if (!settled) finish(new Error('Native helper exited before completion.')); });
child.stdout.on('data', data => {
  buffer = Buffer.concat([buffer, data]);
  while (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) {
    const length = buffer.readUInt32LE(0); if (length > 1024 * 1024) { finish(new Error('Invalid output frame.')); return; }
    const msg = JSON.parse(buffer.subarray(4, length + 4)); buffer = buffer.subarray(length + 4);
    if (msg.id === 'models') {
      if (!msg.ok) { finish(new Error(msg.error)); return; }
      const model = msg.result.find(item => /mini/.test(item.id)) || msg.result[0];
      result.model = model.id;
      send({ id: 'chat', type: 'chat', model: model.id, effort: model.efforts.includes('low') ? 'low' : model.defaultEffort, pdfTools: true, pdfVision: model.vision,
        text: 'Synthetic integration test. First call pdf_read exactly once with start_page=2, end_page=null and block_id=null. Then reply with the marker contained in the returned evidence and its source citation. Do not use other tools or actions.' });
    }
    if (msg.id === 'chat' && msg.event === 'tool') {
      calls.push(msg.tool);
      send({ id: 'result' + calls.length, type: 'tool-result', targetId: 'chat', callId: msg.callId, text: JSON.stringify({ evidence: [{ sourceId: 'Sreal-1', page: 2, pageLabel: '1', blockId: 'p2-b0', text: 'Synthetic marker: NATIVE_PDF_CONTEXT_OK.' }] }), images: [] });
    }
    if (msg.id === 'chat' && msg.event === 'delta') answer += msg.text;
    if (msg.id === 'chat' && msg.event === 'error') finish(new Error(msg.error));
    if (msg.id === 'chat' && msg.event === 'done') finish();
  }
});
try {
  send({ id: 'models', type: 'models' }); await completed;
  assert(calls.includes('pdf_read')); assert(answer.includes('NATIVE_PDF_CONTEXT_OK')); assert(answer.includes('Sreal-1'));
  result.status = 'pass'; result.calls = calls; console.log('PASS real Codex PDF tool round trip (' + result.model + ')');
} catch (error) { result.status = 'fail'; result.error = error.message; result.calls = calls; result.answer = answer; console.error(error.message, 'Synthetic answer:', answer); process.exitCode = 1; }
finally {
  child.stdin.end(); await new Promise(resolve => { if (child.exitCode !== null) return resolve(); const stop = setTimeout(() => { child.kill(); resolve(); }, 4000); child.once('exit', () => { clearTimeout(stop); resolve(); }); });
  const artifacts = fileURLToPath(new URL('../artifacts/', import.meta.url)); await mkdir(artifacts, { recursive: true }); await writeFile(artifacts + '/context-native-results.json', JSON.stringify(result, null, 2));
}
