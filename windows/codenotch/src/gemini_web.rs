//! Gemini Web local state reader (`%APPDATA%\codenotch\gemini-web-state.json`).
//!
//! Reads the sanitized snapshot written atomically by the Edge extension's Native Messaging host
//! (`com.codenotch.gemini_web`). Makes zero network requests and never accesses browser profiles,
//! cookies, or databases.

use crate::usage::{LimitWindow, UsageSnapshot};
use crate::AppState;
use notify::{RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

const STALE_AFTER_MS: u64 = 15 * 60 * 1000;
const RESCAN_SECS: u64 = 30;

static REFRESH: AtomicBool = AtomicBool::new(false);

pub fn request_refresh() {
    REFRESH.store(true, Ordering::Relaxed);
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn state_path() -> PathBuf {
    if let Some(custom) = std::env::var_os("CODENOTCH_GEMINI_WEB_STATE") {
        let p = PathBuf::from(custom);
        if !p.as_os_str().is_empty() {
            return p;
        }
    }
    crate::config::config_path().with_file_name("gemini-web-state.json")
}

pub fn parse_state_json(raw: &str, now: u64) -> Option<UsageSnapshot> {
    let v: serde_json::Value = serde_json::from_str(raw).ok()?;
    if v.get("provider").and_then(|p| p.as_str()) != Some("gemini_web") {
        return None;
    }
    if v.get("status").and_then(|s| s.as_str()) != Some("observed") {
        return None;
    }
    let observed_at_ms = v.get("observed_at_ms").and_then(|t| t.as_u64())?;
    if observed_at_ms == 0 {
        return None;
    }
    let arr = v.get("windows").and_then(|w| w.as_array())?;
    let mut windows = Vec::with_capacity(2);
    for (expected_id, label) in [("current", "Current session"), ("weekly", "Weekly limit")] {
        let item = arr
            .iter()
            .find(|w| w.get("id").and_then(|id| id.as_str()) == Some(expected_id))?;
        if item.get("status").and_then(|s| s.as_str()) != Some("observed") {
            return None;
        }
        let pct = item.get("used_percent").and_then(|p| p.as_f64())?;
        if !pct.is_finite() || !(0.0..=100.0).contains(&pct) {
            return None;
        }
        let mut resets_at = item
            .get("reset")
            .and_then(|r| r.get("epoch_ms"))
            .and_then(|e| e.as_u64());
        let mut used = (pct / 100.0).clamp(0.0, 1.0);
        if let Some(reset_epoch_ms) = resets_at {
            if observed_at_ms < reset_epoch_ms && now >= reset_epoch_ms {
                used = 0.0;
                let cycle_ms: u64 = if expected_id == "weekly" {
                    7 * 86_400 * 1_000
                } else {
                    5 * 3_600 * 1_000
                };
                let steps = ((now - reset_epoch_ms) / cycle_ms) + 1;
                resets_at = Some(reset_epoch_ms.saturating_add(steps.saturating_mul(cycle_ms)));
            }
        }
        windows.push(LimitWindow {
            id: expected_id.to_string(),
            label: label.to_string(),
            used,
            resets_at,
            ..Default::default()
        });
    }
    let status = if now.saturating_sub(observed_at_ms) > STALE_AFTER_MS {
        "stale"
    } else {
        "ok"
    };
    Some(UsageSnapshot {
        status: status.to_string(),
        windows,
        fetched_at: observed_at_ms,
        note: "via Gemini Web (/usage)".to_string(),
        backoff_until: 0,
        account: Some("Gemini Web".to_string()),
    })
}

pub fn read_from_path(path: &Path, now: u64) -> UsageSnapshot {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return UsageSnapshot {
            status: "absent".into(),
            ..Default::default()
        };
    };
    parse_state_json(&raw, now).unwrap_or_else(|| UsageSnapshot {
        status: "absent".into(),
        ..Default::default()
    })
}

pub fn load_persisted() -> UsageSnapshot {
    read_from_path(&state_path(), now_ms())
}

fn same_reading(a: &UsageSnapshot, b: &UsageSnapshot) -> bool {
    if a.status != b.status || a.fetched_at != b.fetched_at || a.windows.len() != b.windows.len() {
        return false;
    }
    a.windows
        .iter()
        .zip(b.windows.iter())
        .all(|(x, y)| x.id == y.id && (x.used - y.used).abs() < 1e-6 && x.resets_at == y.resets_at)
}

fn broadcast(app: &AppHandle, snap: UsageSnapshot) {
    let st = app.state::<AppState>();
    *st.gemini_web.lock().unwrap() = snap.clone();
    let _ = app.emit("gemini_web", &snap);
    crate::tray::refresh_menu(app);
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        crate::activity::lower_thread_priority();
        let path = state_path();
        let watch_dir = path.parent().map(|p| p.to_path_buf());
        let (tx, rx) = channel();
        let mut watcher = notify::recommended_watcher(move |res| {
            let _ = tx.send(res);
        })
        .ok();
        let mut watching = false;
        if let (Some(w), Some(dir)) = (watcher.as_mut(), watch_dir.as_ref()) {
            if dir.exists() && w.watch(dir, RecursiveMode::NonRecursive).is_ok() {
                watching = true;
            }
        }

        let mut last = read_from_path(&path, now_ms());
        broadcast(&app, last.clone());
        let mut last_scan = Instant::now();

        loop {
            let mut should_read = REFRESH.swap(false, Ordering::Relaxed);
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(Ok(ev)) => {
                    if ev.paths.iter().any(|p| {
                        p.file_name()
                            .and_then(|n| n.to_str())
                            .is_some_and(|n| n.starts_with("gemini-web-state.json"))
                    }) {
                        should_read = true;
                    }
                    while let Ok(Ok(ev)) = rx.try_recv() {
                        if ev.paths.iter().any(|p| {
                            p.file_name()
                                .and_then(|n| n.to_str())
                                .is_some_and(|n| n.starts_with("gemini-web-state.json"))
                        }) {
                            should_read = true;
                        }
                    }
                }
                Ok(Err(_)) | Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => {
                    std::thread::sleep(Duration::from_millis(500));
                }
            }

            if !watching {
                if let (Some(w), Some(dir)) = (watcher.as_mut(), watch_dir.as_ref()) {
                    if dir.exists() && w.watch(dir, RecursiveMode::NonRecursive).is_ok() {
                        watching = true;
                        should_read = true;
                    }
                }
            }

            let force_emit = REFRESH.swap(false, Ordering::Relaxed);
            if should_read || force_emit || last_scan.elapsed() >= Duration::from_secs(RESCAN_SECS) {
                last_scan = Instant::now();
                let next = read_from_path(&path, now_ms());
                if force_emit || !same_reading(&last, &next) {
                    last = next.clone();
                    broadcast(&app, next);
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_JSON: &str = r#"{
        "schema_version": 1,
        "provider": "gemini_web",
        "origin": "visible_ui",
        "collection": "dom_on_authorized_usage",
        "model": null,
        "status": "observed",
        "observed_at_ms": 1776000000000,
        "windows": [
            {
                "id": "current",
                "status": "observed",
                "used_percent": 48,
                "remaining_percent": 52,
                "reset": {
                    "day": null,
                    "month": null,
                    "year": null,
                    "hour": 17,
                    "minute": 6,
                    "timezone": null,
                    "epoch_ms": null,
                    "needs_confirmation": true
                },
                "issues": []
            },
            {
                "id": "weekly",
                "status": "observed",
                "used_percent": 12,
                "remaining_percent": 88,
                "reset": {
                    "day": 21,
                    "month": 4,
                    "year": null,
                    "hour": 15,
                    "minute": 24,
                    "timezone": null,
                    "epoch_ms": null,
                    "needs_confirmation": true
                },
                "issues": []
            }
        ],
        "issues": []
    }"#;

    #[test]
    fn valid_snapshot_parses_current_and_weekly_windows() {
        let now = 1_776_000_060_000;
        let snap = parse_state_json(SAMPLE_JSON, now).expect("valid snapshot should parse");
        assert_eq!(snap.status, "ok");
        assert_eq!(snap.fetched_at, 1_776_000_000_000);
        assert_eq!(snap.account.as_deref(), Some("Gemini Web"));
        assert_eq!(snap.windows.len(), 2);
        assert_eq!(snap.windows[0].id, "current");
        assert_eq!(snap.windows[0].label, "Current session");
        assert!((snap.windows[0].used - 0.48).abs() < 1e-6);
        assert_eq!(snap.windows[1].id, "weekly");
        assert_eq!(snap.windows[1].label, "Weekly limit");
        assert!((snap.windows[1].used - 0.12).abs() < 1e-6);
    }

    #[test]
    fn missing_file_returns_absent() {
        let missing = std::env::temp_dir().join(format!(
            "codenotch-gemini-web-missing-{}.json",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&missing);
        let snap = read_from_path(&missing, 1_776_000_000_000);
        assert_eq!(snap.status, "absent");
        assert!(snap.windows.is_empty());
    }

    #[test]
    fn expired_observation_becomes_stale() {
        let now = 1_776_000_000_000 + STALE_AFTER_MS + 1_000;
        let snap = parse_state_json(SAMPLE_JSON, now).expect("stale snapshot should still parse");
        assert_eq!(snap.status, "stale");
        assert_eq!(snap.windows.len(), 2);
    }

    #[test]
    fn expired_reset_window_resets_used_percent_to_zero_and_advances_cycle() {
        let json_with_epoch = r#"{
            "schema_version": 1,
            "provider": "gemini_web",
            "origin": "visible_ui",
            "collection": "dom_on_authorized_usage",
            "model": null,
            "status": "observed",
            "observed_at_ms": 1792433050009,
            "windows": [
                {
                    "id": "current",
                    "status": "observed",
                    "used_percent": 100,
                    "remaining_percent": 0,
                    "reset": {
                        "day": null,
                        "month": null,
                        "year": null,
                        "hour": 17,
                        "minute": 11,
                        "timezone": null,
                        "epoch_ms": 1792440660000,
                        "needs_confirmation": true
                    },
                    "issues": []
                },
                {
                    "id": "weekly",
                    "status": "observed",
                    "used_percent": 75,
                    "remaining_percent": 25,
                    "reset": {
                        "day": 21,
                        "month": 10,
                        "year": null,
                        "hour": 9,
                        "minute": 53,
                        "timezone": null,
                        "epoch_ms": 1792587180000,
                        "needs_confirmation": true
                    },
                    "issues": []
                }
            ],
            "issues": []
        }"#;
        let now_after_reset = 1_792_448_400_000; // 19:20 (após 17:11)
        let snap = parse_state_json(json_with_epoch, now_after_reset)
            .expect("snapshot after reset time should parse and reset current window");
        assert!((snap.windows[0].used - 0.0).abs() < 1e-6);
        assert_eq!(
            snap.windows[0].resets_at,
            Some(1_792_440_660_000 + CURRENT_CYCLE_MS)
        );
        assert!((snap.windows[1].used - 0.75).abs() < 1e-6);
    }
}

