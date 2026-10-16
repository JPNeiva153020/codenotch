use crate::Error;
use std::fs::{self, File, OpenOptions};
use std::path::{Path, PathBuf};

pub const APP_NAME: &str = "Codenotch Gemini Experimental";
pub const APP_ID: &str = "com.codenotch.gemini.experimental";
pub const DIRECTORY: &str = "codenotch-gemini-experimental";
pub const EXECUTABLE: &str = "codenotch-gemini-experimental";

#[derive(Debug, Clone)]
pub struct Paths { root: PathBuf }
pub fn plain_path(path: &Path) -> Result<(), Error> {
    let metadata = fs::symlink_metadata(path).map_err(|_| Error::Directory)?;
    if metadata.file_type().is_symlink() { return Err(Error::Directory); }
    #[cfg(windows)] {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 { return Err(Error::Directory); }
    }
    Ok(())
}
impl Paths {
    pub fn prepare(base: Option<&Path>) -> Result<Self, Error> {
        let base = base.ok_or(Error::Directory)?;
        if !base.is_absolute() { return Err(Error::Directory); }
        plain_path(base)?;
        if !base.is_dir() { return Err(Error::Directory); }
        let base = fs::canonicalize(base).map_err(|_| Error::Directory)?;
        let root = base.join(DIRECTORY);
        if root.exists() { plain_path(&root)?; }
        fs::create_dir_all(&root).map_err(|_| Error::Directory)?;
        plain_path(&root)?;
        if fs::canonicalize(&root).map_err(|_| Error::Directory)?.parent() != Some(base.as_path()) { return Err(Error::Directory); }
        let paths = Self { root };
        for name in ["config", "cache", "logs", "webview2", "temp"] {
            let dir = paths.root.join(name);
            if dir.exists() { plain_path(&dir)?; }
            fs::create_dir(&dir).or_else(|e| if e.kind()==std::io::ErrorKind::AlreadyExists && dir.is_dir() { Ok(()) } else { Err(e) }).map_err(|_| Error::Directory)?;
            plain_path(&dir)?;
        }
        // Permission/availability errors must occur before any WebView is initialized.
        let probe = paths.temp().join("availability-check");
        let file = OpenOptions::new().write(true).create_new(true).open(&probe).map_err(|_| Error::Directory)?;
        file.sync_all().map_err(|_| Error::Directory)?;
        drop(file); fs::remove_file(probe).map_err(|_| Error::Directory)?;
        Ok(paths)
    }
    pub fn root(&self) -> &Path { &self.root }
    pub fn config(&self) -> PathBuf { self.root.join("config") }
    pub fn cache(&self) -> PathBuf { self.root.join("cache") }
    pub fn logs(&self) -> PathBuf { self.root.join("logs") }
    pub fn webview2(&self) -> PathBuf { self.root.join("webview2") }
    pub fn temp(&self) -> PathBuf { self.root.join("temp") }
    pub(crate) fn cache_file(&self) -> PathBuf { self.cache().join("gemini-state.json") }
    pub fn verify(&self) -> Result<(), Error> {
        for dir in [self.root.clone(), self.config(), self.cache(), self.logs(), self.webview2(), self.temp()] {
            plain_path(&dir)?;
            if !dir.is_dir() { return Err(Error::Directory); }
        }
        Ok(())
    }
}

pub struct InstanceGuard { file: Option<File>, path: PathBuf }
impl InstanceGuard {
    pub fn acquire(paths: &Paths) -> Result<Self, Error> {
        paths.verify()?;
        let path = paths.root.join("experimental-instance.lock");
        let file = OpenOptions::new().write(true).create_new(true).open(&path).map_err(|e| {
            if e.kind()==std::io::ErrorKind::AlreadyExists { Error::AlreadyRunning } else { Error::Directory }
        })?;
        Ok(Self { file:Some(file), path })
    }
}
impl Drop for InstanceGuard {
    fn drop(&mut self) {
        drop(self.file.take());
        // A replaced link is not followed. A crash leaves a lock, failing closed.
        if plain_path(&self.path).is_ok() { let _ = fs::remove_file(&self.path); }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mutation { InstallHooks, RemoveHooks, EnableAutostart, DisableAutostart, Update }
pub fn authorize_mutation(_action: Mutation) -> Result<(), Error> { Err(Error::Status) }
pub const START_REAL_PROVIDERS: bool = false;
pub const LISTEN_TCP: bool = false;
