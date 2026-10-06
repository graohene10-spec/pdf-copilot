// Keep the supported syntax small: prose, literal code and four math delimiters.
// Source text never becomes HTML. Only the bundled KaTeX renderer produces HTML.
export const MATH_LIMITS = Object.freeze({ expressionLength: 8000, expressions: 128, delimiterAttempts: 256 });
const ERROR_COLOR = '#b91c1c';

function runLength(text, index, char) {
  let end = index;
  while (text[end] === char) end++;
  return end - index;
}

function fenceAt(text, index) {
  const char = text[index];
  if (char !== '`' && char !== '~') return null;
  let lineStart = index;
  while (lineStart > 0 && index - lineStart < 3 && text[lineStart - 1] === ' ') lineStart--;
  if (lineStart > 0 && text[lineStart - 1] !== '\n') return null;
  const length = runLength(text, index, char);
  if (length < 3) return null;
  const lineEnd = text.indexOf('\n', index + length);
  if (lineEnd < 0) return { end: text.length, block: true };
  let cursor = lineEnd + 1;
  while (cursor < text.length) {
    const end = text.indexOf('\n', cursor);
    const next = end < 0 ? text.length : end;
    const line = text.slice(cursor, next).replace(/\r$/, '');
    const close = line.match(/^ {0,3}(`+|~+)\s*$/);
    if (close && close[1][0] === char && close[1].length >= length) return { end: next, block: true };
    cursor = next + 1;
  }
  return { end: text.length, block: true };
}

function codeAt(text, index) {
  const fence = fenceAt(text, index);
  if (fence) return fence;
  if (text[index] !== '`') return null;
  const length = runLength(text, index, '`');
  let cursor = index + length;
  while (cursor < text.length) {
    cursor = text.indexOf('`', cursor);
    if (cursor < 0) break;
    const closing = runLength(text, cursor, '`');
    if (closing === length) return { end: cursor + length, block: false };
    cursor += closing;
  }
  // An unfinished code fragment stays literal, including during a stopped stream.
  return { end: text.length, block: false };
}

function mathAt(text, index) {
  if (text.startsWith('$$', index)) return { open: '$$', close: '$$', display: true };
  if (text[index] === '$') return { open: '$', close: '$', display: false };
  if (text.startsWith('\\(', index)) return { open: '\\(', close: '\\)', display: false };
  if (text.startsWith('\\[', index)) return { open: '\\[', close: '\\]', display: true };
  return null;
}

function closingMath(text, from, delimiter) {
  const bound = Math.min(text.length, from + MATH_LIMITS.expressionLength + delimiter.close.length);
  let braces = 0;
  for (let index = from; index < bound; index++) {
    if (braces === 0 && text.startsWith(delimiter.close, index)) {
      return { index };
    }
    if (text[index] === '\\') { index++; continue; }
    if (text[index] === '{') braces++;
    else if (text[index] === '}') braces = Math.max(0, braces - 1);
  }
  return { index: -1, exhausted: bound < text.length };
}

export function splitMessage(value) {
  const text = String(value ?? '');
  const parts = [];
  let literal = 0, index = 0, attempts = 0, expressions = 0, mathEnabled = true;
  const flush = end => {
    if (end > literal) parts.push({ type: 'text', raw: text.slice(literal, end) });
  };
  while (index < text.length) {
    const code = codeAt(text, index);
    if (code) {
      flush(index);
      parts.push({ type: 'code', raw: text.slice(index, code.end), block: code.block });
      index = literal = code.end;
      continue;
    }
    const delimiter = mathEnabled ? mathAt(text, index) : null;
    if (delimiter && attempts++ < MATH_LIMITS.delimiterAttempts && expressions < MATH_LIMITS.expressions) {
      const from = index + delimiter.open.length;
      const close = closingMath(text, from, delimiter);
      if (close.index >= 0 && close.index - from <= MATH_LIMITS.expressionLength) {
        const formula = text.slice(from, close.index);
        if (formula.trim()) {
          flush(index);
          const end = close.index + delimiter.close.length;
          parts.push({ type: 'math', raw: text.slice(index, end), formula, display: delimiter.display });
          index = literal = end;
          expressions++;
          continue;
        }
      }
      if (close.exhausted) mathEnabled = false;
      index += delimiter.open.length;
      continue;
    }
    if (attempts >= MATH_LIMITS.delimiterAttempts || expressions >= MATH_LIMITS.expressions) mathEnabled = false;
    index += text[index] === '\\' ? 2 : 1;
  }
  flush(text.length);
  return parts;
}

export function renderMessage(container, text, renderer) {
  // The lite build has no renderer or formula assets. Preserve its exact source.
  if (!renderer) { container.textContent = String(text ?? ''); return; }
  const document = container.ownerDocument;
  const nodes = splitMessage(text).map(part => {
    if (part.type === 'text') return document.createTextNode(part.raw);
    if (part.type === 'code') {
      const node = document.createElement(part.block ? 'pre' : 'code');
      node.className = 'message-code'; node.textContent = part.raw;
      return node;
    }
    try {
      const html = renderer.renderToString(part.formula, {
        displayMode: part.display, output: 'htmlAndMathml', trust: false, throwOnError: false,
        strict: 'ignore', maxExpand: 500, maxSize: 10, macros: {}, errorColor: ERROR_COLOR,
      });
      // KaTeX may show unsupported commands in its error color without throwing.
      // Keep the whole original formula, including delimiters, in that case.
      if (/class="[^"]*\bkatex-error\b/.test(html) || html.includes(ERROR_COLOR)) return document.createTextNode(part.raw);
      const node = document.createElement(part.display ? 'div' : 'span');
      node.className = part.display ? 'message-math display-math' : 'message-math';
      node.innerHTML = html;
      return node;
    } catch { return document.createTextNode(part.raw); }
  });
  container.replaceChildren(...nodes);
}
