// User budgets are snapshotted per question. Transport and cache ceilings stay fixed.
export const DOCUMENT_LIMIT_FIELDS = Object.freeze([
  { key: 'images', label: '页图次数 / 每题', min: 1, max: 10, default: 5 },
  { key: 'pages', label: '证据页数 / 每题', min: 1, max: 40, default: 8 },
  { key: 'characters', label: '证据文字 / 每题（字符）', min: 1000, max: 120000, default: 24000, step: 1000 },
  { key: 'calls', label: 'PDF 读取次数 / 每题', min: 1, max: 60, default: 12 },
  { key: 'rounds', label: 'API 检索轮次 / 每题', min: 1, max: 8, default: 3 },
  { key: 'searchPages', label: '搜索扫描页数 / 每次', min: 10, max: 500, default: 120 },
  { key: 'searchMilliseconds', label: '搜索时间 / 每次（秒）', min: 1000, max: 30000, default: 10000, scale: 1000 },
].map(field => Object.freeze(field)));
export const DOCUMENT_LIMITS = Object.freeze({ ...Object.fromEntries(DOCUMENT_LIMIT_FIELDS.map(field => [field.key, field.default])), seedCharacters: 4000, pageBatch: 3 });
export const MODEL_STATE_CHARACTERS = 16 * 1024 * 1024;
export function normalizeDocumentLimits(value) {
  const clean = { ...DOCUMENT_LIMITS };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return clean;
  for (const field of DOCUMENT_LIMIT_FIELDS) {
    const number = value[field.key];
    if (typeof number === 'number' && Number.isFinite(number)) clean[field.key] = Math.max(field.min, Math.min(field.max, Math.trunc(number)));
  }
  return clean;
}
