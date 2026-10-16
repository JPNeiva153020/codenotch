#![allow(dead_code)]
use codenotch_gemini_experimental::contract::Snapshot;
use codenotch_gemini_experimental::isolation::Paths;
use std::path::PathBuf;
pub const NOW: u64 = 1_800_000_000_000;
pub const GENERATION: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
pub fn fixture() -> serde_json::Value { serde_json::from_str(include_str!("../fixtures/snapshot.json")).unwrap() }
pub fn snapshot() -> Snapshot { Snapshot::from_bytes(include_bytes!("../fixtures/snapshot.json"), NOW).unwrap() }
pub struct Temp { pub base: PathBuf }
impl Temp {
    pub fn new() -> Self {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let suffix=COUNTER.fetch_add(1,std::sync::atomic::Ordering::Relaxed);
        let base=std::env::temp_dir().join(format!("codenotch-gemini-fixture-{}-{suffix}",std::process::id()));
        std::fs::create_dir(&base).unwrap();
        Self {base}
    }
    pub fn paths(&self) -> Paths { Paths::prepare(Some(&self.base)).unwrap() }
}
impl Drop for Temp {
    fn drop(&mut self) {
        // Cleanup stays inside the exact test-created directory, never any account path.
        if self.base.file_name().is_some_and(|n| n.to_string_lossy().starts_with("codenotch-gemini-fixture-"))
            && codenotch_gemini_experimental::isolation::plain_path(&self.base).is_ok() {
            let _=std::fs::remove_dir_all(&self.base);
        }
    }
}
