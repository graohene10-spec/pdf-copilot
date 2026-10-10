import type { Doc, Library } from './types';
type RecordData = { doc: Doc; data: Uint8Array; text: string };
const MAX_BYTES = 256 * 1024 * 1024;
let connection: Promise<IDBDatabase> | null = null;
function db() {
  return connection ||= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('phydog-browser-prototype', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('documents', { keyPath: 'doc.id' }); request.result.createObjectStore('settings'); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法打开本地文档库。'));
  });
}
async function request<T>(store: string, mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(store, mode);
    const op = action(tx.objectStore(store));
    let result: T;
    op.onsuccess = () => { result = op.result; };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error || new Error('本地存储失败。'));
    op.onerror = () => reject(op.error);
  });
}
async function get(id: string) {
  const result = await request<RecordData | undefined>('documents', 'readonly', s => s.get(id));
  if (!result) throw new Error('文档已从库中移除。');
  return result;
}
async function put(record: RecordData) { await request('documents', 'readwrite', s => s.put(record)); return record.doc; }
export async function importFiles(files: File[]): Promise<Doc[]> {
  const records = await request<RecordData[]>('documents', 'readonly', s => s.getAll());
  const docs: Doc[] = [];
  for (const file of files) {
    const lower = file.name.toLowerCase();
    if (!/\.(pdf|md|markdown)$/.test(lower)) continue;
    if (file.size > MAX_BYTES) throw new Error('单个文档不能超过 256 MB。');
    const kind = lower.endsWith('.pdf') ? 'pdf' : 'markdown';
    const data = new Uint8Array(await file.arrayBuffer());
    if (kind === 'pdf' && !new TextDecoder().decode(data.slice(0,1024)).includes('%PDF-')) throw new Error('文件不是有效的 PDF。');
    const duplicate = records.find(r => r.doc.path === file.name && r.doc.size === file.size && r.doc.modifiedAt === file.lastModified);
    if (duplicate) { docs.push(duplicate.doc); continue; }
    const doc: Doc = { id: crypto.randomUUID(), name: file.name, kind, path: file.name, size: file.size, modifiedAt: file.lastModified, addedAt: Date.now(), lastOpenedAt: 0, progress: 0, page: 1, pageCount: 0, tags: [], starred: false };
    docs.push(await put({ doc, data, text: kind === 'markdown' ? new TextDecoder().decode(data) : '' }));
  }
  return docs;
}
let seed: Promise<void> | null = null;
async function seedSamples() {
  const seeded = await request('settings', 'readonly', s => s.get('samples-seeded'));
  if (seeded) return;
  const files: File[] = [];
  for (const [url, name] of [['/samples/welcome.md', '阅读工作台指南.md'], ['/samples/sample.pdf', 'PDF 阅读示例.pdf']]) {
    const response = await fetch(url);
    if (!response.ok) continue;
    files.push(new File([await response.arrayBuffer()], name, { lastModified: 0 }));
  }
  await importFiles(files);
  await request('settings', 'readwrite', s => s.put(true, 'samples-seeded'));
}
export const browserLibrary: Library = {
  async list(query = '') {
    await (seed ||= seedSamples());
    const records = await request<RecordData[]>('documents', 'readonly', s => s.getAll());
    const q = query.trim().toLocaleLowerCase();
    return records.filter(r => !q || [r.doc.name,...r.doc.tags,r.text].join(' ').toLocaleLowerCase().includes(q)).map(r => r.doc).sort((a,b) => b.lastOpenedAt - a.lastOpenedAt || b.addedAt - a.addedAt);
  },
  importDocuments() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input'); input.type = 'file'; input.accept = '.pdf,.md,.markdown'; input.multiple = true;
      input.addEventListener('cancel', () => resolve([]), { once: true });
      input.addEventListener('change', () => { importFiles(Array.from(input.files || [])).then(resolve,reject); }, { once: true });
      input.click();
    });
  },
  async read(id) { return (await get(id)).data.slice(); },
  async update(id, patch) {
    const record = await get(id);
    for (const key of ['tags','starred','progress','page','pageCount','lastOpenedAt'] as const) if (patch[key] !== undefined) Object.assign(record.doc, { [key]: patch[key] });
    return put(record);
  },
  async remove(id) { await request('documents', 'readwrite', s => s.delete(id)); },
  async readAsset() { throw new Error('浏览器预览不能读取文档旁的图片；桌面版本支持本地相对图片。'); },
  async index(id, text) { const record = await get(id); record.text = text.slice(0,2000000); await put(record); },
  async getSetting(key) { return (await request<string | undefined>('settings', 'readonly', s => s.get(key))) ?? null; },
  async setSetting(key,value) { await request('settings', 'readwrite', s => s.put(value,key)); },
};
