//! Explicit experimental profile; never inferred from normal user configuration.
use std::fs::File;
#[cfg(all(windows, any(feature = "gemini-web-lab", test)))]
use std::fs::OpenOptions;
#[cfg(all(windows, any(feature = "gemini-web-lab", test)))]
use std::path::Component;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::OnceLock;

#[cfg(all(windows, any(feature = "gemini-web-lab", test)))]
const MARKER: &str = "codenotch-gemini-web-lab-v1\n";
#[cfg(all(windows, any(feature = "gemini-web-lab", test)))]
const MARKER_FILE: &str = ".gemini-web-lab-profile";
#[cfg(all(windows, any(feature = "gemini-web-lab", test)))]
const LOCK_FILE: &str = ".gemini-web-lab-lock";

pub struct Profile {
    root: PathBuf,
    _lock: File,
}

#[cfg(all(windows, any(feature = "gemini-web-lab", test)))]
fn resolved_candidate(path: &Path) -> Result<PathBuf, &'static str> {
    if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("lab profile requires an absolute path without parent traversal");
    }
    let mut ancestor = path;
    let mut missing = Vec::new();
    while !ancestor.exists() {
        missing.push(
            ancestor
                .file_name()
                .ok_or("invalid profile path")?
                .to_os_string(),
        );
        ancestor = ancestor.parent().ok_or("invalid profile parent")?;
    }
    let mut resolved = ancestor
        .canonicalize()
        .map_err(|_| "cannot resolve profile parent")?;
    for part in missing.into_iter().rev() {
        resolved.push(part);
    }
    Ok(resolved)
}

#[cfg(any(feature = "gemini-web-lab", test))]
impl Profile {
    #[cfg(not(windows))]
    pub fn open(_path: &Path, _official: &Path) -> Result<Self, &'static str> {
        Err("experimental execution requires Windows")
    }
    #[cfg(windows)]
    pub fn open(path: &Path, official: &Path) -> Result<Self, &'static str> {
        let root = resolved_candidate(path)?;
        let official = resolved_candidate(official)?;
        let fork = official.with_file_name(crate::distribution::APP_ID);
        if root.starts_with(&fork) || fork.starts_with(&root) {
            return Err("lab profile must be separate from fork application data");
        }
        if root.starts_with(&official) || official.starts_with(&root) {
            return Err("lab profile must be separate from official application data");
        }
        if root.exists() {
            let marker = root.join(MARKER_FILE);
            if marker.is_symlink() || root.join(LOCK_FILE).is_symlink() {
                return Err("profile markers must not be symbolic links");
            }
            if marker.exists() {
                if std::fs::read_to_string(marker).ok().as_deref() != Some(MARKER) {
                    return Err("unrecognized experimental profile");
                }
            } else if std::fs::read_dir(&root)
                .map_err(|_| "cannot inspect profile")?
                .next()
                .is_some()
            {
                return Err("new experimental profile must be empty");
            }
        }
        std::fs::create_dir_all(&root).map_err(|_| "cannot create experimental profile")?;
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.share_mode(0);
        }
        let lock = options
            .open(root.join(LOCK_FILE))
            .map_err(|_| "profile is locked or unavailable")?;
        std::fs::write(root.join(MARKER_FILE), MARKER)
            .map_err(|_| "cannot mark experimental profile")?;
        Ok(Self { root, _lock: lock })
    }
}

static PROFILE: OnceLock<Profile> = OnceLock::new();
static GENERATION: AtomicU64 = AtomicU64::new(0);
static AUTOMATIC: AtomicBool = AtomicBool::new(false);

pub fn root() -> Option<&'static Path> {
    PROFILE.get().map(|p| p.root.as_path())
}
pub fn is_lab() -> bool {
    root().is_some()
}
pub fn automatic_allowed() -> bool {
    !is_lab() || AUTOMATIC.load(Ordering::SeqCst)
}

#[cfg(all(feature = "gemini-web-lab", windows))]
pub fn initialize(path: &Path, smoke: bool) -> Result<(), &'static str> {
    if smoke
        && path.exists()
        && std::fs::read_dir(path)
            .map_err(|_| "cannot inspect smoke profile")?
            .next()
            .is_some()
    {
        return Err("smoke test requires a new empty profile");
    }
    let official = dirs::config_dir()
        .ok_or("configuration directory unavailable")?
        .join("codenotch");
    let profile = Profile::open(path, &official)?;
    PROFILE
        .set(profile)
        .map_err(|_| "experimental profile already initialized")
}

#[cfg(all(feature = "gemini-web-lab", not(windows)))]
pub fn initialize(_path: &Path, _smoke: bool) -> Result<(), &'static str> {
    Err("experimental execution requires Windows")
}

#[cfg(feature = "gemini-web-lab")]
pub fn set_automatic(enabled: bool) {
    AUTOMATIC.store(enabled, Ordering::SeqCst);
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU64;
    static SEQ: AtomicU64 = AtomicU64::new(0);
    fn parent() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "gemini-profile-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).unwrap();
        path
    }
    #[test]
    fn rejects_relative_paths_and_parent_traversal() {
        let base = parent();
        assert!(resolved_candidate(Path::new("relative")).is_err());
        assert!(resolved_candidate(&base.join("../escape")).is_err());
        std::fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn rejects_official_directory_and_its_children() {
        let base = parent();
        let official = base.join("official");
        assert!(Profile::open(&official, &official).is_err());
        assert!(Profile::open(&official.join("nested"), &official).is_err());
        assert!(!official.exists());
        std::fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn rejects_the_fork_configuration_directory_before_writing() {
        let base=parent();let fork=base.join(crate::distribution::APP_ID);
        assert!(Profile::open(&fork,&base.join("codenotch")).is_err());
        assert!(!fork.exists());std::fs::remove_dir(&base).unwrap();
    }
    #[test]
    fn refuses_unmarked_nonempty_directory_without_writing_to_it() {
        let base = parent();
        let path = base.join("foreign");
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("keep.txt"), "preserve").unwrap();
        assert!(Profile::open(&path, &base.join("official")).is_err());
        assert_eq!(std::fs::read_dir(&path).unwrap().count(), 1);
        std::fs::remove_dir_all(base).unwrap();
    }
    #[test]
    #[cfg(windows)]
    fn profile_lock_prevents_second_instance_and_allows_restart() {
        let base = parent();
        let path = base.join("lab");
        let official = base.join("official");
        let first = Profile::open(&path, &official).unwrap();
        assert!(Profile::open(&path, &official).is_err());
        drop(first);
        let reopened = Profile::open(&path, &official).unwrap();
        assert_eq!(reopened.root, path.canonicalize().unwrap());
        drop(reopened);
        std::fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn refuses_invalid_ownership_marker_without_creating_a_lock() {
        let base = parent();
        let path = base.join("foreign");
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join(MARKER_FILE), "not-a-lab").unwrap();
        assert!(Profile::open(&path, &base.join("official")).is_err());
        assert!(!path.join(LOCK_FILE).exists());
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn normal_process_has_no_lab_profile() {
        assert!(!is_lab());
        assert!(automatic_allowed());
    }
}

pub fn generation() -> u64 {
    GENERATION.load(Ordering::SeqCst)
}
pub fn cancel_pending() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
}
