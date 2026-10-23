// Claude (Anthropic Messages API) through the official SDK. Requests go through the app's own
// transport (the desktop's cancellable native HTTP reader), and the history arrives in the
// chat-completions shape every other provider shares; it is converted here, per request.
import Anthropic from '@anthropic-ai/sdk';
import { transportFetch } from './transport.mjs';

const CLAUDE_5_5 = /^claude-(opus|sonnet|haiku)-5-5$/;

function imageBlock(url) {
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/s.exec(String(url || ''));
  return match ? { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } } : { type: 'image', source: { type: 'url', url } };
}
function userContent(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content || ' ' }];
  return content.map(part => part.type === 'image_url' ? imageBlock(part.image_url?.url) : { type: 'text', text: part.text || ' ' });
}

/** Chat-format history (system, user, assistant with tool_calls, tool) → Claude's system + messages. */
export function toClaudeMessages(chat) {
  const system = chat.filter(message => message.role === 'system').map(message => message.content).join('\n');
  const messages = [];
  const push = (role, blocks) => {
    const last = messages.at(-1);
    // Consecutive same-role turns merge, so every tool_result lands in one user message.
    if (last?.role === role) last.content.push(...blocks);
    else messages.push({ role, content: [...blocks] });
  };
  for (const message of chat) {
    if (message.role === 'system') continue;
    if (message.role === 'tool') { push('user', [{ type: 'tool_result', tool_use_id: message.tool_call_id, content: String(message.content || '') }]); continue; }
    if (message.role === 'assistant') {
      // Thinking blocks go back unchanged with the tool calls they led to.
      if (message.claude_content) { push('assistant', message.claude_content); continue; }
      const blocks = message.content ? [{ type: 'text', text: message.content }] : [];
      for (const call of message.tool_calls || []) {
        let input = {};
        try { input = JSON.parse(call.function?.arguments || '{}'); } catch { /* sent as an empty input */ }
        blocks.push({ type: 'tool_use', id: call.id, name: call.function?.name, input });
      }
      push('assistant', blocks.length ? blocks : [{ type: 'text', text: ' ' }]);
      continue;
    }
    push('user', userContent(message.content));
  }
  return { system, messages };
}

export async function streamAnthropic(options, chatPayload) {
  const { apiKey, baseUrl, model, effort, signal, onDelta, onReasoning, onUsage } = options;
  const { system, messages } = toClaudeMessages(chatPayload.messages);
  const params = { model, max_tokens: 64000, system, messages };
  // Current Claude models think adaptively; the summary is streamed as the reasoning line. Depth is set by effort.
  if (CLAUDE_5_5.test(model)) params.thinking = { type: 'adaptive', display: 'summarized' };
  if (effort && effort !== 'none') params.output_config = { effort };
  if (chatPayload.tools?.length) params.tools = chatPayload.tools.map(({ function: tool }) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters }));
  const client = new Anthropic({ apiKey, baseURL: baseUrl.replace(/\/+$/, '').replace(/\/v1$/, ''), fetch: transportFetch, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 10 * 60000 });
  let message;
  try {
    const stream = client.messages.stream(params, { signal });
    for await (const event of stream) {
      if (event.type !== 'content_block_delta') continue;
      if (event.delta.type === 'text_delta') onDelta?.(event.delta.text);
      else if (event.delta.type === 'thinking_delta') onReasoning?.(event.delta.thinking);
    }
    message = await stream.finalMessage();
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    if (error instanceof Anthropic.AuthenticationError) throw new Error('Claude 拒绝了这个 API Key，请在设置里检查。');
    if (error instanceof Anthropic.RateLimitError) throw new Error('Claude 接口限流了，请稍后再试。');
    if (error instanceof Anthropic.APIError) throw new Error(`服务返回 HTTP ${error.status ?? ''}：${String(error.message || '').split(apiKey).join('[已隐藏]').slice(0, 500)}`);
    throw error;
  }
  if (message.usage) onUsage?.({ input: message.usage.input_tokens, output: message.usage.output_tokens });
  if (message.stop_reason === 'refusal') throw new Error('Claude 拒绝回答这个请求，可以换个问法或换个模型。');
  const uses = message.content.filter(block => block.type === 'tool_use');
  if (message.stop_reason === 'max_tokens' && uses.length) throw new Error('回答太长被截断，工具请求不完整，请缩小问题范围。');
  if (uses.length > 8) throw new Error('服务返回了过多工具调用。');
  if (uses.length && !options.tools?.length) throw new Error('当前对话没有启用 PDF 工具。');
  const content = message.content.filter(block => block.type === 'text').map(block => block.text).join('');
  const calls = uses.map(block => ({ id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) }));
  return {
    calls, output: [],
    message: { role: 'assistant', content, claude_content: message.content, ...(uses.length ? { tool_calls: calls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) } : {}) },
  };
}
