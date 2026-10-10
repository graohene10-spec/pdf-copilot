use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path, time::{SystemTime, UNIX_EPOCH}};

pub type Result<T> = std::result::Result<T, String>;
pub const MAX_TEXT_BYTES: usize = 10 * 1024 * 1024;

pub fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub path: String,
    pub size: u64,
    pub modified_at: u64,
    pub added_at: u64,
    pub last_opened_at: u64,
    pub progress: f64,
    pub page: u32,
    pub page_count: u32,
    pub tags: Vec<String>,
    pub starred: bool,
}

#[derive(Default, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentPatch {
    pub progress: Option<f64>,
    pub page: Option<u32>,
    pub page_count: Option<u32>,
    pub last_opened_at: Option<u64>,
    pub tags: Option<Vec<String>>,
    pub starred: Option<bool>,
}

pub struct Library {
    pub connection: Connection,
}

impl Library {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
        let connection = Connection::open(path).map_err(|e| e.to_string())?;
        connection.busy_timeout(std::time::Duration::from_secs(3)).map_err(|e| e.to_string())?;
        connection.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA foreign_keys=ON;
             CREATE TABLE IF NOT EXISTS documents (
               id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, name TEXT NOT NULL, kind TEXT NOT NULL,
               size INTEGER NOT NULL, modified_at INTEGER NOT NULL, added_at INTEGER NOT NULL,
               last_opened_at INTEGER, progress REAL NOT NULL DEFAULT 0, page INTEGER NOT NULL DEFAULT 1,
               page_count INTEGER NOT NULL DEFAULT 1, tags TEXT NOT NULL DEFAULT '[]', starred INTEGER NOT NULL DEFAULT 0
             );
             CREATE TABLE IF NOT EXISTS document_text (
               id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE, text TEXT NOT NULL
             );
             CREATE VIRTUAL TABLE IF NOT EXISTS document_search USING fts5(id UNINDEXED, name, tags, text, tokenize='trigram');
             CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             PRAGMA user_version=1;"
        ).map_err(|e| e.to_string())?;
        Ok(Self { connection })
    }

    fn row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Document> {
        let tags: String = row.get(11)?;
        Ok(Document {
            id: row.get(0)?, path: row.get(1)?, name: row.get(2)?, kind: row.get(3)?,
            size: row.get(4)?, modified_at: row.get(5)?, added_at: row.get(6)?,
            last_opened_at: row.get::<_,Option<u64>>(7)?.unwrap_or(0), progress: row.get(8)?, page: row.get(9)?,
            page_count: row.get(10)?, tags: serde_json::from_str(&tags).unwrap_or_default(), starred: row.get(12)?,
        })
    }

    pub fn get(&self, id: &str) -> Result<Document> {
        self.connection.query_row("SELECT * FROM documents WHERE id=?1", [id], Self::row)
            .optional().map_err(|e| e.to_string())?.ok_or_else(|| "文档不在文档库中".into())
    }

    pub fn list(&self, query: Option<&str>) -> Result<Vec<Document>> {
        let query = query.unwrap_or("").trim();
        if query.len() > 1024 { return Err("搜索词过长".into()); }
        let (sql, parameter) = if query.is_empty() {
            ("SELECT d.* FROM documents d ORDER BY COALESCE(last_opened_at,added_at) DESC LIMIT 1000", String::new())
        } else if query.chars().count() >= 3 {
            ("SELECT d.* FROM documents d JOIN document_search s ON d.id=s.id WHERE document_search MATCH ?1 ORDER BY bm25(document_search),d.added_at DESC LIMIT 1000", format!("\"{}\"", query.replace('"', "\"\"")))
        } else {
            // Trigram MATCH cannot find one/two-character Chinese words. Bound the fallback to this local library.
            ("SELECT d.* FROM documents d LEFT JOIN document_text t ON d.id=t.id WHERE instr(lower(d.name),lower(?1))>0 OR instr(lower(d.tags),lower(?1))>0 OR instr(lower(COALESCE(t.text,'')),lower(?1))>0 ORDER BY COALESCE(d.last_opened_at,d.added_at) DESC LIMIT 1000", query.into())
        };
        let mut statement = self.connection.prepare(sql).map_err(|e| e.to_string())?;
        let rows = if query.is_empty() { statement.query_map([], Self::row) } else { statement.query_map([parameter], Self::row) }
            .map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())
    }

    pub fn import(&mut self, paths: Vec<String>) -> Result<Vec<Document>> {
        if paths.len() > 200 { return Err("一次最多导入 200 份文档".into()); }
        // Validate the entire request before changing library metadata.
        let mut validated = Vec::new();
        let mut total_markdown_bytes = 0;
        for path in paths {
            let path = fs::canonicalize(path).map_err(|e| format!("无法读取文档：{e}"))?;
            let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
            if !metadata.is_file() { return Err("只能导入文件".into()); }
            let extension = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
            let kind = match extension.as_str() { "pdf" => "pdf", "md" | "markdown" | "mdown" => "markdown", _ => return Err("只支持 PDF 和 Markdown 文档".into()) };
            let size = metadata.len();
            if size > if kind == "pdf" { 256 * 1024 * 1024 } else { 16 * 1024 * 1024 } { return Err("文档超过原型的大小限制".into()); }
            let text = if kind == "markdown" {
                total_markdown_bytes += size;
                if total_markdown_bytes > 64 * 1024 * 1024 { return Err("一次导入的 Markdown 总大小不能超过 64 MiB".into()); }
                Some(fs::read_to_string(&path).map_err(|_| "Markdown 文档必须使用 UTF-8 编码")?)
            } else {
                use std::io::Read;
                let mut header = [0; 5];
                fs::File::open(&path).and_then(|mut f| f.read_exact(&mut header)).map_err(|_| "PDF 文件不完整")?;
                if &header != b"%PDF-" { return Err("文件不是有效的 PDF".into()); }
                None
            };
            let modified_at = metadata.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or_else(now);
            let name = path.file_name().and_then(|s| s.to_str()).ok_or("文件名不是有效的 Unicode")?.to_owned();
            validated.push((path.to_string_lossy().into_owned(), name, kind, size, modified_at, text));
        }
        let tx = self.connection.transaction().map_err(|e| e.to_string())?;
        let mut ids = Vec::new();
        for (path, name, kind, size, modified_at, text) in validated {
            let existing: Option<(String, u64, u64)> = tx.query_row("SELECT id,size,modified_at FROM documents WHERE path=?1", [&path], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(|e| e.to_string())?;
            let id = existing.as_ref().map(|e| e.0.clone()).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            tx.execute("INSERT INTO documents(id,path,name,kind,size,modified_at,added_at) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(path) DO UPDATE SET name=excluded.name,size=excluded.size,modified_at=excluded.modified_at", params![id,path,name,kind,size,modified_at,now()]).map_err(|e| e.to_string())?;
            if let Some(text) = text {
                let text = truncate_text(&text);
                tx.execute("INSERT INTO document_text(id,text) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET text=excluded.text", params![id,text]).map_err(|e| e.to_string())?;
            } else if existing.as_ref().is_some_and(|e| e.1 != size || e.2 != modified_at) {
                tx.execute("DELETE FROM document_text WHERE id=?1", [&id]).map_err(|e| e.to_string())?;
            }
            refresh_search(&tx, &id)?;
            if !ids.contains(&id) { ids.push(id); }
        }
        tx.commit().map_err(|e| e.to_string())?;
        ids.iter().map(|id| self.get(id)).collect()
    }

    pub fn update(&mut self, id: &str, patch: DocumentPatch) -> Result<Document> {
        let mut doc = self.get(id)?;
        if let Some(value) = patch.progress { if !value.is_finite() || !(0.0..=1.0).contains(&value) { return Err("阅读进度必须在 0 到 1 之间".into()); } doc.progress = value; }
        if let Some(value) = patch.page_count { if value == 0 || value > 100_000 { return Err("页数无效".into()); } doc.page_count = value; }
        if let Some(value) = patch.page { if value == 0 || value > doc.page_count { return Err("页码超出范围".into()); } doc.page = value; }
        doc.page = doc.page.min(doc.page_count);
        if let Some(value) = patch.tags {
            if value.len() > 32 { return Err("最多添加 32 个标签".into()); }
            doc.tags.clear();
            for tag in value {
                let tag = tag.trim();
                if tag.chars().count() > 64 { return Err("标签过长".into()); }
                if !tag.is_empty() && !doc.tags.iter().any(|t| t == tag) { doc.tags.push(tag.to_owned()); }
            }
        }
        if let Some(value) = patch.starred { doc.starred = value; }
        if let Some(value) = patch.last_opened_at { doc.last_opened_at = value.min(now() + 60_000); }
        let tx = self.connection.transaction().map_err(|e| e.to_string())?;
        let opened = (doc.last_opened_at > 0).then_some(doc.last_opened_at);
        tx.execute("UPDATE documents SET progress=?2,page=?3,page_count=?4,tags=?5,starred=?6,last_opened_at=?7 WHERE id=?1", params![id,doc.progress,doc.page,doc.page_count,serde_json::to_string(&doc.tags).unwrap(),doc.starred,opened]).map_err(|e| e.to_string())?;
        refresh_search(&tx, id)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(doc)
    }

    pub fn remove(&mut self, id: &str) -> Result<()> {
        let tx = self.connection.transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM document_search WHERE id=?1", [id]).map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM documents WHERE id=?1", [id]).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn index(&mut self, id: &str, text: &str) -> Result<()> {
        self.get(id)?;
        if text.len() > MAX_TEXT_BYTES { return Err("文本索引超过 10 MiB 限制".into()); }
        let tx = self.connection.transaction().map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO document_text(id,text) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET text=excluded.text", params![id,text]).map_err(|e| e.to_string())?;
        refresh_search(&tx, id)?;
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        validate_key(key)?;
        self.connection.query_row("SELECT value FROM settings WHERE key=?1", [key], |row| row.get(0)).optional().map_err(|e| e.to_string())
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        validate_key(key)?;
        if value.len() > 1024 * 1024 { return Err("设置内容过长".into()); }
        self.connection.execute("INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key,value]).map_err(|e| e.to_string())?;
        Ok(())
    }
}

fn validate_key(key: &str) -> Result<()> {
    if key.is_empty() || key.len() > 100 || !key.bytes().all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c)) { return Err("设置名称无效".into()); }
    Ok(())
}

fn truncate_text(text: &str) -> &str {
    let mut end = text.len().min(MAX_TEXT_BYTES);
    while !text.is_char_boundary(end) { end -= 1; }
    &text[..end]
}

fn refresh_search(connection: &Connection, id: &str) -> Result<()> {
    connection.execute("DELETE FROM document_search WHERE id=?1", [id]).map_err(|e| e.to_string())?;
    connection.execute("INSERT INTO document_search(id,name,tags,text) SELECT d.id,d.name,d.tags,COALESCE(t.text,'') FROM documents d LEFT JOIN document_text t ON t.id=d.id WHERE d.id=?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("phydog-db-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        root
    }
    #[test]
    fn persistence_dedup_and_chinese_search() {
        let root = fixture();
        let source = root.join("学术笔记.md");
        fs::write(&source,"# 阅读管理\n量子物理与现代文档工具").unwrap();
        let mut db = Library::open(&root.join("library.db")).unwrap();
        let imported = db.import(vec![source.to_string_lossy().into_owned()]).unwrap();
        let id = imported[0].id.clone();
        assert_eq!(db.import(vec![source.to_string_lossy().into_owned()]).unwrap()[0].id,id);
        assert_eq!(db.list(Some("量子物理")).unwrap().len(),1);
        assert_eq!(db.list(Some("量子")).unwrap().len(),1);
        assert!(db.list(Some("不存在")).unwrap().is_empty());
        assert!(db.list(Some("\" OR *")).unwrap().is_empty());
        db.update(&id,DocumentPatch{tags:Some(vec!["科学".into()," 科学 ".into()]),starred:Some(true),progress:Some(0.5),..Default::default()}).unwrap();
        assert_eq!(db.list(Some("科学")).unwrap().len(),1);
        assert!(db.update(&id,DocumentPatch{progress:Some(1.5),..Default::default()}).is_err());
        db.set_setting("appearance.theme","dark").unwrap();
        drop(db);
        let mut reopened = Library::open(&root.join("library.db")).unwrap();
        assert_eq!(reopened.get(&id).unwrap().tags,vec!["科学"]);
        assert_eq!(reopened.get(&id).unwrap().progress,0.5);
        assert_eq!(reopened.get_setting("appearance.theme").unwrap().as_deref(),Some("dark"));
        reopened.remove(&id).unwrap();
        assert!(source.exists());
        assert!(reopened.list(Some("量子")).unwrap().is_empty());
        drop(reopened);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn invalid_batch_does_not_partially_import() {
        let root = fixture();
        let md = root.join("valid.md"); let bad = root.join("invalid.pdf");
        fs::write(&md,"hello").unwrap(); fs::write(&bad,"not a PDF").unwrap();
        let mut db = Library::open(&root.join("library.db")).unwrap();
        assert!(db.import(vec![md.to_string_lossy().into_owned(),bad.to_string_lossy().into_owned()]).is_err());
        assert!(db.list(None).unwrap().is_empty());
        assert!(serde_json::from_str::<DocumentPatch>(r#"{"path":"arbitrary"}"#).is_err());
        drop(db); fs::remove_dir_all(root).unwrap();
    }
}
