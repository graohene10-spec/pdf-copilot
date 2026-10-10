import { DocumentService, renderDocumentImage } from '../../../extension/reader/document-service.mjs';
import { MarkdownService, MARKDOWN_INSTRUCTIONS } from './markdown-service.mjs';

export async function createDocumentSession(context, descriptor, limits, vision, onEvidence, signal) {
  const id = crypto.randomUUID();
  const service = context.pdf
    ? new DocumentService(context.pdf, { name: descriptor.title }, () => context.page || 1, (page, rect, signal) => renderDocumentImage(context.pdf, page, rect, signal))
    : new MarkdownService(context.text || '', descriptor.title);
  const anchor = context.pdf ? context.selection?.page || context.page || 1 : Math.max(1, Math.ceil((context.line || context.selection?.line || context.page || 1) / 80));
  const abort = () => service.close();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) { abort(); signal.throwIfAborted(); }
  let seed;
  try { seed = await service.begin(id, anchor, vision, context.selection?.rect, limits); }
  catch (error) { signal?.removeEventListener('abort', abort); service.close(); throw error; }
  onEvidence?.(seed.seed.evidence || []);
  const document = {
    remaining: seed.remaining,
    instructions: context.pdf ? '' : MARKDOWN_INSTRUCTIONS,
    async tool(name, args) {
      const value = await service.tool(id, name, args);
      if (value.remaining) document.remaining = value.remaining;
      onEvidence?.(value.evidence || []);
      return value;
    },
  };
  return { seed, document, close: () => { signal?.removeEventListener('abort', abort); service.close(); } };
}
