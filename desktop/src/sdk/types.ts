export interface Doc {
  id: string;
  name: string;
  kind: 'pdf' | 'markdown';
  path: string;
  size: number;
  modifiedAt: number;
  addedAt: number;
  lastOpenedAt: number;
  progress: number;
  page: number;
  pageCount: number;
  tags: string[];
  starred: boolean;
}
export interface Library {
  list(query?: string): Promise<Doc[]>;
  importDocuments(): Promise<Doc[]>;
  read(id: string): Promise<Uint8Array>;
  update(id: string, patch: Partial<Doc>): Promise<Doc>;
  remove(id: string): Promise<void>;
  readAsset(id: string, relativePath: string): Promise<{data: Uint8Array; mime: string}>;
  index(id: string, text: string): Promise<void>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  /** 把一份总结存成 Markdown，放在原文档所在的文件夹里，并加入文档库。replace 是上次存出来的那份，还在就覆盖。 */
  saveSummary(id: string, text: string, replace?: string, name?: string): Promise<Doc>;
  /** 改文件名（不带扩展名）。磁盘上的文件跟着改，文档还是原来那一份。 */
  rename(id: string, name: string): Promise<Doc>;
  /** 在系统的文件管理器里打开文档所在的文件夹。 */
  reveal(id: string): Promise<void>;
}
