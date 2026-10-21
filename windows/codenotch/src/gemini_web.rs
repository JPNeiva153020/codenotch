//! Gemini Web local state reader (`%APPDATA%\codenotch\gemini-web-state.json`) and autonomous WebView2 probe.
//!
//! Reads the sanitized snapshot written atomically by the Edge extension or the native WebView2 probe.
//! When triggered, can run a background WebView2 probe to refresh quota or open an interactive login/view window.

use crate::usage::{LimitWindow, UsageSnapshot};
use crate::AppState;
use notify::{RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const CURRENT_CYCLE_MS: u64 = 5 * 3_600 * 1_000;
pub const WEEKLY_CYCLE_MS: u64 = 7 * 86_400 * 1_000;

pub const DESKTOP_POLL_SECS: u64 = 45;
pub const IDLE_POLL_SECS: u64 = 120;
pub const POLL_SECS: u64 = 2;
pub const RESCAN_SECS: u64 = 10;

const STALE_AFTER_MS: u64 = 15 * 60 * 1000;
const PROBE_WINDOW_LABEL: &str = "gemini_web_probe";
const EDGE_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";

static REFRESH: AtomicBool = AtomicBool::new(false);
static LAST_PROBE_MS: AtomicU64 = AtomicU64::new(0);

pub const PROBE_INIT_SCRIPT: &str = r#"
(() => {
  try {
    const loc = window.location;
    if (!loc || !loc.hostname) return;

    if (loc.hostname.includes('accounts.google.com') || loc.pathname.includes('/signin') || loc.pathname.includes('/ServiceLogin')) {
      document.title = '__CODENOTCH_GW_AUTH__';
      return;
    }

    if (!loc.hostname.endsWith('google.com')) return;

    try {
      Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
      Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
      window.dispatchEvent(new Event('visibilitychange'));
    } catch(e) {}

    if (!window.__codenotch_raf_installed) {
      window.__codenotch_raf_installed = true;
      const _origRaf = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : null;
      let lastTime = 0;
      window.requestAnimationFrame = function(cb) {
        if (_origRaf) {
          let called = false;
          const timer = setTimeout(() => {
            if (!called) {
              called = true;
              cb(Date.now());
            }
          }, 50);
          return _origRaf((ts) => {
            if (!called) {
              called = true;
              clearTimeout(timer);
              cb(ts);
            }
          });
        }
        const currTime = Date.now();
        const timeToCall = Math.max(0, 16 - (currTime - lastTime));
        const id = setTimeout(() => cb(currTime + timeToCall), timeToCall);
        lastTime = currTime + timeToCall;
        return id;
      };
    }

    let lastSentSignature = '';
    let probeSeq = 0;

    const runExtraction = () => {
      try {
        const curLoc = window.location;
        if (!curLoc || !curLoc.pathname || !curLoc.pathname.includes('/usage')) return;

        const normalize = s => String(s || '').replace(/\s+/gu, ' ').trim();
        const ownText = el => {
          let text = '';
          for (const node of el.childNodes) {
            if (node.nodeType === 3) text += ' ' + node.nodeValue;
          }
          return normalize(text);
        };

        const parseReset = text => {
          const ptMatch = text.match(/^(?:(\d{1,2})\s+de\s+([a-zç]+)\s*\.?\s*,?\s*)?(\d{1,2})\s*:\s*(\d{2})\s*:\s*o limite de uso é redefinido\.?$/iu);
          if (ptMatch) {
            const hour = Number(ptMatch[3]), minute = Number(ptMatch[4]);
            let day = null, month = null;
            if (ptMatch[1]) {
              const months = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
              month = months.indexOf(ptMatch[2].toLowerCase()) + 1;
              day = Number(ptMatch[1]);
            }
            return { day, month, year: null, hour, minute, timezone: null, epoch_ms: null, needs_confirmation: true };
          }
          const enMatch = text.match(/^(?:([a-z]+)\s+(\d{1,2})\s*,?\s*)?(\d{1,2})\s*:\s*(\d{2})(?:\s*(am|pm))?\s*:\s*usage limit resets\.?$/iu);
          if (enMatch) {
            let hour = Number(enMatch[3]), minute = Number(enMatch[4]);
            const ampm = enMatch[5]?.toLowerCase();
            if (ampm === 'pm' && hour < 12) hour += 12;
            if (ampm === 'am' && hour === 12) hour = 0;
            let day = null, month = null;
            if (enMatch[1]) {
              const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
              month = months.indexOf(enMatch[1].toLowerCase().slice(0, 3)) + 1;
              day = Number(enMatch[2]);
            }
            return { day, month, year: null, hour, minute, timezone: null, epoch_ms: null, needs_confirmation: true };
          }
          return null;
        };

        const calculateEpochMs = (r, nowMs) => {
          if (!r || r.hour === null || r.minute === null) return null;
          const now = new Date(nowMs);
          if (r.day !== null && r.month !== null) {
            let dt = new Date(now.getFullYear(), r.month - 1, r.day, r.hour, r.minute, 0, 0);
            if (nowMs - dt.getTime() > 30 * 86400000) {
              dt = new Date(now.getFullYear() + 1, r.month - 1, r.day, r.hour, r.minute, 0, 0);
            }
            return dt.getTime();
          }
          const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), r.hour, r.minute, 0, 0);
          if (dt.getTime() <= nowMs - 60000) {
            dt.setDate(dt.getDate() + 1);
          }
          return dt.getTime();
        };

        const allEls = [...document.querySelectorAll('div,p,span,h1,h2,h3,h4,strong')];
        const textNodes = allEls.map(el => ({ el, text: ownText(el) })).filter(x => x.text.length > 0);

        const hasCurrent = textNodes.some(x => /^(?:Uso atual|Current usage|Current session)$/iu.test(x.text));
        const hasWeekly = textNodes.some(x => /^(?:Limite semanal|Weekly limit)$/iu.test(x.text));

        if (!hasCurrent && !hasWeekly) return;

        const isPro = textNodes.some(x => /^(?:PRO|Ultra|Advanced)$/iu.test(x.text)) &&
                      !textNodes.some(x => /Aumente o limite de uso|Fazer upgrade|Upgrade to/iu.test(x.text));
        const isFree = textNodes.some(x => /Aumente o limite de uso|Fazer upgrade|Upgrade to/iu.test(x.text));
        const accountTier = isPro ? 'pro' : (isFree ? 'free' : 'unknown');

        const extractCard = (labelPattern, id) => {
          const labelEntry = textNodes.find(x => labelPattern.test(x.text));
          if (!labelEntry) return null;
          let container = labelEntry.el.parentElement;
          for (let d = 0; d < 5 && container && container !== document.body; d++) {
            const subNodes = [...container.querySelectorAll('div,p,span,strong')].map(e => ownText(e)).filter(Boolean);
            const pctText = subNodes.find(t => /(?:Quantidade usada|Amount used)\s*:\s*(\d{1,3}(?:[.,]\d+)?)\s*%/iu.test(t));
            const resetText = subNodes.find(t => /(?:o limite de uso é redefinido|usage limit resets)/iu.test(t));
            if (pctText && resetText) {
              const matchPct = pctText.match(/(?:Quantidade usada|Amount used)\s*:\s*(\d{1,3}(?:[.,]\d+)?)\s*%/iu);
              const pct = matchPct ? Number(matchPct[1].replace(',', '.')) : NaN;
              const reset = parseReset(resetText);
              if (Number.isFinite(pct) && reset) {
                return {
                  id,
                  status: 'observed',
                  used_percent: pct,
                  remaining_percent: Number((100 - pct).toFixed(6)),
                  reset,
                  issues: []
                };
              }
            }
            container = container.parentElement;
          }
          return null;
        };

        const currentCard = extractCard(/^(?:Uso atual|Current usage|Current session)$/iu, 'current');
        const weeklyCard = extractCard(/^(?:Limite semanal|Weekly limit)$/iu, 'weekly');

        if (currentCard && weeklyCard) {
          const now = Date.now();
          currentCard.reset.epoch_ms = calculateEpochMs(currentCard.reset, now);
          weeklyCard.reset.epoch_ms = calculateEpochMs(weeklyCard.reset, now);

          const curPath = window.location.pathname || null;
          const sig = `${curPath}|${accountTier}|${currentCard.used_percent}|${currentCard.reset.epoch_ms}|${weeklyCard.used_percent}|${weeklyCard.reset.epoch_ms}`;

          if (sig !== lastSentSignature) {
            lastSentSignature = sig;
            probeSeq++;
            const payload = {
              schema_version: 1,
              provider: 'gemini_web',
              origin: 'visible_ui',
              collection: 'dom_on_authorized_usage',
              model: null,
              status: 'observed',
              observed_at_ms: now,
              account_tier: accountTier,
              profile_path: curPath,
              seq: probeSeq,
              windows: [currentCard, weeklyCard],
              issues: []
            };

            document.title = '__CODENOTCH_GW_OK__:' + JSON.stringify(payload);
          }
        }
      } catch (e) {}
    };

    setInterval(runExtraction, 500);
    setTimeout(runExtraction, 100);
  } catch (err) {}
})();
"#;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct GeminiWebConfig {
    pub url: String,
}

impl Default for GeminiWebConfig {
    fn default() -> Self {
        Self {
            url: "https://gemini.google.com/u/1/usage?pageId=none".to_string(),
        }
    }
}

pub fn config_path() -> PathBuf {
    crate::config::config_path().with_file_name("gemini-web-config.json")
}

pub fn load_config() -> GeminiWebConfig {
    let p = config_path();
    if let Ok(raw) = std::fs::read_to_string(&p) {
        if let Ok(cfg) = serde_json::from_str::<GeminiWebConfig>(&raw) {
            if !cfg.url.is_empty() {
                return cfg;
            }
        }
    }
    GeminiWebConfig::default()
}

pub fn save_config(cfg: &GeminiWebConfig) {
    let p = config_path();
    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(cfg) {
        let tmp = p.with_extension(format!("tmp.{}", std::process::id()));
        if std::fs::write(&tmp, json).is_ok() {
            let _ = std::fs::rename(&tmp, &p);
        }
    }
}

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

pub fn save_state_atomically(path: &Path, content: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension(format!("tmp.{}", std::process::id()));
    std::fs::write(&tmp, content)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
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
                    WEEKLY_CYCLE_MS
                } else {
                    CURRENT_CYCLE_MS
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

pub fn is_gemini_desktop_running() -> bool {
    #[cfg(windows)]
    {
        crate::focus::proc_maps()
            .name
            .values()
            .any(|n| n == "gemini.exe")
    }
    #[cfg(not(windows))]
    {
        false
    }
}

pub fn handle_probe_title(app: &AppHandle, window: &tauri::WebviewWindow, title: &str) {
    if let Some(payload_json) = title.strip_prefix("__CODENOTCH_GW_OK__:") {
        let state_p = state_path();
        if let Ok(()) = save_state_atomically(&state_p, payload_json) {
            let snap = read_from_path(&state_p, now_ms());
            broadcast(app, snap);
            request_refresh();
        }

        if let Ok(val) = serde_json::from_str::<serde_json::Value>(payload_json) {
            if val.get("account_tier").and_then(|v| v.as_str()) == Some("pro") {
                if let Some(p_path) = val.get("profile_path").and_then(|p| p.as_str()) {
                    if p_path.starts_with("/u/") {
                        let new_url = format!("https://gemini.google.com{}?pageId=none", p_path);
                        let mut cfg = load_config();
                        if cfg.url != new_url {
                            cfg.url = new_url;
                            save_config(&cfg);
                        }
                    }
                }
            }
        }

        if !window.is_visible().unwrap_or(false) {
            let _ = window.destroy();
        }
    } else if title == "__CODENOTCH_GW_AUTH__" {
        if !window.is_visible().unwrap_or(false) {
            let _ = window.destroy();
        }
    }
}

pub fn force_manual_probe(app: &AppHandle) {
    if let Some(existing) = app.get_webview_window(PROBE_WINDOW_LABEL) {
        if !existing.is_visible().unwrap_or(false) {
            let _ = existing.destroy();
        }
    }
    LAST_PROBE_MS.store(0, Ordering::Relaxed);
    request_refresh();
    probe_in_background(app);
}

pub fn probe_in_background(app: &AppHandle) {
    let now = now_ms();
    let last = LAST_PROBE_MS.load(Ordering::Relaxed);
    if now.saturating_sub(last) < 5_000 {
        return;
    }
    LAST_PROBE_MS.store(now, Ordering::Relaxed);

    let handle = app.clone();
    std::thread::spawn(move || {
        let app = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            probe_in_background_now(&app);
        });
    });
}

fn probe_in_background_now(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(PROBE_WINDOW_LABEL) {
        if w.is_visible().unwrap_or(false) {
            return;
        }
        return;
    }

    let cfg = load_config();
    let Ok(target_url) = cfg.url.parse() else { return };

    let app_for_title = app.clone();
    let builder = WebviewWindowBuilder::new(app, PROBE_WINDOW_LABEL, WebviewUrl::External(target_url))
        .title("Gemini Web Probe")
        .inner_size(980.0, 720.0)
        .visible(false)
        .skip_taskbar(true)
        .focused(false)
        .user_agent(EDGE_USER_AGENT)
        .initialization_script(PROBE_INIT_SCRIPT)
        .on_document_title_changed(move |window, title| {
            handle_probe_title(&app_for_title, &window, &title);
        });

    if let Ok(w) = builder.build() {
        let w_handle = w.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(20));
            if let Ok(visible) = w_handle.is_visible() {
                if !visible {
                    let _ = w_handle.destroy();
                }
            }
        });
    }
}

pub fn open_usage_window(app: &AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || {
        let app = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            open_usage_window_now(&app);
        });
    });
}

fn open_usage_window_now(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(PROBE_WINDOW_LABEL) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }

    let cfg = load_config();
    let Ok(target_url) = cfg.url.parse() else { return };

    let app_for_title = app.clone();
    let builder = WebviewWindowBuilder::new(app, PROBE_WINDOW_LABEL, WebviewUrl::External(target_url))
        .title("Gemini Web — Limites de uso (Codenotch)")
        .inner_size(980.0, 720.0)
        .resizable(true)
        .maximizable(true)
        .center()
        .visible(true)
        .user_agent(EDGE_USER_AGENT)
        .initialization_script(PROBE_INIT_SCRIPT)
        .on_document_title_changed(move |window, title| {
            handle_probe_title(&app_for_title, &window, &title);
        });

    let _ = builder.build();
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
        let mut last_probe_eval = Instant::now();

        loop {
            let force_emit = REFRESH.swap(false, Ordering::Relaxed);
            let mut should_read = force_emit;

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

            if should_read || last_scan.elapsed() >= Duration::from_secs(RESCAN_SECS) {
                last_scan = Instant::now();
                let next = read_from_path(&path, now_ms());
                if force_emit || !same_reading(&last, &next) {
                    last = next.clone();
                    broadcast(&app, next);
                }
            }

            if last_probe_eval.elapsed() >= Duration::from_secs(POLL_SECS) {
                last_probe_eval = Instant::now();
                let snap = read_from_path(&path, now_ms());
                let age_ms = now_ms().saturating_sub(snap.fetched_at);
                let is_desktop = is_gemini_desktop_running();
                let max_age_ms = if is_desktop {
                    DESKTOP_POLL_SECS * 1000
                } else {
                    IDLE_POLL_SECS * 1000
                };
                let needs_probe = snap.status != "ok" || age_ms >= max_age_ms;
                if needs_probe {
                    probe_in_background(&app);
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
        let now_after_reset = 1_792_448_400_000;
        let snap = parse_state_json(json_with_epoch, now_after_reset)
            .expect("snapshot after reset time should parse and reset current window");
        assert!((snap.windows[0].used - 0.0).abs() < 1e-6);
        assert_eq!(
            snap.windows[0].resets_at,
            Some(1_792_440_660_000 + CURRENT_CYCLE_MS)
        );
        assert!((snap.windows[1].used - 0.75).abs() < 1e-6);
    }

    #[test]
    fn config_defaults_and_serialization() {
        let def = GeminiWebConfig::default();
        assert_eq!(def.url, "https://gemini.google.com/u/1/usage?pageId=none");
        let serialized = serde_json::to_string(&def).unwrap();
        let parsed: GeminiWebConfig = serde_json::from_str(&serialized).unwrap();
        assert_eq!(def, parsed);
    }
}
