//! Distribution boundaries; no published update channel is configured for the fork.
use std::path::{Path, PathBuf};

pub const IS_FORK: bool = cfg!(feature = "gemini-web-distribution");
pub const PRODUCT_NAME: &str = "Codenotch Gemini Web";
pub const APP_ID: &str = "com.codenotch.geminiweb";
pub const DATA_FOLDER: &str = if IS_FORK { APP_ID } else { "codenotch" };
pub const AUTOSTART_NAME: &str = if IS_FORK { PRODUCT_NAME } else { "Codenotch" };
pub const UPDATE_MESSAGE: &str = "Manual updates only for this experimental distribution";

pub fn quota_directory(local: &Path, reuse_legacy: bool, legacy_running: bool) -> Result<PathBuf, &'static str> {
    if reuse_legacy {
        if legacy_running { return Err("legacy application is running; close it before reusing its session"); }
        let legacy = local.join("com.immidi.codenotch");
        if !legacy.is_dir() || legacy.is_symlink() { return Err("legacy session directory unavailable"); }
        return Ok(legacy);
    }
    Ok(local.join(APP_ID).join("gemini-quota"))
}

pub fn is_local_settings(label: &str, url: &tauri::Url) -> bool {
    label=="settings" && url.path()=="/settings.html" && url.username().is_empty() && url.password().is_none()
        && url.port().is_none() && url.query().is_none() && url.fragment().is_none()
        && ((url.scheme()=="tauri" && url.host_str()==Some("localhost"))
            || (matches!(url.scheme(),"http"|"https") && url.host_str()==Some("tauri.localhost")))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn opening_usage_requires_the_local_settings_origin() {
        let good=tauri::Url::parse("http://tauri.localhost/settings.html").unwrap();
        assert!(is_local_settings("settings",&good));assert!(!is_local_settings("gemini_web_probe",&good));
        for url in ["https://gemini.google.com/settings.html","http://tauri.localhost/notch.html",
            "http://tauri.localhost/settings.html?x=1","http://tauri.localhost/settings.html#x",
            "http://user:secret@tauri.localhost/settings.html","http://tauri.localhost:9999/settings.html"] {
            assert!(!is_local_settings("settings",&tauri::Url::parse(url).unwrap()));
        }
    }
    #[test]
    fn fresh_session_never_uses_the_legacy_directory() {
        let base=std::env::temp_dir();
        assert_eq!(quota_directory(&base,false,true).unwrap(),base.join(APP_ID).join("gemini-quota"));
    }
    #[test]
    fn migration_session_refuses_a_running_legacy_app_or_missing_directory() {
        let base=std::env::temp_dir().join(format!("gemini-dist-{}",std::process::id()));
        assert!(quota_directory(&base,true,true).is_err());
        assert!(quota_directory(&base,true,false).is_err());
    }
    #[test]
    fn reuses_only_an_explicit_existing_profile_without_copying_it() {
        let base=std::env::temp_dir().join(format!("gemini-session-{}",std::process::id()));
        std::fs::create_dir(&base).unwrap();let legacy=base.join("com.immidi.codenotch");
        std::fs::create_dir(&legacy).unwrap();
        assert_eq!(quota_directory(&base,true,false).unwrap(),legacy);
        assert!(quota_directory(&base,true,true).is_err());
        assert_eq!(std::fs::read_dir(&legacy).unwrap().count(),0);
        std::fs::remove_dir(&legacy).unwrap();std::fs::remove_dir(&base).unwrap();
    }
    #[test]
    fn fork_identity_is_separate_and_channel_is_manual() {
        if IS_FORK { assert_ne!(DATA_FOLDER,"codenotch"); assert_eq!(DATA_FOLDER,APP_ID); assert_eq!(AUTOSTART_NAME,PRODUCT_NAME); }
        assert_ne!(APP_ID,"com.immidi.codenotch");
    }
}
