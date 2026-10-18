//! In-app updates from the project's GitHub Releases.
//!
//! Only `desktop-vX.Y.Z[-pre]` releases of one fixed repository are considered;
//! other tags (the browser extension's `vX.Y.Z`) are ignored. Downloads are
//! limited to that repository's release assets, verified against the release's
//! `SHA256SUMS.txt`, and stored in a fixed temporary folder. Installation runs
//! only an installer from that folder, through a fixed command template; the
//! portable copy instead unpacks the verified ZIP over its own folder.
use crate::db::Result;
use reqwest::{Client, Response, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::{atomic::{AtomicBool, Ordering}, OnceLock},
    time::{Duration, Instant},
};
use tauri::ipc::Channel;

const RELEASES_API: &str = "https://api.github.com/repos/graohene10-spec/pdf-copilot/releases?per_page=30";
const REPO_PAGES: &str = "/graohene10-spec/pdf-copilot";
const RELEASE_PAGES: &str = "/graohene10-spec/pdf-copilot/releases";
const ASSET_PATH: &str = "/graohene10-spec/pdf-copilot/releases/download/desktop-v";
const TAG_PREFIX: &str = "desktop-v";
const SETUP_SUFFIX: &str = "_x64-setup.exe";
const PORTABLE_SUFFIX: &str = "_x64-portable.zip";
/// Files replaced by a portable update keep this suffix until the next launch removes them.
const OLD_SUFFIX: &str = ".kaizhi-old";
const MAX_UNPACKED_BYTES: u64 = 1024 * 1024 * 1024;
const USER_AGENT: &str = concat!("kaizhi-desktop/", env!("CARGO_PKG_VERSION"));
const UPDATE_DIR: &str = "kaizhi-update";
const MAX_NOTES_CHARS: usize = 20_000;
const MAX_API_BYTES: usize = 4 * 1024 * 1024;
const MAX_SUMS_BYTES: usize = 256 * 1024;
const MAX_INSTALLER_BYTES: u64 = 512 * 1024 * 1024;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

static DOWNLOADING: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);

#[derive(Deserialize, Debug, Clone)]
struct Release {
    tag_name: String,
    #[serde(default)] name: Option<String>,
    #[serde(default)] body: Option<String>,
    #[serde(default)] draft: bool,
    #[serde(default)] prerelease: bool,
    #[serde(default)] published_at: Option<String>,
    #[serde(default)] html_url: String,
    #[serde(default)] assets: Vec<Asset>,
}

#[derive(Deserialize, Debug, Clone)]
struct Asset { name: String, #[serde(default)] size: u64, browser_download_url: String }

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInstaller { pub name: String, pub url: String, pub size: u64, pub sha256: String, pub kind: String }

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub tag: String,
    pub name: String,
    pub notes: String,
    pub published_at: Option<String>,
    pub html_url: String,
    pub prerelease: bool,
    /// `None` when the release has no installer or no checksum for it: the
    /// frontend then offers the release page instead of an in-app install.
    pub installer: Option<UpdateInstaller>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus { pub current: String, pub installed: bool }

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress { pub downloaded: u64, pub total: Option<u64> }

fn client() -> Result<&'static Client> {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() { return Ok(client); }
    // System proxy and verified TLS as in http_stream; redirects are followed
    // only within GitHub's release hosts (asset downloads redirect once).
    let policy = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 5 { attempt.error("too many redirects") }
        else if allowed_host(attempt.url()) { attempt.follow() }
        else { attempt.stop() }
    });
    #[allow(unused_mut)]
    let mut builder = Client::builder().user_agent(USER_AGENT).redirect(policy)
        .connect_timeout(Duration::from_secs(20)).read_timeout(Duration::from_secs(60));
    // Live tests may run behind a TLS-inspecting proxy; release builds never read this.
    #[cfg(test)]
    if let Some(certificates) = std::env::var_os("SSL_CERT_FILE").and_then(|path| std::fs::read(path).ok()).and_then(|pem| reqwest::Certificate::from_pem_bundle(&pem).ok()) {
        for certificate in certificates { builder = builder.add_root_certificate(certificate); }
    }
    let client = builder.build().map_err(|_| "无法初始化网络连接")?;
    Ok(CLIENT.get_or_init(|| client))
}

fn allowed_host(url: &Url) -> bool {
    url.scheme() == "https" && url.port().is_none() && url.username().is_empty() && url.password().is_none()
        && matches!(url.host_str(), Some("github.com" | "api.github.com" | "objects.githubusercontent.com" | "release-assets.githubusercontent.com"))
}

/// The caller may only download an installer asset of a desktop release.
fn validate_asset_url(address: &str) -> Result<(Url, String)> {
    let invalid = || "更新下载地址无效".to_string();
    if address.len() > 2048 || address.chars().any(char::is_control) { return Err(invalid()); }
    let url = Url::parse(address).map_err(|_| invalid())?;
    if !allowed_host(&url) || url.host_str() != Some("github.com") || url.query().is_some() || url.fragment().is_some() || !url.path().starts_with(ASSET_PATH) {
        return Err(invalid());
    }
    let name = url.path_segments().and_then(|mut segments| segments.next_back()).unwrap_or_default().to_owned();
    if !safe_file_name(&name) || !is_update_file(&name) { return Err(invalid()); }
    Ok((url, name))
}

/// The installer (installed copies) or the portable ZIP (portable copies).
fn is_update_file(name: &str) -> bool { name.ends_with("-setup.exe") || name.ends_with(PORTABLE_SUFFIX) }

fn safe_file_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 128 && !name.starts_with('.')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '+'))
}

fn parse_version(tag: &str) -> Option<semver::Version> {
    semver::Version::parse(tag.strip_prefix(TAG_PREFIX)?).ok()
}

/// Highest non-draft desktop release strictly newer than `current`.
fn select_release(releases: Vec<Release>, current: &semver::Version, include_prerelease: bool) -> Option<(semver::Version, Release)> {
    releases.into_iter()
        .filter(|release| !release.draft)
        .filter_map(|release| parse_version(&release.tag_name).map(|version| (version, release)))
        .filter(|(version, release)| include_prerelease || (!release.prerelease && version.pre.is_empty()))
        .filter(|(version, _)| version > current)
        .max_by(|(a, _), (b, _)| a.cmp(b))
}

/// `sha256sum` format: `<64 hex>  <name>` (a `*` before the name marks binary mode).
fn checksum_for(sums: &str, name: &str) -> Option<String> {
    sums.lines().find_map(|line| {
        let (hash, file) = line.trim().split_once(char::is_whitespace)?;
        let file = file.trim_start().trim_start_matches('*').trim();
        (file == name && is_sha256(hash)).then(|| hash.to_ascii_lowercase())
    })
}

fn is_sha256(value: &str) -> bool { value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit()) }

fn truncate_notes(notes: &str) -> String {
    match notes.char_indices().nth(MAX_NOTES_CHARS) {
        Some((index, _)) => format!("{}\n\n…", &notes[..index]),
        None => notes.to_owned(),
    }
}

async fn read_limited(mut response: Response, limit: usize) -> Result<Vec<u8>> {
    if response.content_length().is_some_and(|size| size > limit as u64) { return Err("更新信息超过大小限制".into()); }
    let mut data = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "读取更新信息失败，请检查网络连接")? {
        if data.len() + chunk.len() > limit { return Err("更新信息超过大小限制".into()); }
        data.extend_from_slice(&chunk);
    }
    Ok(data)
}

async fn get(url: Url, accept: &str) -> Result<Response> {
    let response = client()?.get(url).header(reqwest::header::ACCEPT, accept).timeout(Duration::from_secs(30))
        .send().await.map_err(|_| "无法连接 GitHub，请检查网络或代理设置")?;
    if !allowed_host(response.url()) { return Err("更新服务器地址无效".into()); }
    let status = response.status();
    if status.is_success() { return Ok(response); }
    let limited = response.headers().get("x-ratelimit-remaining").is_some_and(|value| value == "0");
    Err(if limited || status.as_u16() == 429 { "GitHub 请求次数已达上限，请稍后再试".into() }
        else { format!("GitHub 返回了错误（HTTP {}）", status.as_u16()) })
}

async fn installer_checksum(release: &Release, name: &str) -> Option<String> {
    let asset = release.assets.iter().find(|asset| asset.name == "SHA256SUMS.txt")?;
    let url = Url::parse(&asset.browser_download_url).ok().filter(allowed_host)?;
    let data = read_limited(get(url, "application/octet-stream").await.ok()?, MAX_SUMS_BYTES).await.ok()?;
    checksum_for(&String::from_utf8_lossy(&data), name)
}

pub async fn check(include_prerelease: bool) -> Result<Option<UpdateInfo>> {
    check_against(&semver::Version::parse(env!("CARGO_PKG_VERSION")).map_err(|e| e.to_string())?, include_prerelease, status().installed).await
}

/// Installed copies update through the setup program, portable copies through the portable ZIP.
async fn check_against(current: &semver::Version, include_prerelease: bool, installed: bool) -> Result<Option<UpdateInfo>> {
    let response = get(Url::parse(RELEASES_API).map_err(|e| e.to_string())?, "application/vnd.github+json").await?;
    let releases: Vec<Release> = serde_json::from_slice(&read_limited(response, MAX_API_BYTES).await?).map_err(|_| "GitHub 返回的发布信息无法识别")?;
    let Some((version, release)) = select_release(releases, current, include_prerelease) else { return Ok(None) };
    let mut installer = None;
    let (suffix, kind) = if installed { (SETUP_SUFFIX, "setup") } else { (PORTABLE_SUFFIX, "portable") };
    if let Some(asset) = release.assets.iter().find(|asset| asset.name.ends_with(suffix) && validate_asset_url(&asset.browser_download_url).is_ok()) {
        if let Some(sha256) = installer_checksum(&release, &asset.name).await {
            installer = Some(UpdateInstaller { name: asset.name.clone(), url: asset.browser_download_url.clone(), size: asset.size, sha256, kind: kind.into() });
        }
    }
    let html_url = Url::parse(&release.html_url).ok().filter(is_release_page).map(String::from)
        .unwrap_or_else(|| format!("https://github.com{RELEASE_PAGES}/tag/{}", release.tag_name));
    Ok(Some(UpdateInfo {
        version: version.to_string(),
        name: release.name.clone().filter(|name| !name.trim().is_empty()).unwrap_or_else(|| format!("开智 {version}")),
        notes: truncate_notes(release.body.as_deref().unwrap_or_default()),
        prerelease: release.prerelease || !version.pre.is_empty(),
        tag: release.tag_name, published_at: release.published_at, html_url, installer,
    }))
}

fn update_dir() -> PathBuf { std::env::temp_dir().join(UPDATE_DIR) }

/// NSIS installs place `uninstall.exe` beside the program; the portable ZIP does not.
pub fn status() -> UpdateStatus {
    let installed = cfg!(windows) && std::env::current_exe().ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("uninstall.exe").is_file())).unwrap_or(false);
    UpdateStatus { current: env!("CARGO_PKG_VERSION").into(), installed }
}

struct DownloadGuard;
impl Drop for DownloadGuard { fn drop(&mut self) { DOWNLOADING.store(false, Ordering::SeqCst); } }

pub fn cancel() { CANCEL.store(true, Ordering::SeqCst); }

pub async fn download(url: String, sha256: String, channel: Channel<DownloadProgress>) -> Result<String> {
    download_with(url, sha256, update_dir(), move |progress| channel.send(progress).map_err(|_| "阅读窗口已关闭".into())).await
}

async fn download_with(url: String, sha256: String, dir: PathBuf, progress: impl Fn(DownloadProgress) -> Result<()>) -> Result<String> {
    let (url, name) = validate_asset_url(&url)?;
    if !is_sha256(&sha256) { return Err("更新校验值无效".into()); }
    let expected = sha256.to_ascii_lowercase();
    if DOWNLOADING.swap(true, Ordering::SeqCst) { return Err("更新正在下载".into()); }
    let _guard = DownloadGuard;
    CANCEL.store(false, Ordering::SeqCst);
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建更新下载目录：{e}"))?;
    let partial = dir.join(format!("{name}.partial"));
    let target = dir.join(&name);
    let result = stream_to_file(url, &partial, &expected, &progress).await;
    if let Err(error) = result {
        let _ = std::fs::remove_file(&partial);
        return Err(error);
    }
    let _ = std::fs::remove_file(&target);
    std::fs::rename(&partial, &target).map_err(|e| format!("无法保存更新安装包：{e}"))?;
    Ok(target.to_string_lossy().into_owned())
}

async fn stream_to_file(url: Url, path: &Path, expected: &str, progress: &impl Fn(DownloadProgress) -> Result<()>) -> Result<()> {
    let mut response = get(url, "application/octet-stream").await.map_err(|error| format!("下载更新失败：{error}"))?;
    let total = response.content_length();
    if total.is_some_and(|size| size > MAX_INSTALLER_BYTES) { return Err("更新安装包超过大小限制".into()); }
    // Chunks are at most a few dozen KiB, so plain blocking writes stay short.
    let mut file = std::fs::File::create(path).map_err(|e| format!("无法写入更新安装包：{e}"))?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0_u64;
    let mut last = Instant::now();
    progress(DownloadProgress { downloaded, total })?;
    loop {
        if CANCEL.load(Ordering::SeqCst) { return Err("已取消下载".into()); }
        let Some(chunk) = response.chunk().await.map_err(|_| "下载更新中断，请检查网络连接")? else { break };
        downloaded += chunk.len() as u64;
        if downloaded > MAX_INSTALLER_BYTES || total.is_some_and(|size| downloaded > size) { return Err("更新安装包大小不符".into()); }
        hasher.update(&chunk);
        file.write_all(&chunk).map_err(|e| format!("无法写入更新安装包：{e}"))?;
        if last.elapsed() >= PROGRESS_INTERVAL { last = Instant::now(); progress(DownloadProgress { downloaded, total })?; }
    }
    if CANCEL.load(Ordering::SeqCst) { return Err("已取消下载".into()); }
    if total.is_some_and(|size| downloaded != size) { return Err("下载更新中断，请重试".into()); }
    file.sync_all().map_err(|e| format!("无法写入更新安装包：{e}"))?;
    drop(file);
    let actual: String = hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect();
    if actual != expected { return Err("安装包校验失败（SHA-256 不一致），已删除下载的文件".into()); }
    progress(DownloadProgress { downloaded, total })?;
    Ok(())
}

fn is_page_under(url: &Url, prefix: &str) -> bool {
    allowed_host(url) && url.host_str() == Some("github.com") && url.query().is_none()
        && (url.path() == prefix || url.path().starts_with(&format!("{prefix}/")))
}

fn is_release_page(url: &Url) -> bool { is_page_under(url, RELEASE_PAGES) }

/// Opens a page of this repository (release page, or a document linked from
/// the release notes) in the default browser. Nothing else can be opened.
pub fn open_page(address: &str) -> Result<()> {
    let refused = || "只能打开开智在 GitHub 上的页面".to_string();
    let url = Url::parse(address).ok().filter(|url| address.len() <= 2048 && is_page_under(url, REPO_PAGES)).ok_or_else(refused)?;
    let url = url.as_str();
    if url.chars().any(|c| c.is_control() || matches!(c, '"' | '^' | '%' | ' ')) { return Err(refused()); }
    #[cfg(windows)] let mut command = std::process::Command::new("explorer.exe");
    #[cfg(target_os = "macos")] let mut command = std::process::Command::new("open");
    #[cfg(all(unix, not(target_os = "macos")))] let mut command = std::process::Command::new("xdg-open");
    command.arg(url).spawn().map(|_| ()).map_err(|e| format!("无法打开浏览器：{e}"))
}

/// Checks that `path` is an installer this module downloaded.
fn verified_installer(path: &str) -> Result<PathBuf> {
    let invalid = || "更新安装包路径无效".to_string();
    let path = Path::new(path).canonicalize().map_err(|_| invalid())?;
    let dir = update_dir().canonicalize().map_err(|_| invalid())?;
    let name = path.file_name().and_then(|name| name.to_str()).ok_or_else(invalid)?;
    if path.parent() != Some(dir.as_path()) || !safe_file_name(name) || !is_update_file(name) || !path.is_file() { return Err(invalid()); }
    Ok(path)
}

#[cfg(not(windows))]
pub fn install(_app: &tauri::AppHandle, path: &str) -> Result<()> {
    verified_installer(path)?;
    Err("自动安装仅支持 Windows".into())
}

/// Installs a downloaded update and restarts 开智.
///
/// Installed copies run the NSIS installer silently (`/S`); Tauri's installer
/// reuses the existing install folder and closes a still-running 开智 by
/// itself. Portable copies unpack the verified ZIP over their own folder.
/// Either way a detached `cmd` waits ~2 s for this process to exit and then
/// starts the updated program.
#[cfg(windows)]
pub fn install(app: &tauri::AppHandle, path: &str) -> Result<()> {
    let package = verified_installer(path)?;
    let exe = std::env::current_exe().map_err(|_| "无法确定开智的安装位置")?;
    let portable = package.to_string_lossy().ends_with(PORTABLE_SUFFIX);
    if portable == status().installed { return Err("更新包与当前版本类型不符，请重新检查更新".into()); }
    if portable {
        let dir = exe.parent().ok_or("无法确定开智所在的文件夹")?;
        apply_portable(&package, dir, &exe)?;
        relaunch(None, &exe)?;
    } else {
        relaunch(Some(&package), &exe)?;
    }
    let app = app.clone();
    std::thread::spawn(move || { std::thread::sleep(Duration::from_millis(300)); app.exit(0); });
    Ok(())
}

/// Unpacks a verified portable ZIP into a staging folder, then swaps its files
/// into `dir`. A file in use (the running exe) can still be renamed on Windows,
/// so each existing file is first moved aside with [`OLD_SUFFIX`]; on any error
/// every swapped file is put back. Files not in the ZIP (user data) are untouched.
#[cfg_attr(not(windows), allow(dead_code))]
fn apply_portable(package: &Path, dir: &Path, exe: &Path) -> Result<()> {
    let staging = update_dir().join("portable");
    let _ = std::fs::remove_dir_all(&staging);
    let files = unpack(package, &staging)?;
    let exe_name = exe.file_name().ok_or("无法确定开智的程序文件")?;
    if !files.iter().any(|file| file.as_os_str() == exe_name) { return Err("更新包里没有开智的程序文件，已取消更新".into()); }
    let mut swapped: Vec<(PathBuf, Option<PathBuf>)> = Vec::new();
    let result = (|| -> Result<()> {
        for file in &files {
            let target = dir.join(file);
            if let Some(parent) = target.parent() { std::fs::create_dir_all(parent).map_err(|e| format!("无法写入开智所在的文件夹：{e}"))?; }
            let old = target.exists().then(|| aside(&target)).transpose()?;
            swapped.push((target.clone(), old));
            std::fs::copy(staging.join(file), &target).map_err(|e| format!("无法替换 {}：{e}", file.display()))?;
        }
        Ok(())
    })();
    if let Err(error) = result {
        for (target, old) in swapped.into_iter().rev() {
            let _ = std::fs::remove_file(&target);
            if let Some(old) = old { let _ = std::fs::rename(old, &target); }
        }
        return Err(format!("{error}。开智保持原版本，可稍后重试"));
    }
    let _ = std::fs::remove_dir_all(&staging);
    Ok(())
}

/// Moves `target` to a free `<name>.kaizhi-old[.n]` beside it.
#[cfg_attr(not(windows), allow(dead_code))]
fn aside(target: &Path) -> Result<PathBuf> {
    let name = target.file_name().ok_or("更新路径无效")?.to_string_lossy().into_owned();
    for index in 0..32 {
        let old = target.with_file_name(if index == 0 { format!("{name}{OLD_SUFFIX}") } else { format!("{name}{OLD_SUFFIX}.{index}") });
        // An older leftover may still be locked by a process that has not exited yet.
        if old.exists() && std::fs::remove_file(&old).is_err() { continue; }
        return std::fs::rename(target, &old).map(|_| old).map_err(|e| format!("无法替换 {name}：{e}"));
    }
    Err(format!("无法替换 {name}：旧文件仍被占用"))
}

/// Extracts every file of the ZIP below `staging`, dropping the single top-level
/// folder the release packs everything into. Returns the relative file paths.
#[cfg_attr(not(windows), allow(dead_code))]
fn unpack(package: &Path, staging: &Path) -> Result<Vec<PathBuf>> {
    let broken = |_| "更新包已损坏，请重新下载".to_string();
    let mut archive = zip::ZipArchive::new(std::fs::File::open(package).map_err(|e| format!("无法读取更新包：{e}"))?).map_err(broken)?;
    let mut names = Vec::new();
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(broken)?;
        // enclosed_name rejects absolute paths and `..`, so nothing lands outside staging.
        let path = entry.enclosed_name().ok_or("更新包含有无效路径，已取消更新")?;
        names.push((index, path, entry.is_dir()));
    }
    let root = names.first().and_then(|(_, path, _)| path.components().next()).map(|part| PathBuf::from(part.as_os_str()));
    let strip = root.filter(|root| names.iter().all(|(_, path, dir)| path.starts_with(root) && (path != root || *dir)));
    let mut files = Vec::new();
    let mut total = 0_u64;
    for (index, path, dir) in names {
        let relative = match &strip { Some(root) => path.strip_prefix(root).map(Path::to_path_buf).unwrap_or_default(), None => path };
        if dir || relative.as_os_str().is_empty() { continue; }
        let mut entry = archive.by_index(index).map_err(broken)?;
        total += entry.size();
        if total > MAX_UNPACKED_BYTES { return Err("更新包解压后超过大小限制".into()); }
        let target = staging.join(&relative);
        if let Some(parent) = target.parent() { std::fs::create_dir_all(parent).map_err(|e| format!("无法解压更新包：{e}"))?; }
        let mut output = std::fs::File::create(&target).map_err(|e| format!("无法解压更新包：{e}"))?;
        std::io::copy(&mut entry, &mut output).map_err(|e| format!("无法解压更新包：{e}"))?;
        files.push(relative);
    }
    if files.is_empty() { return Err("更新包是空的，已取消更新".into()); }
    Ok(files)
}

/// Deletes files a previous portable update moved aside. Runs at startup; files
/// still locked are left for a later launch.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn remove_leftovers() {
    let Some(dir) = std::env::current_exe().ok().and_then(|exe| exe.parent().map(Path::to_path_buf)) else { return };
    remove_leftovers_in(&dir, 0);
}

#[cfg_attr(not(windows), allow(dead_code))]
fn remove_leftovers_in(dir: &Path, depth: usize) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_dir() && depth < 4 { remove_leftovers_in(&path, depth + 1); }
        else if kind.is_file() && entry.file_name().to_string_lossy().contains(OLD_SUFFIX) { let _ = std::fs::remove_file(path); }
    }
}

/// In a detached `cmd`: wait ~2 s for this app to exit, run the NSIS installer
/// silently when there is one, then start `exe` again.
#[cfg(windows)]
fn relaunch(setup: Option<&Path>, exe: &Path) -> Result<()> {
    use std::{os::windows::process::CommandExt, process::{Command, Stdio}};
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
    let plain = |path: &Path| path.to_str().map(|s| s.strip_prefix(r"\\?\").unwrap_or(s).to_owned()).filter(|s| !s.contains(['"', '%', '\r', '\n']));
    let unsupported = || "安装路径包含不支持的字符，无法自动更新".to_string();
    let exe = plain(exe).ok_or_else(unsupported)?;
    let install = match setup { Some(setup) => format!(r#"start "" /wait "{}" /S & "#, plain(setup).ok_or_else(unsupported)?), None => String::new() };
    // `cmd /S /C "<line>"` strips exactly the outer quotes; both paths are quoted
    // and contain no `"` or `%`, so cmd interprets nothing inside them.
    let line = format!(r#"/D /S /C "ping -n 3 127.0.0.1 >nul & {install}start "" "{exe}""#);
    let spawn = |flags: u32| Command::new("cmd.exe").raw_arg(&line).creation_flags(flags)
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn();
    // Breaking away keeps the helper alive if the app runs inside a job object
    // that kills its children on exit; not every job allows it, hence the retry.
    spawn(CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB).or_else(|_| spawn(CREATE_NO_WINDOW))
        .map(|_| ()).map_err(|e| format!("无法启动更新程序：{e}"))
}

#[tauri::command]
pub fn update_status(window: tauri::Window) -> Result<UpdateStatus> {
    super::main_window(&window)?;
    Ok(status())
}

#[tauri::command]
pub async fn update_check(window: tauri::Window, include_prerelease: bool) -> Result<Option<UpdateInfo>> {
    super::main_window(&window)?;
    check(include_prerelease).await
}

#[tauri::command]
pub async fn update_download(window: tauri::Window, url: String, sha256: String, on_progress: Channel<DownloadProgress>) -> Result<String> {
    super::main_window(&window)?;
    download(url, sha256, on_progress).await
}

#[tauri::command]
pub fn update_cancel(window: tauri::Window) -> Result<()> {
    super::main_window(&window)?;
    cancel();
    Ok(())
}

#[tauri::command]
pub fn update_install(window: tauri::Window, app: tauri::AppHandle, path: String) -> Result<()> {
    super::main_window(&window)?;
    install(&app, &path)
}

#[tauri::command]
pub fn update_open_page(window: tauri::Window, url: String) -> Result<()> {
    super::main_window(&window)?;
    open_page(&url)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release(tag: &str, prerelease: bool, draft: bool) -> Release {
        Release { tag_name: tag.into(), name: None, body: None, draft, prerelease, published_at: None, html_url: String::new(), assets: vec![] }
    }

    #[test]
    fn selects_highest_newer_desktop_release_on_the_chosen_channel() {
        let current = semver::Version::parse("0.2.2").unwrap();
        let list = || vec![
            release("v0.3.3", false, false), release("desktop-v0.2.2", false, false), release("desktop-v0.2.10", false, false),
            release("desktop-v0.3.0-beta.2", true, false), release("desktop-v0.3.0-beta.10", true, false),
            release("desktop-v0.9.0", false, true), release("desktop-vbroken", false, false),
        ];
        assert_eq!(select_release(list(), &current, false).unwrap().0.to_string(), "0.2.10");
        assert_eq!(select_release(list(), &current, true).unwrap().0.to_string(), "0.3.0-beta.10");
        let newest = semver::Version::parse("0.3.0").unwrap();
        assert!(select_release(list(), &newest, true).is_none());
        // A pre-release suffix counts as a test build even without GitHub's flag.
        assert!(select_release(vec![release("desktop-v0.4.0-rc.1", false, false)], &current, false).is_none());
        assert!(semver::Version::parse("0.3.0-beta.1").unwrap() < semver::Version::parse("0.3.0").unwrap());
    }

    #[test]
    fn reads_checksums_and_restricts_urls() {
        let sums = "6D7AB464B7EB83313671108742CDFAB2B3AC81F5B5E4D71B924C77C6184C19A9  kaizhi_0.2.2_x64-setup.exe\nb9ebfe51c3fc5e8f014e59a3bee9140c1c80eb2d3717a9a14f3b187fed03764e *kaizhi_0.2.2_x64-portable.zip\n";
        assert_eq!(checksum_for(sums, "kaizhi_0.2.2_x64-setup.exe").unwrap(), "6d7ab464b7eb83313671108742cdfab2b3ac81f5b5e4d71b924c77c6184c19a9");
        assert!(checksum_for(sums, "kaizhi_0.2.2_x64-portable.zip").is_some());
        assert!(checksum_for(sums, "setup.exe").is_none());
        assert!(validate_asset_url("https://github.com/graohene10-spec/pdf-copilot/releases/download/desktop-v0.2.2/kaizhi_0.2.2_x64-setup.exe").is_ok());
        assert!(validate_asset_url("https://github.com/graohene10-spec/pdf-copilot/releases/download/desktop-v0.2.2/kaizhi_0.2.2_x64-portable.zip").is_ok());
        assert!(validate_asset_url("https://github.com/graohene10-spec/pdf-copilot/releases/download/desktop-v0.2.2/kaizhi_0.2.2_source.zip").is_err());
        for url in [
            "http://github.com/graohene10-spec/pdf-copilot/releases/download/desktop-v0.2.2/kaizhi_0.2.2_x64-setup.exe",
            "https://github.com/other/pdf-copilot/releases/download/desktop-v0.2.2/kaizhi_0.2.2_x64-setup.exe",
            "https://github.com/graohene10-spec/pdf-copilot/releases/download/v0.3.3/pdf-copilot-0.3.3.zip",
            "https://github.com/graohene10-spec/pdf-copilot/releases/download/desktop-v0.2.2/..%2Fevil-setup.exe",
            "https://evil.example/graohene10-spec/pdf-copilot/releases/download/desktop-v0.2.2/kaizhi_0.2.2_x64-setup.exe",
            "https://github.com:8443/graohene10-spec/pdf-copilot/releases/download/desktop-v0.2.2/kaizhi_0.2.2_x64-setup.exe",
        ] { assert!(validate_asset_url(url).is_err(), "{url}"); }
        assert!(is_release_page(&Url::parse("https://github.com/graohene10-spec/pdf-copilot/releases/tag/desktop-v0.2.2").unwrap()));
        assert!(!is_release_page(&Url::parse("https://github.com/graohene10-spec/pdf-copilot-evil/releases").unwrap()));
        assert!(!is_release_page(&Url::parse("https://github.com/graohene10-spec/pdf-copilot/releasesx").unwrap()));
        assert!(is_page_under(&Url::parse("https://github.com/graohene10-spec/pdf-copilot/blob/desktop-v0.2.2/desktop/README.md").unwrap(), REPO_PAGES));
        for url in ["file:///C:/Windows/System32/calc.exe", "https://github.com/graohene10-spec/pdf-copilot-evil", "https://github.com/graohene10-spec/pdf-copilot/releases?x=\"&calc", "https://github.com.evil/graohene10-spec/pdf-copilot", "https://github.com/graohene10-spec/pdf-copilot/%22%26calc"] {
            assert!(open_page(url).is_err(), "{url}");
        }
        assert_eq!(truncate_notes(&"字".repeat(MAX_NOTES_CHARS + 5)).chars().count(), MAX_NOTES_CHARS + 3);
    }

    /// Live check against the real repository: `cargo test -- --ignored live_`.
    #[test]
    #[ignore]
    fn live_check_and_download_previous_release() {
        let info = tauri::async_runtime::block_on(check_against(&semver::Version::parse("0.2.1").unwrap(), false, true)).unwrap().expect("a release newer than 0.2.1");
        assert!(info.tag.starts_with("desktop-v") && info.html_url.starts_with("https://github.com/graohene10-spec/pdf-copilot/releases/"));
        let installer = info.installer.expect("installer with checksum");
        eprintln!("{} {} {} bytes sha256={}", info.version, installer.name, installer.size, installer.sha256);
        let dir = std::env::temp_dir().join(format!("kaizhi-update-test-{}", uuid::Uuid::new_v4()));
        let calls = std::sync::atomic::AtomicUsize::new(0);
        let path = tauri::async_runtime::block_on(download_with(installer.url.clone(), installer.sha256.clone(), dir.clone(), |_| { calls.fetch_add(1, Ordering::SeqCst); Ok(()) })).unwrap();
        assert_eq!(std::fs::metadata(&path).unwrap().len(), installer.size);
        assert!(calls.load(Ordering::SeqCst) >= 2);
        let wrong = "0".repeat(64);
        let error = tauri::async_runtime::block_on(download_with(installer.url, wrong, dir.clone(), |_| Ok(()))).unwrap_err();
        assert!(error.contains("SHA-256"), "{error}");
        assert!(!dir.join(format!("{}.partial", installer.name)).exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn download_rejects_bad_input_and_installer_paths_outside_update_dir() {
        let dir = std::env::temp_dir().join(format!("kaizhi-update-test-{}", uuid::Uuid::new_v4()));
        let url = "https://github.com/graohene10-spec/pdf-copilot/releases/download/desktop-v0.2.2/kaizhi_0.2.2_x64-setup.exe".to_string();
        let error = tauri::async_runtime::block_on(download_with(url, "not-a-hash".into(), dir.clone(), |_| Ok(()))).unwrap_err();
        assert!(error.contains("校验值"));
        assert!(!dir.exists());
        let outside = std::env::temp_dir().join(format!("{}-setup.exe", uuid::Uuid::new_v4()));
        std::fs::write(&outside, b"x").unwrap();
        assert!(verified_installer(outside.to_str().unwrap()).is_err());
        std::fs::remove_file(outside).unwrap();
    }

    fn zip_with(path: &Path, files: &[(&str, &[u8])]) {
        let mut writer = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
        let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (name, data) in files { writer.start_file(*name, options).unwrap(); writer.write_all(data).unwrap(); }
        writer.finish().unwrap();
    }

    #[test]
    fn portable_update_swaps_program_files_and_keeps_user_files() {
        let root = std::env::temp_dir().join(format!("kaizhi-portable-test-{}", uuid::Uuid::new_v4()));
        let dir = root.join("开智");
        std::fs::create_dir_all(dir.join("native-host")).unwrap();
        std::fs::write(dir.join("开智.exe"), b"old exe").unwrap();
        std::fs::write(dir.join("native-host/PdfCopilotHost.exe"), b"old host").unwrap();
        std::fs::write(dir.join("my-notes.txt"), b"keep me").unwrap();
        let package = root.join("kaizhi_0.3.0_x64-portable.zip");
        zip_with(&package, &[("开智-portable/开智.exe", b"new exe"), ("开智-portable/native-host/PdfCopilotHost.exe", b"new host"), ("开智-portable/samples/a.md", b"# A")]);
        apply_portable(&package, &dir, &dir.join("开智.exe")).unwrap();
        assert_eq!(std::fs::read(dir.join("开智.exe")).unwrap(), b"new exe");
        assert_eq!(std::fs::read(dir.join("native-host/PdfCopilotHost.exe")).unwrap(), b"new host");
        assert_eq!(std::fs::read(dir.join("samples/a.md")).unwrap(), b"# A");
        assert_eq!(std::fs::read(dir.join("my-notes.txt")).unwrap(), b"keep me");
        assert_eq!(std::fs::read(dir.join(format!("开智.exe{OLD_SUFFIX}"))).unwrap(), b"old exe");
        remove_leftovers_in(&dir, 0);
        assert!(!dir.join(format!("开智.exe{OLD_SUFFIX}")).exists() && !dir.join(format!("native-host/PdfCopilotHost.exe{OLD_SUFFIX}")).exists());

        // A package without the running program, or with paths leaving the folder, changes nothing.
        let wrong = root.join("wrong_x64-portable.zip");
        zip_with(&wrong, &[("other/other.exe", b"x")]);
        assert!(apply_portable(&wrong, &dir, &dir.join("开智.exe")).is_err());
        let evil = root.join("evil_x64-portable.zip");
        zip_with(&evil, &[("开智.exe", b"x"), ("../escape.txt", b"x")]);
        assert!(apply_portable(&evil, &dir, &dir.join("开智.exe")).is_err());
        assert!(!root.join("escape.txt").exists());
        assert_eq!(std::fs::read(dir.join("开智.exe")).unwrap(), b"new exe");
        std::fs::remove_dir_all(root).unwrap();
    }
}
