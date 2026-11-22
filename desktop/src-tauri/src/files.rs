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

/// 总结存在哪：原文档所在的文件夹，文件名「原名 · 总结.md」，重名就加序号。
/// `previous` 是这段对话上一次存出来的那份；它还在同一个文件夹里、也是 Markdown 时就覆盖它，不再多出一份。
/// 把读者或助手给的名字收拾成能当文件名用的：去掉路径分隔符和系统不认的字符，不带扩展名。
pub fn clean_stem(name: &str) -> Result<String> {
    let kept: String = name.chars().filter(|c| !c.is_control() && !matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')).take(120).collect();
    let cleaned = kept.trim().trim_end_matches(|c: char| c == '.' || c == ' ').to_string();
    if cleaned.is_empty() { return Err("名字不能为空".into()); }
    let head = cleaned.split('.').next().unwrap_or("").trim().to_ascii_uppercase();
    let numbered = head.len() == 4 && (head.starts_with("COM") || head.starts_with("LPT")) && head.as_bytes()[3].is_ascii_digit();
    if numbered || matches!(head.as_str(), "CON" | "PRN" | "AUX" | "NUL") { return Err("这个名字是系统保留的，换一个".into()); }
    Ok(cleaned)
}

/// `name` 是助手给这份总结起的名字；没有或者不能用，就叫「原名 · 总结」。
pub fn summary_path(source: &Path, previous: Option<&Path>, name: Option<&str>) -> Result<PathBuf> {
    let folder = source.parent().ok_or("文档目录无效")?.canonicalize().map_err(|_| "原文档所在的文件夹已不存在")?;
    if let Some(previous) = previous {
        let same_folder = previous.parent().and_then(|parent| parent.canonicalize().ok()).is_some_and(|parent| parent == folder);
        let markdown = previous.extension().and_then(|s| s.to_str()).is_some_and(|s| s.eq_ignore_ascii_case("md"));
        if same_folder && markdown && previous != source { return Ok(previous.to_path_buf()); }
    }
    let stem = source.file_stem().and_then(|s| s.to_str()).ok_or("文件名不是有效的 Unicode")?;
    // Windows 的文件名最长 255 个字符，给后缀留出余地。
    let stem: String = stem.chars().take(180).collect();
    let base = name.and_then(|name| clean_stem(name).ok()).unwrap_or_else(|| format!("{stem} · 总结"));
    for index in 1..200 {
        let name = if index == 1 { format!("{base}.md") } else { format!("{base} {index}.md") };
        let path = folder.join(name);
        if !path.exists() { return Ok(path); }
    }
    Err("这个文件夹里同名的总结太多了".into())
}

/// 在系统的文件管理器里打开文档所在的文件夹，并选中这份文档；文件已经不在了就只打开文件夹。
pub fn reveal(path: &Path) -> Result<()> {
    let folder = path.parent().filter(|folder| folder.is_dir()).ok_or("文档所在的文件夹已不存在")?;
    open_folder(path, folder).map_err(|e| format!("无法打开文件夹：{e}"))
}

#[cfg(windows)]
fn open_folder(path: &Path, folder: &Path) -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;
    // 资源管理器不认 \\?\ 开头的长路径写法。
    fn plain(path: &Path) -> String {
        let text = path.to_string_lossy().into_owned();
        if let Some(rest) = text.strip_prefix(r"\\?\UNC\") { return format!(r"\\{rest}"); }
        text.strip_prefix(r"\\?\").map(str::to_owned).unwrap_or(text)
    }
    let mut command = std::process::Command::new("explorer.exe");
    // /select 和路径必须是同一个参数，路径里有空格时只给路径加引号（Windows 的文件名里不会有引号）。
    if path.is_file() { command.raw_arg(format!("/select,\"{}\"", plain(path))); } else { command.arg(plain(folder)); }
    command.spawn().map(|_| ())
}

#[cfg(target_os = "macos")]
fn open_folder(path: &Path, folder: &Path) -> std::io::Result<()> {
    let mut command = std::process::Command::new("open");
    if path.is_file() { command.arg("-R").arg(path); } else { command.arg(folder); }
    command.spawn().map(|_| ())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_folder(_path: &Path, folder: &Path) -> std::io::Result<()> {
    std::process::Command::new("xdg-open").arg(folder).spawn().map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn summary_goes_next_to_the_source() {
        let root = std::env::temp_dir().join(format!("phydog-summary-{}",uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("other")).unwrap();
        let source = root.join("群论 讲义.pdf"); fs::write(&source,"x").unwrap();
        let first = summary_path(&source,None,None).unwrap();
        assert_eq!(first.file_name().unwrap().to_str().unwrap(),"群论 讲义 · 总结.md");
        assert_eq!(first.parent().unwrap(),root.canonicalize().unwrap());
        fs::write(&first,"a").unwrap();
        // 没有上一份：另起一个名字；有上一份而且就在旁边：覆盖它。
        assert_eq!(summary_path(&source,None,None).unwrap().file_name().unwrap().to_str().unwrap(),"群论 讲义 · 总结 2.md");
        assert_eq!(summary_path(&source,Some(&first),Some("别的名字")).unwrap(),first);
        // 助手起了名字就用它，去掉不能当文件名的字符；起不出能用的就退回原来的叫法。
        assert_eq!(summary_path(&source,None,Some("群的定义: 置换/同态?")).unwrap().file_name().unwrap().to_str().unwrap(),"群的定义 置换同态.md");
        assert_eq!(summary_path(&source,None,Some(" .. ")).unwrap().file_name().unwrap().to_str().unwrap(),"群论 讲义 · 总结 2.md");
        assert!(clean_stem("con").is_err() && clean_stem("COM1.txt").is_err() && clean_stem("common").is_ok());
        // 上一份在别的文件夹、不是 Markdown、或者就是原文档自己：都不覆盖。
        let elsewhere = root.join("other").join("x.md"); fs::write(&elsewhere,"b").unwrap();
        assert_ne!(summary_path(&source,Some(&elsewhere),None).unwrap(),elsewhere);
        assert_ne!(summary_path(&source,Some(&source),None).unwrap(),source);
        fs::remove_dir_all(root).unwrap();
    }
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
