import test from 'node:test';
import assert from 'node:assert/strict';
import katex from 'katex';
import { MATH_LIMITS, splitMessage, renderMessage } from '../extension/chat/math.mjs';

function fixture() {
  const document = {
    createTextNode: text => ({ type: 'text', textContent: text }),
    createElement: tag => new Element(tag),
  };
  class Element {
    constructor(tag) { this.tag = tag; this.ownerDocument = document; this.children = []; this.html = ''; this.text = ''; }
    set textContent(text) { this.text = text; this.children = []; this.html = ''; }
    get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('') : this.text; }
    set innerHTML(html) { this.html = html; this.children = []; this.text = ''; }
    replaceChildren(...children) { this.children = children; this.text = ''; this.html = ''; }
  }
  return new Element('div');
}

test('four math delimiters preserve prose and complete source', () => {
  const source = String.raw`公式 $E=mc^2$，\(x^2\)，$$\int_0^1 x\,dx$$，\[a+b\]。`;
  const parts = splitMessage(source);
  assert.equal(parts.map(part => part.raw).join(''), source);
  assert.deepEqual(parts.filter(part => part.type === 'math').map(({ formula, display }) => ({ formula, display })), [
    { formula: 'E=mc^2', display: false }, { formula: 'x^2', display: false },
    { formula: String.raw`\int_0^1 x\,dx`, display: true }, { formula: 'a+b', display: true },
  ]);
});

test('inline code, backtick fences, tilde fences and unfinished code stay literal', () => {
  const source = '`$code$` ``\\(also code\\)``\n```tex\n$$not math$$\n```\n~~~\n$tilde$\n~~~\n$x$';
  const parts = splitMessage(source);
  assert.equal(parts.map(part => part.raw).join(''), source);
  assert.deepEqual(parts.filter(part => part.type === 'math').map(part => part.formula), ['x']);
  assert.equal(parts.filter(part => part.type === 'code').length, 4);
  assert.equal(splitMessage('```\n$x$').some(part => part.type === 'math'), false);
  assert.equal(splitMessage('`unfinished $x$').some(part => part.type === 'math'), false);
  assert.deepEqual(splitMessage('\\`escaped` $x$').filter(part => part.type === 'math'), []);
});

test('escaped delimiters, dollars inside braces, adjacent formulas and incomplete math', () => {
  const source = String.raw`\$5 \\(literal\\) $\text{cost $5} + x$ $a$$b$ \[unfinished`;
  const parts = splitMessage(source);
  assert.equal(parts.map(part => part.raw).join(''), source);
  assert.deepEqual(parts.filter(part => part.type === 'math').map(part => part.formula), [String.raw`\text{cost $5} + x`, 'a', 'b']);
  assert.deepEqual(splitMessage('$missing'), [{ type: 'text', raw: '$missing' }]);
});

test('formula budgets keep oversized and excess source literal', () => {
  const many = Array.from({ length: MATH_LIMITS.expressions + 5 }, () => '$x$').join(' ');
  const parts = splitMessage(many);
  assert.equal(parts.filter(part => part.type === 'math').length, MATH_LIMITS.expressions);
  assert.equal(parts.map(part => part.raw).join(''), many);
  const oversized = '$' + 'x'.repeat(MATH_LIMITS.expressionLength + 1) + '$ then $y$';
  assert.equal(splitMessage(oversized).some(part => part.type === 'math'), false);
  assert.equal(splitMessage(oversized).map(part => part.raw).join(''), oversized);
  // Long escape runs and isolated delimiters should be processed with bounded work.
  const adversarial = '\\'.repeat(100000) + String.raw`\(x\)`;
  assert.equal(splitMessage(adversarial).map(part => part.raw).join(''), adversarial);
});

test('only generated KaTeX markup becomes HTML and code never reaches the renderer', () => {
  const container = fixture();
  const source = '<img src="https://example.invalid/track" onerror="alert(1)"> `$ignored$` $x$ <script>bad()</script>';
  let calls = 0;
  renderMessage(container, source, { renderToString(formula, options) {
    calls++; assert.equal(formula, 'x');
    assert.equal(options.trust, false); assert.equal(options.throwOnError, false);
    assert.equal(options.maxExpand, 500); assert.equal(options.maxSize, 10);
    return katex.renderToString(formula, options);
  } });
  assert.equal(calls, 1);
  assert.equal(container.children[0].type, 'text');
  assert.match(container.children[0].textContent, /^<img /);
  assert.equal(container.children.find(node => node.tag === 'code').textContent, '`$ignored$`');
  const html = container.children.filter(node => node.html).map(node => node.html).join('');
  assert.match(html, /class="katex"/);
  assert.doesNotMatch(html, /<(?:img|script|a)(?:\s|>)/i);
});

test('bundled KaTeX blocks URL commands and preserves unsupported or broken formulas', () => {
  for (const formula of [String.raw`\href{https://example.invalid/track}{click}`, String.raw`\includegraphics{https://example.invalid/track}`, String.raw`\unknowncommand{argument}`, String.raw`\frac{1}`]) {
    const source = '$' + formula + '$';
    const container = fixture(); renderMessage(container, source, katex);
    assert.equal(container.textContent, source);
    assert.equal(container.children.some(node => node.html), false);
  }
  const container = fixture(); renderMessage(container, String.raw`$\text{<script>alert(1)</script>}$`, katex);
  const html = container.children.find(node => node.html)?.html || '';
  assert.ok(html); assert.doesNotMatch(html, /<script>/); assert.match(html, /&lt;script&gt;/);
});

test('fresh macros and expansion limits isolate formulas and stop recursive expansion', () => {
  const container = fixture();
  renderMessage(container, String.raw`$\gdef\secret{x}\secret$ $\secret$`, katex);
  assert.equal(container.children.filter(node => node.html).length, 1);
  assert.ok(container.children.some(node => node.textContent === String.raw`$\secret$`));
  const recursion = String.raw`$\def\loop{\loop}\loop$`;
  renderMessage(container, recursion, katex);
  assert.equal(container.textContent, recursion);
  renderMessage(container, String.raw`$\rule{1000em}{1000em}$`, katex);
  const html = container.children.find(node => node.html)?.html || '';
  assert.match(html, /height:10em/);
  assert.doesNotMatch(html, /style="[^"]*1000em/);
});

test('lite profile without a renderer preserves exact text and never inserts HTML', () => {
  const container = fixture();
  const source = String.raw`<img onerror="bad()"> $x^2$ \[y\]` + ' \\';
  renderMessage(container, source, null);
  assert.equal(container.textContent, source); assert.equal(container.html, ''); assert.equal(container.children.length, 0);
});
