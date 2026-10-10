use crate::db::Result;
use std::{fs, path::PathBuf};

pub struct Credentials { directory: PathBuf }

impl Credentials {
    pub fn new(directory: PathBuf) -> Self { Self { directory } }
    fn path(&self, provider: &str) -> Result<PathBuf> {
        if !["openai","deepseek","codex"].contains(&provider) { return Err("AI 服务名称无效".into()); }
        Ok(self.directory.join(format!("{provider}.bin")))
    }
    pub fn get(&self, provider: &str) -> Result<Option<String>> {
        let path = self.path(provider)?;
        if !path.exists() { return Ok(None); }
        let protected = crate::files::read_bounded(&path,64 * 1024)?;
        let plain = unprotect(&protected)?;
        String::from_utf8(plain).map(Some).map_err(|_| "保存的 API 密钥无效".into())
    }
    pub fn set(&self, provider: &str, key: &str) -> Result<()> {
        let path = self.path(provider)?;
        if key.is_empty() {
            if path.exists() { fs::remove_file(path).map_err(|e| e.to_string())?; }
            return Ok(());
        }
        if key.len() > 8192 || key.chars().any(char::is_control) { return Err("API 密钥格式无效".into()); }
        let protected = protect(key.as_bytes())?;
        fs::create_dir_all(&self.directory).map_err(|e| e.to_string())?;
        let temporary = self.directory.join(format!("{}.tmp",uuid::Uuid::new_v4()));
        fs::write(&temporary,protected).map_err(|e| e.to_string())?;
        if let Err(error) = fs::rename(&temporary,&path) { let _ = fs::remove_file(temporary); return Err(error.to_string()); }
        Ok(())
    }
}

#[cfg(windows)]
fn crypt(data: &[u8], encrypt: bool) -> Result<Vec<u8>> {
    use windows_sys::Win32::{Foundation::LocalFree, Security::Cryptography::{CryptProtectData,CryptUnprotectData,CRYPT_INTEGER_BLOB,CRYPTPROTECT_UI_FORBIDDEN}};
    let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
    let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    // DPAPI ties ciphertext to this Windows account. Only ciphertext is persisted.
    let ok = unsafe {
        if encrypt { CryptProtectData(&input,std::ptr::null(),std::ptr::null(),std::ptr::null(),std::ptr::null(),CRYPTPROTECT_UI_FORBIDDEN,&mut output) }
        else { CryptUnprotectData(&input,std::ptr::null_mut(),std::ptr::null(),std::ptr::null(),std::ptr::null(),CRYPTPROTECT_UI_FORBIDDEN,&mut output) }
    };
    if ok == 0 { return Err("Windows 无法保护或解密 API 密钥".into()); }
    let bytes = unsafe { std::slice::from_raw_parts(output.pbData,output.cbData as usize).to_vec() };
    unsafe { LocalFree(output.pbData as _); }
    Ok(bytes)
}

#[cfg(windows)]
fn protect(data: &[u8]) -> Result<Vec<u8>> { crypt(data,true) }
#[cfg(windows)]
fn unprotect(data: &[u8]) -> Result<Vec<u8>> { crypt(data,false) }
#[cfg(not(windows))]
fn protect(_: &[u8]) -> Result<Vec<u8>> { Err("此原型的持久密钥保护仅支持 Windows".into()) }
#[cfg(not(windows))]
fn unprotect(_: &[u8]) -> Result<Vec<u8>> { Err("此原型的持久密钥保护仅支持 Windows".into()) }

#[cfg(all(test,windows))]
mod tests {
    use super::*;
    #[test]
    fn encrypted_at_rest_roundtrip_and_delete() {
        let root = std::env::temp_dir().join(format!("phydog-secret-{}",uuid::Uuid::new_v4()));
        let store = Credentials::new(root.clone());
        let key = "test-local-credential-no-real-api-secret";
        store.set("openai",key).unwrap();
        assert_eq!(store.get("openai").unwrap().as_deref(),Some(key));
        assert!(!fs::read(root.join("openai.bin")).unwrap().windows(key.len()).any(|w| w == key.as_bytes()));
        store.set("openai","updated-test-credential").unwrap();
        assert_eq!(store.get("openai").unwrap().as_deref(),Some("updated-test-credential"));
        store.set("openai","").unwrap(); assert!(store.get("openai").unwrap().is_none());
        assert!(store.set("../escape","x").is_err());
        fs::remove_dir_all(root).unwrap();
    }
}

