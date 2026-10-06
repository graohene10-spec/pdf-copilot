export function matchingInboxContexts(contexts, tabId, documentKey) {
  return (contexts || []).filter(context => {
    const source = context.source || {};
    if (source.tabId && source.tabId !== tabId) return false;
    // Enhanced-reader attachments name the actual loaded PDF, not its tab URL.
    return !source.fingerprint || source.fingerprint === documentKey;
  });
}
