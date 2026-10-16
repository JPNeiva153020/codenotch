mod common;
use common::*;
use codenotch_gemini_experimental::isolation::*;
use codenotch_gemini_experimental::Error;
#[test] fn paths_are_exclusive_and_sibling_official_untouched() {let t=Temp::new();let official=t.base.join("codenotch");std::fs::create_dir(&official).unwrap();std::fs::write(official.join("sentinel"),b"unchanged").unwrap();let p=t.paths();for path in [p.config(),p.cache(),p.logs(),p.webview2(),p.temp()] {assert!(path.starts_with(p.root()));assert!(!path.starts_with(&official));}assert_eq!(std::fs::read(official.join("sentinel")).unwrap(),b"unchanged");}
#[test] fn no_base_fails_closed() {assert!(matches!(Paths::prepare(None),Err(Error::Directory)));}
#[test] fn relative_base_fails_closed() {assert!(matches!(Paths::prepare(Some(std::path::Path::new("relative"))),Err(Error::Directory)));}
#[test] fn unavailable_root_does_not_fallback() {let t=Temp::new();std::fs::write(t.base.join(DIRECTORY),b"blocked").unwrap();assert!(matches!(Paths::prepare(Some(&t.base)),Err(Error::Directory)));assert!(!t.base.join("codenotch").exists());}
#[test] fn all_official_mutations_denied() {for a in [Mutation::InstallHooks,Mutation::RemoveHooks,Mutation::EnableAutostart,Mutation::DisableAutostart,Mutation::Update] {assert!(authorize_mutation(a).is_err());}assert!(!START_REAL_PROVIDERS);assert!(!LISTEN_TCP);}
#[test] fn instance_lock_distinct_and_exclusive() {let t=Temp::new();let p=t.paths();let guard=InstanceGuard::acquire(&p).unwrap();assert!(matches!(InstanceGuard::acquire(&p),Err(Error::AlreadyRunning)));drop(guard);assert!(InstanceGuard::acquire(&p).is_ok());}
#[cfg(unix)] #[test] fn symlink_root_rejected() {let t=Temp::new();let outside=t.base.join("outside");std::fs::create_dir(&outside).unwrap();std::os::unix::fs::symlink(outside,t.base.join(DIRECTORY)).unwrap();assert!(Paths::prepare(Some(&t.base)).is_err());}
