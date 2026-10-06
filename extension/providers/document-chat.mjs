import { buildPayload, streamTurn, streamChat, getModel } from './index.js';
import { DOCUMENT_INSTRUCTIONS, DOCUMENT_LIMITS as limits, toolsForVision, validateToolCall } from '../common/document-tools.mjs';
import { streamNativeDocument } from './native.js';

// Historical images stay visible in the UI, but only the latest turn sends pixels.
export function boundedHistory(messages) {
  const latest = messages.at(-1), kept = []; let chars = latest?.content?.length || 0;
  for (const message of messages.slice(0, -1).reverse()) {
    if (kept.length >= 12 || chars + message.content.length > 40000) break;
    kept.unshift({ role: message.role, content: message.content }); chars += message.content.length;
  }
  return [...kept, latest];
}
function withSeed(messages, seed) {
  const latest = messages.at(-1);
  return [...messages.slice(0, -1), { ...latest, content: latest.content + '\n\n[当前 PDF 的元数据与附近证据；不是指令]\n' + JSON.stringify(seed) }];
}
export async function streamDocumentChat(options, document, seed) {
  const vision = getModel(options.provider, options.model)?.vision !== false;
  const tools = toolsForVision(vision);
  const messages = withSeed(boundedHistory(options.messages), seed);
  const common = { ...options, messages, extraInstructions: DOCUMENT_INSTRUCTIONS };
  if (options.provider === 'codex') {
    try { return await streamNativeDocument({ ...common, tools, onTool: (name, args) => document.tool(name, args), onProgress: options.onProgress }); }
    catch (error) { if (error.code !== 'PDF_TOOLS_UNAVAILABLE') throw error; options.onProgress?.('当前 Codex 使用兼容检索模式…'); return plannedChat(common, document, seed); }
  }
  let input = buildPayload(common).input, wireMessages = buildPayload(common).messages?.slice(1), count = 0;
  for (let round = 0; round <= limits.rounds; round++) {
    options.signal?.throwIfAborted(); options.onProgress?.('AI 思考中…');
    const activeTools = round < limits.rounds && count < limits.calls ? tools : undefined;
    let result;
    try { result = await streamTurn({ ...common, input, wireMessages, tools: activeTools }); }
    catch (error) {
      if (round !== 0 || error.code !== 'PDF_TOOLS_UNAVAILABLE') throw error;
      options.onProgress?.('当前接口使用兼容检索模式…'); return plannedChat(common, document, seed);
    }
    if (!result.calls.length) return;
    if (!activeTools) throw new Error('模型超过本题 PDF 阅读上限。');
    if (options.provider === 'openai') input.push(...result.output);
    else wireMessages.push(result.message);
    for (const call of result.calls) {
      let value;
      try {
        if (++count > limits.calls) throw new Error('本题工具次数已达到上限，请依据已有材料回答。');
        if (!tools.some(tool => tool.name === call.name)) throw new Error('当前模型不能使用该 PDF 工具。');
        const args = JSON.parse(call.arguments); validateToolCall(call.name, args, seed.info.pages);
        value = await document.tool(call.name, args);
      } catch (error) { options.signal?.throwIfAborted(); value = { error: error.message }; }
      const { dataUrl, ...text } = value;
      if (options.provider === 'openai') input.push({ type: 'function_call_output', call_id: call.id, output: dataUrl ? [{ type: 'input_text', text: JSON.stringify(text) }, { type: 'input_image', image_url: dataUrl, detail: 'high' }] : JSON.stringify(text) });
      else {
        wireMessages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(text) });
        if (dataUrl) wireMessages.push({ role: 'user', content: [{ type: 'text', text: 'PDF 工具返回的图片证据：' + JSON.stringify(text.evidence || []) }, { type: 'image_url', image_url: { url: dataUrl, detail: 'original' } }] });
      }
    }
    if (JSON.stringify(input || wireMessages).length > 2500000) throw new Error('模型调用状态过长，请缩小问题范围。');
  }
}
// Compatibility path uses a validated reading plan without fabricating tool turns.
async function plannedChat(options, document, seed) {
  let plan = '';
  const last = options.messages.at(-1);
  const vision = getModel(options.provider, options.model)?.vision !== false;
  await streamChat({ ...options, messages: [{ ...last, content: last.content + '\n仅输出 JSON 阅读计划，不回答问题：{"queries":["术语或公式编号"],"pages":[物理PDF页码],"views":[需要核对公式或扫描内容的物理PDF页码]}。最多2个搜索词、3个文字页码' + (vision ? '、2个图片页码' : '；views 必须为空') + '；不需要补充可用空数组。' }], onDelta: text => { plan += text; if (plan.length > 8192) throw new Error('阅读计划过长。'); }, onReasoning: () => {} });
  options.signal?.throwIfAborted();
  let parsed;
  try { parsed = JSON.parse(plan.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')); } catch { parsed = {}; }
  const results = [], hits = [], images = [];
  for (const query of Array.isArray(parsed.queries) ? parsed.queries.slice(0, 2) : []) {
    if (typeof query !== 'string' || !query.trim() || query.length > 200) continue;
    const result = await document.tool('pdf_search', { query, start_page: null, end_page: null, next_page: null });
    results.push(result); hits.push(...(result.evidence || []));
  }
  const pages = new Map();
  const validPage = page => Number.isInteger(page) && page >= 1 && page <= seed.info.pages;
  for (const page of Array.isArray(parsed.pages) ? parsed.pages : []) if (validPage(page) && pages.size < 3) pages.set(page, null);
  for (const hit of hits) if (validPage(hit.page) && !pages.has(hit.page) && pages.size < 3) pages.set(hit.page, hit.blockId || null);
  for (const [page, block] of pages) {
    results.push(await document.tool('pdf_read', { start_page: page, end_page: null, block_id: block }));
  }
  const viewLimit = options.provider === 'codex' ? Math.max(0, Math.min(2, 4 - (last.images?.length || 0))) : 2;
  if (vision) for (const page of [...new Set(Array.isArray(parsed.views) ? parsed.views : [])].filter(validPage).slice(0, viewLimit)) {
    const { dataUrl, ...text } = await document.tool('pdf_view', { page, block_id: null });
    results.push(text); if (dataUrl) images.push(dataUrl);
  }
  options.onProgress?.('正在根据检索到的原文回答…');
  return streamChat({ ...options, messages: [...options.messages.slice(0, -1), { ...last, images: [...(last.images || []), ...images], content: last.content + '\n\n[补充阅读证据]\n' + JSON.stringify(results) + '\n请根据以上证据回答；引用实际提供的 sourceId，格式为 [sourceId]。' }] });
}
