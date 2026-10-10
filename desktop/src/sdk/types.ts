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
}
