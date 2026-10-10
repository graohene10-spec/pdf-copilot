use crate::db::Result;
use std::{fs, io::Read, path::{Component, Path, PathBuf}};

pub fn read_bounded(path: &Path, maximum: u64) -> Result<Vec<u8>> {
    let mut file = fs::File::open(path).map_err(|_| "无法读取文件，可能已移动或删除")?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > maximum { return Err("文件超过读取大小限制".into()); }
    let mut data = Vec::with_capacity(metadata.len() as usize);
    file.by_ref().take(maximum + 1).read_to_end(&mut data).map_err(|e| e.to_string())?;
    if data.len() as u64 > maximum { return Err("文件超过读取大小限制".into()); }
    Ok(data)
}

pub fn resolve_asset(document: &Path, relative_path: &str) -> Result<PathBuf> {
    if relative_path.is_empty() || relative_path.len() > 4096 || relative_path.contains('\0') { return Err("资源路径无效".into()); }
    let relative = Path::new(relative_path);
    if relative.is_absolute() || relative.components().any(|c| matches!(c,Component::ParentDir | Component::RootDir | Component::Prefix(_))) {
        return Err("只允许读取文档目录内的资源".into());
    }
    let root = document.parent().ok_or("文档目录无效")?.canonicalize().map_err(|e| e.to_string())?;
    let resolved = root.join(relative).canonicalize().map_err(|_| "找不到文档资源")?;
    // Canonicalization also resolves junctions/symlinks, so they cannot escape the allowed document directory.
    if !resolved.starts_with(&root) { return Err("资源不在文档目录内".into()); }
    let extension = resolved.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
    if !["png","jpg","jpeg","gif","webp","avif","bmp","svg"].contains(&extension.as_str()) {
        return Err("仅允许读取本地图片资源".into());
    }
    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn asset_scope_and_limits() {
        let root = std::env::temp_dir().join(format!("phydog-assets-{}",uuid::Uuid::new_v4()));
        let docs = root.join("docs"); fs::create_dir_all(docs.join("images")).unwrap();
        fs::write(docs.join("note.md"),"hello").unwrap(); fs::write(docs.join("images/test.png"),[1,2,3]).unwrap();
        fs::write(root.join("outside.png"),[1]).unwrap();
        assert!(resolve_asset(&docs.join("note.md"),"images/test.png").is_ok());
        assert!(resolve_asset(&docs.join("note.md"),"../outside.png").is_err());
        assert!(resolve_asset(&docs.join("note.md"),root.join("outside.png").to_str().unwrap()).is_err());
        assert!(resolve_asset(&docs.join("note.md"),"note.md").is_err());
        assert!(read_bounded(&docs.join("images/test.png"),2).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
