export function createAnswer() {
  return { role: 'assistant', content: '', reasoning: '', phase: 'thinking' };
}

export function appendAnswerText(answer, text) {
  if (answer.phase === 'finished' || !text) return false;
  answer.content += text;
  if (text.trim()) answer.phase = 'receiving';
  return true;
}

export function appendReasoning(answer, text) {
  if (answer.phase === 'finished' || !text) return false;
  answer.reasoning += text;
  return true;
}

export function finishAnswer(answer) {
  answer.phase = 'finished';
  answer.progress = '';
}

export function progressLabel(answer) {
  if (answer.phase !== 'finished' && answer.progress) return answer.progress;
  if (answer.phase === 'thinking') return 'AI 思考中…';
  if (answer.phase === 'receiving') return '正在接收回答…';
  return '';
}
