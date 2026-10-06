import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnswer, appendAnswerText, appendReasoning, finishAnswer, progressLabel } from '../extension/chat/progress.mjs';
import { matchingInboxContexts } from '../extension/chat/inbox.mjs';

test('waiting appears before output and remains during reasoning only', () => {
  const answer = createAnswer();
  assert.equal(answer.content, ''); assert.equal(progressLabel(answer), 'AI 思考中…');
  appendReasoning(answer, '先分析材料');
  appendAnswerText(answer, '\n'); appendAnswerText(answer, '');
  assert.equal(progressLabel(answer), 'AI 思考中…');
  appendAnswerText(answer, '正文');
  assert.equal(progressLabel(answer), '正在接收回答…');
  appendReasoning(answer, '后续思考');
  assert.equal(progressLabel(answer), '正在接收回答…');
});

test('every terminal state removes waiting and refuses late output', () => {
  for (const outcome of ['complete', 'cancel', 'error', 'clear', 'source-change']) {
    for (const text of ['', '部分回答']) {
      const answer = createAnswer(); appendAnswerText(answer, text); appendReasoning(answer, '推理');
      finishAnswer(answer);
      assert.equal(progressLabel(answer), '', outcome);
      assert.equal(appendAnswerText(answer, '过时的回复'), false, outcome);
      assert.equal(appendReasoning(answer, '过时的推理'), false, outcome);
      assert.equal(answer.content, text); assert.equal(answer.reasoning, '推理');
    }
  }
});

test('enhanced-reader inbox accepts only the loaded PDF fingerprint', () => {
  const old = { id: 'old', source: { tabId: 7, fingerprint: 'old-pdf' } };
  const current = { id: 'current', source: { tabId: 7, fingerprint: 'new-pdf' } };
  const native = { id: 'native', source: { tabId: 7 } };
  const otherTab = { id: 'other', source: { tabId: 8 } };
  assert.deepEqual(matchingInboxContexts([old, current, native, otherTab], 7, 'new-pdf'), [current, native]);
  assert.deepEqual(matchingInboxContexts([old, current, native], 7, undefined), [native]);
  assert.deepEqual(matchingInboxContexts(undefined, 7, 'new-pdf'), []);
});
