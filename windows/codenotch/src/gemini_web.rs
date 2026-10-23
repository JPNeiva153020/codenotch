//! Gemini Web local state reader (`%APPDATA%\codenotch\gemini-web-state.json`) and autonomous WebView2 probe.
//!
//! Reads the sanitized snapshot written atomically by the Edge extension or the native WebView2 probe.
//! When triggered, can run a background WebView2 probe to refresh quota or open an interactive login/view window.

use crate::usage::{LimitWindow, UsageSnapshot};
use crate::AppState;
use notify::{RecursiveMode, Watcher};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const DEFAULT_USAGE_URL: &str = "https://gemini.google.com/usage?pageId=none";
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
static PROBE_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
static STATE_TRANSACTION: Mutex<()> = Mutex::new(());
static CONFIG_TRANSACTION: Mutex<()> = Mutex::new(());
static TMP_SEQ: AtomicU64 = AtomicU64::new(0);
static LAST_OBSERVED_AT_MS: AtomicU64 = AtomicU64::new(0);

pub const PROBE_INIT_SCRIPT: &str = r#"
(() => {
  try {
    const loc = window.location;
    if (!loc || loc.protocol !== 'https:' || !loc.hostname) return;

    if (loc.hostname === 'accounts.google.com' || loc.pathname.includes('/signin') || loc.pathname.includes('/ServiceLogin')) {
      document.title = '__CODENOTCH_GW_AUTH__';
      return;
    }

    if (loc.hostname !== 'gemini.google.com' || (loc.port && loc.port !== '443') || (loc.search && loc.search !== '?pageId=none') || loc.hash) return;

    const curPath = loc.pathname || '';
    const isUsagePath = /^\/usage\/?$/.test(curPath) || /^\/u\/\d+\/usage\/?$/.test(curPath);
    if (!isUsagePath) return;

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
    let attempts = 0;
    const MAX_ATTEMPTS = 25;
    let failureCode = "no_main";
    let timerId = null;

    const normalize = s => String(s || '').replace(/\s+/gu, ' ').trim();
    const ownText = el => {
      let text = '', nodes = 0;
      for (const node of el.childNodes) {
        if (++nodes > 60) return '';
        if (node.nodeType === 3) {
          if (text.length + node.nodeValue.length > 150) return '';
          text += ' ' + node.nodeValue;
        }
      }
      return normalize(text);
    };

    // Hard traversal budgets: never materialize an unbounded descendant list.
    let traversalFailure = "nodes";
    const boundedElements = (root, limit, maxDepth) => {
      const result = [];
      let visited = 0;
      const walk = (parent, depth) => {
        for (const el of parent.children) {
          if (++visited > limit) { traversalFailure = "nodes"; return false; }
          if (depth > maxDepth) { traversalFailure = "depth"; return false; }
          if (el.closest('nav, aside, [role="navigation"], [role="complementary"], [role="log"], [role="feed"], svg, script, style, template, iframe, input, textarea, form, button, [contenteditable="true"]')) continue;
          result.push(el);
          if (!walk(el, depth + 1)) return false;
        }
        return true;
      };
      return walk(root, 1) ? result : null;
    };

    // Join only a bounded candidate field, including inline text fragments.
    const fieldText = el => {
      if (!boundedElements(el, 32, 6)) return '';
      let text = '', visited = 0;
      const walk = node => {
        for (const child of node.childNodes) {
          if (++visited > 60) return false;
          if (child.nodeType === 3) {
            if (text.length + child.nodeValue.length > 150) return false;
            text += child.nodeValue;
          } else if (child.nodeType === 1) {
            if (child.closest('nav, aside, [role="navigation"], [role="complementary"], [role="log"], [role="feed"], svg, script, style, template, iframe, input, textarea, form, button, [contenteditable="true"]')) continue;
            if (!walk(child)) return false;
          }
        }
        return true;
      };
      return walk(el) ? normalize(text) : '';
    };

    const parseReset = raw => {
      const text = normalize(raw);
      if (text.length > 150) return null;

      const ptMatch = text.match(/^(?:(\d{1,2})\s+de\s+([a-zç]+)\s*\.?\s*,?\s*)?(\d{1,2})\s*:\s*(\d{2})\s*:\s*o limite de uso é redefinido\.?$/iu);
      if (ptMatch) {
        const hour = Number(ptMatch[3]), minute = Number(ptMatch[4]);
        if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
        let day = null, month = null;
        if (ptMatch[1]) {
          const months = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
          month = months.indexOf(ptMatch[2].toLowerCase()) + 1;
          day = Number(ptMatch[1]);
          if (month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > 31) return null;
        }
        return {
          raw_text: text,
          hour,
          minute,
          day,
          month,
          year: null,
          timezone: null,
          epoch_ms: null,
          needs_confirmation: true
        };
      }

      const enMatch = text.match(/^(?:([a-z]+)\s+(\d{1,2})\s*,?\s*)?(\d{1,2})\s*:\s*(\d{2})(?:\s*(am|pm))?\s*:\s*usage limit resets\.?$/iu);
      if (enMatch) {
        let hour = Number(enMatch[3]), minute = Number(enMatch[4]);
        const ampm = enMatch[5]?.toLowerCase();
        if (ampm === 'pm' && hour < 12) hour += 12;
        if (ampm === 'am' && hour === 12) hour = 0;
        if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
        let day = null, month = null;
        if (enMatch[1]) {
          const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
          month = months.indexOf(enMatch[1].toLowerCase().slice(0, 3)) + 1;
          day = Number(enMatch[2]);
          if (month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > 31) return null;
        }
        return {
          raw_text: text,
          hour,
          minute,
          day,
          month,
          year: null,
          timezone: null,
          epoch_ms: null,
          needs_confirmation: true
        };
      }
      return null;
    };

    const runExtraction = () => {
      attempts++;
      if (attempts > MAX_ATTEMPTS) {
        const loc = window.location;
        if (loc.protocol === 'https:' && loc.hostname === 'gemini.google.com' &&
            (!loc.port || loc.port === '443') && (!loc.search || loc.search === '?pageId=none') && !loc.hash &&
            (/^\/usage\/?$/.test(loc.pathname) || /^\/u\/\d+\/usage\/?$/.test(loc.pathname)))
          document.title = "__CODENOTCH_GW_DIAG__:" + failureCode;
        if (timerId) clearInterval(timerId);
        return;
      }

      try {
        const livePath = window.location.pathname || '';
        if ((window.location.port && window.location.port !== '443') || (window.location.search && window.location.search !== '?pageId=none') || window.location.hash) {
          if (timerId) clearInterval(timerId);
          return;
        }
        if (window.location.protocol !== 'https:' || window.location.hostname !== 'gemini.google.com' || (!/^\/usage\/?$/.test(livePath) && !/^\/u\/\d+\/usage\/?$/.test(livePath))) {
          if (timerId) clearInterval(timerId);
          return;
        }

        const root = document.querySelector('main, [role="main"]');
        if (!root) return;

        const rawEls = boundedElements(root, 256, 32);
        if (!rawEls) { failureCode = traversalFailure === "nodes" ? "surface_nodes" : "surface_depth"; return; }
        const textNodes = [];
        for (const el of rawEls) {
          if (el.closest('nav, aside, [role="navigation"], [role="complementary"], [role="log"], [role="feed"], svg, script, style, template, iframe, input, textarea, form, button, [contenteditable="true"]')) continue;
          const txt = ownText(el);
          if (txt && txt.length <= 150) {
            textNodes.push({ el, text: txt });
          }
        }

        const hasCurrent = textNodes.some(x => /^(?:Uso atual|Current usage|Current session)$/iu.test(x.text));
        const hasWeekly = textNodes.some(x => /^(?:Limite semanal|Weekly limit)$/iu.test(x.text));

        if (!hasCurrent && !hasWeekly) { failureCode = "labels_missing"; return; }

        const isPro = textNodes.some(x => /^(?:PRO|Ultra|Advanced)$/iu.test(x.text)) &&
                      !textNodes.some(x => /Aumente o limite de uso|Fazer upgrade|Upgrade to/iu.test(x.text));
        const isFree = textNodes.some(x => /Aumente o limite de uso|Fazer upgrade|Upgrade to/iu.test(x.text));
        const accountTier = isPro ? 'pro' : (isFree ? 'free' : 'unknown');

        const extractCard = (labelPattern, id, otherLabelPattern) => {
          const labelEntry = textNodes.find(x => labelPattern.test(x.text));
          if (!labelEntry) return null;
          let container = labelEntry.el.parentElement;
          let partialCard = null;
          for (let d = 0; d < 3 && container && container !== root; d++) {
            const containerText = ownText(container);
            if (otherLabelPattern && otherLabelPattern.test(containerText)) {
              break;
            }
            const subEls = boundedElements(container, 32, 6);
            if (!subEls) return partialCard;
            const subNodes = subEls.map(e => fieldText(e)).filter(t => t && t.length <= 150);
            if (subNodes.some(t => otherLabelPattern.test(t))) return partialCard;
            const percentages = [...new Set(subNodes.filter(t => /^(?:Quantidade usada|Amount used)\s*:\s*(\d{1,3}(?:[.,]\d+)?)\s*%$/iu.test(t)))];
            const resets = [...new Set(subNodes.filter(t => parseReset(t)))];
            if (percentages.length > 1 || resets.length > 1) return null;
            if (percentages.length === 0) { container = container.parentElement; continue; }
            const pctText = percentages[0];
            const resetText = resets[0];
            if (pctText) {
              const matchPct = pctText.match(/(?:Quantidade usada|Amount used)\s*:\s*(\d{1,3}(?:[.,]\d+)?)\s*%/iu);
              const pct = matchPct ? Number(matchPct[1].replace(',', '.')) : NaN;
              const reset = resetText ? parseReset(resetText) : null;
              if (Number.isFinite(pct) && pct >= 0 && pct <= 100) {
                const card = {
                  id,
                  status: 'observed',
                  used_percent: pct,
                  remaining_percent: Number((100 - pct).toFixed(6)),
                  reset,
                  issues: []
                };
                if (reset) return card;
                partialCard = card;
              }
            }
            container = container.parentElement;
          }
          return partialCard;
        };

        const currentCard = extractCard(
          /^(?:Uso atual|Current usage|Current session)$/iu,
          'current',
          /^(?:Limite semanal|Weekly limit)$/iu
        );
        const weeklyCard = extractCard(
          /^(?:Limite semanal|Weekly limit)$/iu,
          'weekly',
          /^(?:Uso atual|Current usage|Current session)$/iu
        );

        failureCode = !currentCard ? (!weeklyCard ? "both_cards" : "current_card") : "weekly_card";
        if (currentCard && weeklyCard) {
          const now = Date.now();
          const pPath = window.location.pathname || null;
          const sig = `${pPath}|${accountTier}|${currentCard.used_percent}|${currentCard.reset?.raw_text ?? ""}|${weeklyCard.used_percent}|${weeklyCard.reset?.raw_text ?? ""}`;

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
              profile_path: pPath,
              seq: probeSeq,
              windows: [currentCard, weeklyCard],
              issues: []
            };

            if (window.location.protocol !== 'https:' || window.location.hostname !== 'gemini.google.com' || window.location.pathname !== pPath) return;
            document.title = '__CODENOTCH_GW_OK__:' + JSON.stringify(payload);
          }
          if (timerId) clearInterval(timerId);
        }
      } catch (e) {}
    };

    timerId = setInterval(runExtraction, 500);
    setTimeout(runExtraction, 100);
  } catch (err) {}
})();
"#;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct GeminiWebConfig {
    pub url: String,
    #[serde(default)]
    pub reuse_legacy_session: bool,
    #[serde(default = "default_automatic")]
    pub automatic_enabled: bool,
}

fn default_automatic() -> bool { !crate::distribution::IS_FORK }

impl Default for GeminiWebConfig {
    fn default() -> Self {
        Self {
            url: DEFAULT_USAGE_URL.to_string(),
            reuse_legacy_session: false,
            automatic_enabled: default_automatic(),
        }
    }
}

pub fn is_valid_gemini_usage_url(url: &str) -> bool {
    if url.contains('@') || url.contains("..") || url.contains('\\') {
        return false;
    }
    let Ok(parsed) = url.parse::<tauri::Url>() else {
        return false;
    };
    if parsed.scheme() != "https" {
        return false;
    }
    if parsed.host_str() != Some("gemini.google.com") {
        return false;
    }
    if parsed.port_or_known_default() != Some(443) || parsed.fragment().is_some() {
        return false;
    }
    let path = parsed.path();
    let valid_path = if path == "/usage" || path == "/usage/" {
        true
    } else if let Some(rest) = path.strip_prefix("/u/") {
        let rest = rest.strip_suffix('/').unwrap_or(rest);
        if let Some(digits) = rest.strip_suffix("/usage") {
            !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit())
        } else {
            false
        }
    } else {
        false
    };
    if !valid_path {
        return false;
    }
    if let Some(q) = parsed.query() {
        if q != "pageId=none" && !q.is_empty() {
            return false;
        }
    }
    true
}

fn quota_data_directory() -> Result<Option<PathBuf>, &'static str> {
    if let Some(root) = crate::gemini_lab_profile::root() { return Ok(Some(root.join("quota-webview"))); }
    if !crate::distribution::IS_FORK { return Ok(None); }
    let cfg=load_config();
    #[cfg(windows)]
    let legacy_running=cfg.reuse_legacy_session && crate::focus::proc_maps().name.values().any(|n|n=="codenotch.exe");
    #[cfg(not(windows))]
    let legacy_running=false;
    let local=dirs::data_local_dir().ok_or("local data directory unavailable")?;
    crate::distribution::quota_directory(&local,cfg.reuse_legacy_session,legacy_running).map(Some)
}

pub fn config_path() -> PathBuf {
    crate::config::config_path().with_file_name("gemini-web-config.json")
}

pub fn load_config() -> GeminiWebConfig {
    let p = config_path();
    if let Ok(raw) = std::fs::read_to_string(&p) {
        if let Ok(cfg) = serde_json::from_str::<GeminiWebConfig>(&raw) {
            if is_valid_gemini_usage_url(&cfg.url) {
                return cfg;
            }
        }
    }
    GeminiWebConfig::default()
}

pub fn save_config(cfg: &GeminiWebConfig) {
    if !is_valid_gemini_usage_url(&cfg.url) {
        return;
    }
    let p = config_path();
    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(cfg) {
        let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
        let tmp = p.with_extension(format!("tmp.{}.{}", std::process::id(), seq));
        if std::fs::write(&tmp, json).is_ok() {
            let _ = std::fs::rename(&tmp, &p);
        }
    }
}

pub fn set_automatic_preference(on:bool)->Result<(), &'static str> {
    let _guard=CONFIG_TRANSACTION.lock().map_err(|_|"Gemini preference unavailable")?;
    let mut cfg=load_config();cfg.automatic_enabled=on;save_config(&cfg);
    if load_config().automatic_enabled!=on { return Err("could not save Gemini preference"); }
    Ok(())
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
    if let Some(root) = crate::gemini_lab_profile::root() {
        return root.join("gemini-web-state.json");
    }
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
    let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let tmp = path.with_extension(format!("tmp.{}.{}", std::process::id(), seq));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp)?;
    let result = (|| -> std::io::Result<()> {
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct RawResetInfo {
    #[serde(default)]
    pub raw_text: Option<String>,
    #[serde(default)]
    pub hour: Option<u32>,
    #[serde(default)]
    pub minute: Option<u32>,
    #[serde(default)]
    pub day: Option<u32>,
    #[serde(default)]
    pub month: Option<u32>,
    #[serde(default)]
    pub year: Option<u32>,
    #[serde(default)]
    pub timezone: Option<String>,
    #[serde(default)]
    pub epoch_ms: Option<u64>,
    #[serde(default)]
    pub needs_confirmation: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SanitizedWindow {
    pub id: String,
    pub status: String,
    pub used_percent: f64,
    pub remaining_percent: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reset: Option<RawResetInfo>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SanitizedPayload {
    pub schema_version: u32,
    pub provider: String,
    pub origin: String,
    pub status: String,
    pub observed_at_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_tier: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(skip_serializing)]
    pub profile_path: Option<String>,
    pub windows: Vec<SanitizedWindow>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct RawProbeWindow {
    id: String,
    status: String,
    used_percent: f64,
    #[serde(default, rename = "remaining_percent")]
    _remaining_percent: Option<f64>,
    #[serde(default)]
    reset: Option<RawResetInfo>,
    #[serde(default, rename = "issues")]
    _issues: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct RawProbePayload {
    schema_version: u32,
    provider: String,
    #[serde(default, rename = "origin")]
    _origin: Option<String>,
    #[serde(default, rename = "collection")]
    _collection: Option<String>,
    #[serde(default, rename = "model")]
    _model: Option<String>,
    status: String,
    observed_at_ms: u64,
    #[serde(default)]
    account_tier: Option<String>,
    #[serde(default)]
    profile_path: Option<String>,
    #[serde(default, rename = "seq")]
    _seq: Option<u64>,
    windows: Vec<RawProbeWindow>,
    #[serde(default, rename = "issues")]
    _issues: Option<Vec<serde_json::Value>>,
}

pub fn validate_and_sanitize_payload(
    raw_json: &str,
    now: u64,
    last_observed_at: u64,
) -> Result<(SanitizedPayload, String), &'static str> {
    if raw_json.len() > 8192 {
        return Err("payload exceeds maximum allowed size (8192 bytes)");
    }
    let raw: RawProbePayload = serde_json::from_str(raw_json)
        .map_err(|_| "invalid JSON structure or unexpected fields")?;

    if raw.schema_version != 1 {
        return Err("unsupported schema version");
    }
    if raw.provider != "gemini_web" {
        return Err("invalid provider");
    }
    if raw.status != "observed" {
        return Err("invalid status");
    }
    if raw.observed_at_ms == 0 {
        return Err("observed_at_ms must be non-zero");
    }
    if raw.observed_at_ms > now.saturating_add(60_000) {
        return Err("observed_at_ms is in the future");
    }
    if raw.observed_at_ms < last_observed_at {
        return Err("observed_at_ms is older than last known observation (out of order)");
    }

    if raw.windows.len() != 2 {
        return Err("windows array must contain exactly 2 entries");
    }

    let mut sanitized_windows = Vec::with_capacity(2);
    let mut seen_current = false;
    let mut seen_weekly = false;

    for w in raw.windows {
        if w.status != "observed" {
            return Err("window status must be observed");
        }
        if !w.used_percent.is_finite() || !(0.0..=100.0).contains(&w.used_percent) {
            return Err("used_percent out of range (0-100)");
        }
        let remaining = (100.0 - w.used_percent).clamp(0.0, 100.0);

        let validated_reset = if let Some(r) = w.reset {
            // Validação de par hora / minuto
            match (r.hour, r.minute) {
                (Some(h), Some(m)) => {
                    if h > 23 {
                        return Err("reset hour out of range (0-23)");
                    }
                    if m > 59 {
                        return Err("reset minute out of range (0-59)");
                    }
                }
                (None, None) => {}
                _ => return Err("incomplete hour/minute pair"),
            }

            // Validação de par dia / mês e calendário
            match (r.day, r.month) {
                (Some(d), Some(mo)) => {
                    if !(1..=12).contains(&mo) {
                        return Err("reset month out of range (1-12)");
                    }
                    if d < 1 {
                        return Err("reset day out of range (< 1)");
                    }
                    let max_days = match mo {
                        2 => 29,
                        4 | 6 | 9 | 11 => 30,
                        _ => 31,
                    };
                    if d > max_days {
                        return Err("reset day exceeds days in month");
                    }
                    if r.hour.is_none() || r.minute.is_none() {
                        return Err("reset with date requires time pair");
                    }
                }
                (None, None) => {}
                _ => return Err("incomplete day/month pair"),
            }

            let raw_text: Option<String> = if let Some(t) = r.raw_text {
                if t.to_ascii_lowercase().contains("http://")
                    || t.to_ascii_lowercase().contains("https://")
                    || t.contains('@')
                {
                    return Err("raw_text contains disallowed patterns");
                }
                None // Render only validated numeric components; discard page text.
            } else {
                None
            };

            Some(RawResetInfo {
                raw_text,
                hour: r.hour,
                minute: r.minute,
                day: r.day,
                month: r.month,
                year: None,
                timezone: None,
                epoch_ms: None,
                needs_confirmation: true,
            })
        } else {
            None
        };

        if w.id == "current" {
            if seen_current {
                return Err("duplicate current window");
            }
            seen_current = true;
        } else if w.id == "weekly" {
            if seen_weekly {
                return Err("duplicate weekly window");
            }
            seen_weekly = true;
        } else {
            return Err("unexpected window id");
        }

        sanitized_windows.push(SanitizedWindow {
            id: w.id,
            status: "observed".into(),
            used_percent: w.used_percent,
            remaining_percent: remaining,
            reset: validated_reset,
        });
    }

    if !seen_current || !seen_weekly {
        return Err("both current and weekly windows are required");
    }

    sanitized_windows.sort_by_key(|w| if w.id == "current" { 0 } else { 1 });

    let sanitized_profile_path = raw.profile_path.and_then(|p| {
        if p == "/usage" {
            Some(p)
        } else if let Some(digits) = p.strip_prefix("/u/").and_then(|r| r.strip_suffix("/usage")) {
            if !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit()) {
                Some(p)
            } else {
                None
            }
        } else {
            None
        }
    });

    let sanitized_account_tier = match raw.account_tier.as_deref() {
        Some("pro") => Some("pro".to_string()),
        Some("free") => Some("free".to_string()),
        _ => None,
    };

    let payload = SanitizedPayload {
        schema_version: 1,
        provider: "gemini_web".into(),
        origin: "visible_ui".into(),
        status: "observed".into(),
        observed_at_ms: raw.observed_at_ms,
        account_tier: sanitized_account_tier,
        profile_path: sanitized_profile_path,
        windows: sanitized_windows,
    };

    let json_str = serde_json::to_string_pretty(&payload).map_err(|_| "serialization failed")?;

    Ok((payload, json_str))
}

pub fn parse_state_json(raw: &str, now: u64) -> Option<UsageSnapshot> {
    // Disk and live titles share the same strict contract and reset sanitization.
    let (_, canonical) = validate_and_sanitize_payload(raw, now, 0).ok()?;
    let v: serde_json::Value = serde_json::from_str(&canonical).ok()?;
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
        // Fiel ao consumo observado: nunca zera artificialmente por relógio
        let used = (pct / 100.0).clamp(0.0, 1.0);

        let resets_at = item
            .get("reset")
            .and_then(|r| r.get("epoch_ms"))
            .and_then(|e| e.as_u64());

        let reset_detail = item.get("reset").and_then(|r| {
            let hour = r.get("hour").and_then(|h| h.as_u64());
            let minute = r.get("minute").and_then(|m| m.as_u64());
            let day = r.get("day").and_then(|d| d.as_u64());
            let month = r.get("month").and_then(|mo| mo.as_u64());

            match (day, month, hour, minute) {
                (Some(d), Some(mo), Some(h), Some(m)) => Some(format!(
                    "Renovação: {:02}/{:02} às {:02}:{:02}",
                    d, mo, h, m
                )),
                (None, None, Some(h), Some(m)) => Some(format!(
                    "Renovação: {:02}:{:02}",
                    h, m
                )),
                _ => None,
            }
        });

        windows.push(LimitWindow {
            id: expected_id.to_string(),
            label: label.to_string(),
            used,
            resets_at,
            reset_detail,
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
        note: if status == "stale" {
            "Última leitura (Gemini Web)".to_string()
        } else {
            "via Gemini Web (/usage)".to_string()
        },
        backoff_until: 0,
        account: Some("Gemini Web".to_string()),
    })
}

pub fn read_from_path(path: &Path, now: u64) -> UsageSnapshot {
    let raw = (|| -> std::io::Result<String> {
        let file = std::fs::File::open(path)?;
        let mut raw = String::new();
        file.take(8193).read_to_string(&mut raw)?;
        Ok(raw)
    })();
    let Ok(raw) = raw else {
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
    a.windows.iter().zip(b.windows.iter()).all(|(x, y)| {
        x.id == y.id
            && (x.used - y.used).abs() < 1e-6
            && x.resets_at == y.resets_at
            && x.reset_detail == y.reset_detail
    })
}

fn broadcast(app: &AppHandle, snap: UsageSnapshot) {
    let st = app.state::<AppState>();
    let mut lock = st.gemini_web.lock().unwrap_or_else(|e| e.into_inner());
    *lock = snap.clone();
    drop(lock);
    let _ = app.emit("gemini_web", &snap);
    if !crate::gemini_lab_profile::is_lab() {
        crate::tray::refresh_menu(app);
    }
}

pub fn is_gemini_desktop_running() -> bool {
    if crate::gemini_lab_profile::is_lab() {
        return false;
    }
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

pub fn handle_probe_title(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    title: &str,
    expected_generation: u64,
) {
    if crate::gemini_lab_profile::generation() != expected_generation {
        return;
    }
    let Ok(cur_url) = window.url() else {
        return;
    };
    if !is_valid_gemini_usage_url(cur_url.as_str()) {
        return;
    }
    if title.len() > 8192 {
        return;
    }

    if let Some(code) = title.strip_prefix("__CODENOTCH_GW_DIAG__:") {
        if matches!(code, "no_main" | "surface_nodes" | "surface_depth" | "labels_missing" | "both_cards" | "current_card" | "weekly_card") {
            crate::applog(&format!("gemini_web: capture unavailable ({code})"));
        }
        PROBE_IN_FLIGHT.store(false, Ordering::SeqCst);
        if !window.is_visible().unwrap_or(false) { let _ = window.destroy(); }
        return;
    }
    if let Some(payload_json) = title.strip_prefix("__CODENOTCH_GW_OK__:") {
        PROBE_IN_FLIGHT.store(false, Ordering::SeqCst);

        let now = now_ms();
        // Serialize validation + disk replacement + watermark publication in this process.
        // Cross-process writers remain unsupported; do not claim a cross-process lock.
        let transaction = match STATE_TRANSACTION.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        if crate::gemini_lab_profile::generation() != expected_generation {
            return;
        }
        let disk_obs = read_from_path(&state_path(), now).fetched_at;
        let last_obs = LAST_OBSERVED_AT_MS.load(Ordering::Relaxed).max(disk_obs);

        let (sanitized_payload, sanitized_json) =
            match validate_and_sanitize_payload(payload_json, now, last_obs) {
                Ok(res) => res,
                Err(e) => {
                    crate::applog(&format!("gemini_web: rejected invalid probe payload: {e}"));
                    if !window.is_visible().unwrap_or(false) {
                        let _ = window.destroy();
                    }
                    return;
                }
            };

        let state_p = state_path();
        if let Ok(()) = save_state_atomically(&state_p, &sanitized_json) {
            LAST_OBSERVED_AT_MS.fetch_max(sanitized_payload.observed_at_ms, Ordering::Relaxed);
        } else {
            drop(transaction);
            if !window.is_visible().unwrap_or(false) {
                let _ = window.destroy();
            }
            return;
        }
        drop(transaction);
        let snap = read_from_path(&state_p, now);
        broadcast(app, snap);
        request_refresh();

        if sanitized_payload.account_tier.as_deref() == Some("pro") {
            if let Some(ref p_path) = sanitized_payload.profile_path {
                let new_url = format!("https://gemini.google.com{}?pageId=none", p_path);
                if is_valid_gemini_usage_url(&new_url) {
                    if let Ok(_guard)=CONFIG_TRANSACTION.lock() {
                        let mut cfg=load_config();
                        if cfg.url!=new_url { cfg.url=new_url;save_config(&cfg); }
                    }
                }
            }
        }

        if !window.is_visible().unwrap_or(false) {
            let _ = window.destroy();
        }
    } else if title == "__CODENOTCH_GW_AUTH__" || title.starts_with("__CODENOTCH_GW_ERR__:") {
        PROBE_IN_FLIGHT.store(false, Ordering::SeqCst);
        if !window.is_visible().unwrap_or(false) {
            let _ = window.destroy();
        }
    }
}

pub fn stop_probe(app: &AppHandle) {
    {
        let _transaction=STATE_TRANSACTION.lock().unwrap_or_else(|p|p.into_inner());
        crate::gemini_lab_profile::cancel_pending();
    }
    if let Some(window) = app.get_webview_window(PROBE_WINDOW_LABEL) {
        let _ = window.destroy();
    }
    PROBE_IN_FLIGHT.store(false, Ordering::SeqCst);
}

pub fn force_manual_probe(app: &AppHandle) {
    let gesture_generation = crate::gemini_lab_profile::generation();
    if let Some(existing) = app.get_webview_window(PROBE_WINDOW_LABEL) {
        if !existing.is_visible().unwrap_or(false) {
            let _ = existing.destroy();
        }
    }
    PROBE_IN_FLIGHT.store(false, Ordering::SeqCst);
    LAST_PROBE_MS.store(0, Ordering::Relaxed);
    request_refresh();
    if crate::gemini_lab_profile::is_lab() {
        probe_in_background_for_generation(app, gesture_generation);
    } else {
        probe_in_background(app);
    }
}

pub fn probe_in_background(app: &AppHandle) {
    probe_in_background_for_generation(app, crate::gemini_lab_profile::generation());
}

fn probe_in_background_for_generation(app: &AppHandle, generation: u64) {
    if crate::gemini_lab_profile::generation() != generation {
        return;
    }
    let now = now_ms();
    let last = LAST_PROBE_MS.load(Ordering::Relaxed);
    if now.saturating_sub(last) < 5_000 {
        return;
    }
    if PROBE_IN_FLIGHT
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    LAST_PROBE_MS.store(now, Ordering::Relaxed);

    let handle = app.clone();
    std::thread::spawn(move || {
        let app = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            if crate::gemini_lab_profile::generation() != generation {
                return;
            }
            probe_in_background_now(&app, generation);
        });
    });
}

fn probe_in_background_now(app: &AppHandle, generation: u64) {
    if crate::gemini_lab_profile::generation() != generation {
        return;
    }
    if let Some(w) = app.get_webview_window(PROBE_WINDOW_LABEL) {
        if w.is_visible().unwrap_or(false) {
            PROBE_IN_FLIGHT.store(false, Ordering::SeqCst);
            return;
        }
        return;
    }

    let cfg = load_config();
    let Ok(target_url) = cfg.url.parse() else {
        PROBE_IN_FLIGHT.store(false, Ordering::SeqCst);
        return;
    };

    let app_for_title = app.clone();
    let builder =
        WebviewWindowBuilder::new(app, PROBE_WINDOW_LABEL, WebviewUrl::External(target_url))
            .title("Gemini Web Probe")
            .inner_size(980.0, 720.0)
            .visible(false)
            .skip_taskbar(true)
            .focused(false)
            .user_agent(EDGE_USER_AGENT)
            .initialization_script(PROBE_INIT_SCRIPT)
            .on_document_title_changed(move |window, title| {
                if crate::gemini_lab_profile::generation() == generation {
                    handle_probe_title(&app_for_title, &window, &title, generation);
                }
            });

    let directory=match quota_data_directory() {
        Ok(directory)=>directory,
        Err(_)=>{ PROBE_IN_FLIGHT.store(false,Ordering::SeqCst); return; }
    };
    let builder=if let Some(directory)=directory { builder.data_directory(directory) } else { builder };
    match builder.build() {
        Ok(w) => {
            if crate::gemini_lab_profile::generation() != generation {
                let _ = w.destroy();
                PROBE_IN_FLIGHT.store(false, Ordering::SeqCst);
                return;
            }
            let w_handle = w.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(20));
                if let Ok(visible) = w_handle.is_visible() {
                    if !visible {
                        let _ = w_handle.destroy();
                        PROBE_IN_FLIGHT.store(false, Ordering::SeqCst);
                    }
                }
            });
        }
        Err(_) => {
            PROBE_IN_FLIGHT.store(false, Ordering::SeqCst);
        }
    }
}

pub fn open_usage_window(app: &AppHandle) {
    let generation = crate::gemini_lab_profile::generation();
    let handle = app.clone();
    std::thread::spawn(move || {
        let app = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            if crate::gemini_lab_profile::generation() != generation {
                return;
            }
            open_usage_window_now(&app, generation);
        });
    });
}

fn open_usage_window_now(app: &AppHandle, generation: u64) {
    if crate::gemini_lab_profile::generation() != generation {
        return;
    }
    if let Some(w) = app.get_webview_window(PROBE_WINDOW_LABEL) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }

    let cfg = load_config();
    let Ok(target_url) = cfg.url.parse() else {
        return;
    };

    let app_for_title = app.clone();
    let builder =
        WebviewWindowBuilder::new(app, PROBE_WINDOW_LABEL, WebviewUrl::External(target_url))
            .title("Gemini Web — Limites de uso (Codenotch)")
            .inner_size(980.0, 720.0)
            .resizable(true)
            .maximizable(true)
            .center()
            .visible(true)
            .user_agent(EDGE_USER_AGENT)
            .initialization_script(PROBE_INIT_SCRIPT)
            .on_document_title_changed(move |window, title| {
                if crate::gemini_lab_profile::generation() == generation {
                    handle_probe_title(&app_for_title, &window, &title, generation);
                }
            });

    let directory=match quota_data_directory() {
        Ok(directory)=>directory,
        Err(_)=>{ PROBE_IN_FLIGHT.store(false,Ordering::SeqCst); return; }
    };
    let builder=if let Some(directory)=directory { builder.data_directory(directory) } else { builder };
    if let Ok(window) = builder.build() {
        if crate::gemini_lab_profile::generation() != generation {
            let _ = window.destroy();
        }
    }
}

fn automatic_probe_due(enabled:bool,status:&str,age:u64,since_attempt:u64,period:u64)->bool {
    enabled && since_attempt>=period && (status!="ok" || age>=period)
}

pub fn start(app: AppHandle) {
    let watcher_generation = crate::gemini_lab_profile::generation();
    std::thread::spawn(move || {
        if crate::gemini_lab_profile::generation() != watcher_generation {
            return;
        }
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
        if last.fetched_at > 0 {
            LAST_OBSERVED_AT_MS.fetch_max(last.fetched_at, Ordering::Relaxed);
        }
        broadcast(&app, last.clone());
        let mut last_scan = Instant::now();
        let mut last_probe_eval = Instant::now();

        loop {
            if crate::gemini_lab_profile::generation() != watcher_generation
                || (crate::gemini_lab_profile::is_lab() && !crate::gemini_lab_profile::automatic_allowed())
            {
                break;
            }
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
                let mut next = read_from_path(&path, now_ms());
                if next.fetched_at > 0
                    && next.fetched_at < LAST_OBSERVED_AT_MS.load(Ordering::Relaxed)
                {
                    next = UsageSnapshot {
                        status: "absent".into(),
                        ..Default::default()
                    };
                }
                if next.fetched_at > 0 {
                    LAST_OBSERVED_AT_MS.fetch_max(next.fetched_at, Ordering::Relaxed);
                }
                if force_emit || !same_reading(&last, &next) {
                    last = next.clone();
                    broadcast(&app, next);
                }
            }

            if crate::gemini_lab_profile::generation() != watcher_generation
                || (crate::gemini_lab_profile::is_lab() && !crate::gemini_lab_profile::automatic_allowed())
            {
                break;
            }
            if last_probe_eval.elapsed() >= Duration::from_secs(POLL_SECS) {
                last_probe_eval = Instant::now();
                let allowed=if crate::gemini_lab_profile::is_lab() {
                    crate::gemini_lab_profile::automatic_allowed()
                }else{load_config().automatic_enabled};
                if !allowed { continue; }
                let snap = read_from_path(&path, now_ms());
                let age_ms = now_ms().saturating_sub(snap.fetched_at);
                let is_desktop = is_gemini_desktop_running();
                let max_age_ms = if is_desktop {
                    DESKTOP_POLL_SECS * 1000
                } else {
                    IDLE_POLL_SECS * 1000
                };
                let since_attempt=now_ms().saturating_sub(LAST_PROBE_MS.load(Ordering::Relaxed));
                let needs_probe = automatic_probe_due(allowed,&snap.status,age_ms,since_attempt,max_age_ms);
                if needs_probe {
                    probe_in_background_for_generation(&app, watcher_generation);
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_distribution_requires_consent_and_failed_reads_respect_the_interval() {
        let config:GeminiWebConfig=serde_json::from_str(r#"{"url":"https://gemini.google.com/usage"}"#).unwrap();
        assert_eq!(config.automatic_enabled,!crate::distribution::IS_FORK);
        assert!(!automatic_probe_due(false,"absent",u64::MAX,u64::MAX,120_000));
        assert!(!automatic_probe_due(true,"absent",u64::MAX,119_999,120_000));
        assert!(automatic_probe_due(true,"absent",u64::MAX,120_000,120_000));
        assert!(!automatic_probe_due(true,"ok",119_999,u64::MAX,120_000));
        assert!(automatic_probe_due(true,"ok",120_000,120_000,120_000));
    }
    #[test]
    fn profile_route_hint_is_runtime_only_and_never_persisted() {
        let now = now_ms();
        let mut value: serde_json::Value = serde_json::from_str(SAMPLE_JSON).unwrap();
        value["observed_at_ms"] = serde_json::json!(now);
        value["profile_path"] = serde_json::json!("/u/7/usage");
        let (payload, canonical) = validate_and_sanitize_payload(&value.to_string(), now, 0).unwrap();
        assert_eq!(payload.profile_path.as_deref(), Some("/u/7/usage"));
        let stored: serde_json::Value = serde_json::from_str(&canonical).unwrap();
        assert!(stored.get("profile_path").is_none());
        assert!(!canonical.contains("/u/7/"));
        assert!(parse_state_json(&canonical, now).is_some());
    }


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
    fn expired_reset_window_preserves_observed_used_percent_without_synthetic_zeroing() {
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
            .expect("snapshot after reset time should parse and preserve observed usage");
        // Conforme a regra da Seção 4: o consumo observado (1.0) NUNCA é zerado por relógio!
        assert!((snap.windows[0].used - 1.0).abs() < 1e-6);
        assert_eq!(
            snap.windows[0].resets_at,
            None // unconfirmed epochs from disk must not become countdowns
        );
        assert!((snap.windows[1].used - 0.75).abs() < 1e-6);
        assert!(snap.windows[0].reset_detail.is_some());
    }

    #[test]
    fn validate_and_sanitize_accepts_valid_payload() {
        let (payload, json) = validate_and_sanitize_payload(SAMPLE_JSON, 1_776_000_005_000, 0)
            .expect("valid sample should pass validation");
        assert_eq!(payload.schema_version, 1);
        assert_eq!(payload.provider, "gemini_web");
        assert_eq!(payload.status, "observed");
        assert_eq!(payload.windows.len(), 2);
        assert_eq!(payload.windows[0].id, "current");
        assert!((payload.windows[0].used_percent - 48.0).abs() < 1e-6);
        assert_eq!(payload.windows[1].id, "weekly");
        assert!((payload.windows[1].used_percent - 12.0).abs() < 1e-6);
        assert!(json.contains("\"provider\": \"gemini_web\""));
    }

    #[test]
    fn validate_and_sanitize_rejects_payload_too_large() {
        let huge = " ".repeat(8193);
        let err = validate_and_sanitize_payload(&huge, 1000, 0).unwrap_err();
        assert!(err.contains("maximum allowed size"));
    }

    #[test]
    fn validate_and_sanitize_rejects_out_of_order_observation() {
        let err = validate_and_sanitize_payload(SAMPLE_JSON, 1_776_000_005_000, 1_776_000_001_000)
            .unwrap_err();
        assert!(err.contains("out of order"));
    }

    #[test]
    fn validate_and_sanitize_rejects_invalid_percentages() {
        let invalid_pct = SAMPLE_JSON.replace("\"used_percent\": 48", "\"used_percent\": 150");
        let err = validate_and_sanitize_payload(&invalid_pct, 1_776_000_005_000, 0).unwrap_err();
        assert!(err.contains("used_percent out of range"));
    }

    #[test]
    fn validate_and_sanitize_rejects_duplicate_windows() {
        let dup = SAMPLE_JSON.replace("\"id\": \"weekly\"", "\"id\": \"current\"");
        let err = validate_and_sanitize_payload(&dup, 1_776_000_005_000, 0).unwrap_err();
        assert!(err.contains("duplicate current window"));
    }

    #[test]
    fn validate_and_sanitize_rejects_out_of_range_reset_components() {
        let bad_hour = SAMPLE_JSON.replace("\"hour\": 17", "\"hour\": 26");
        let err = validate_and_sanitize_payload(&bad_hour, 1_776_000_005_000, 0).unwrap_err();
        assert!(err.contains("reset hour out of range"));
    }

    #[test]
    fn validate_and_sanitize_rejects_incomplete_pairs_and_invalid_calendar() {
        // Hour without minute
        let bad_pair = SAMPLE_JSON.replace("\"minute\": 6", "\"minute\": null");
        let err = validate_and_sanitize_payload(&bad_pair, 1_776_000_005_000, 0).unwrap_err();
        assert!(err.contains("incomplete hour/minute pair"));

        // Day without month
        let bad_day_pair = SAMPLE_JSON.replace("\"month\": 4", "\"month\": null");
        let err = validate_and_sanitize_payload(&bad_day_pair, 1_776_000_005_000, 0).unwrap_err();
        assert!(err.contains("incomplete day/month pair"));

        // Invalid calendar: April 31
        let bad_cal = SAMPLE_JSON.replace(
            "\"day\": 21,\n                    \"month\": 4",
            "\"day\": 31,\n                    \"month\": 4",
        );
        let err = validate_and_sanitize_payload(&bad_cal, 1_776_000_005_000, 0).unwrap_err();
        assert!(err.contains("reset day exceeds days in month"));
    }

    #[test]
    fn validate_and_sanitize_accepts_missing_resets() {
        let no_resets = r#"{
            "schema_version": 1,
            "provider": "gemini_web",
            "status": "observed",
            "observed_at_ms": 1776000000000,
            "windows": [
                {
                    "id": "current",
                    "status": "observed",
                    "used_percent": 48,
                    "remaining_percent": 52,
                    "reset": null
                },
                {
                    "id": "weekly",
                    "status": "observed",
                    "used_percent": 12,
                    "remaining_percent": 88,
                    "reset": null
                }
            ]
        }"#;
        let (payload, _) = validate_and_sanitize_payload(no_resets, 1_776_000_005_000, 0)
            .expect("payload without resets must be accepted");
        assert!(payload.windows[0].reset.is_none());
        assert!(payload.windows[1].reset.is_none());
    }

    #[test]
    fn validate_and_sanitize_rejects_unknown_fields_and_disallowed_raw_text() {
        // Unknown field rejected by serde(deny_unknown_fields)
        let with_unknown = SAMPLE_JSON.replace(
            "\"status\": \"observed\"",
            "\"status\": \"observed\", \"injected_extra\": 42",
        );
        let err = validate_and_sanitize_payload(&with_unknown, 1_776_000_005_000, 0).unwrap_err();
        assert!(err.contains("invalid JSON structure or unexpected fields"));

        // Disallowed raw_text with URL or email
        let with_url = SAMPLE_JSON.replace(
            "\"hour\": 17",
            "\"raw_text\": \"https://invalid.example/\", \"hour\": 17",
        );
        let err = validate_and_sanitize_payload(&with_url, 1_776_000_005_000, 0).unwrap_err();
        assert!(err.contains("disallowed patterns"));
    }

    #[test]
    fn config_defaults_and_serialization() {
        let def = GeminiWebConfig::default();
        assert_eq!(def.url, DEFAULT_USAGE_URL);
        let serialized = serde_json::to_string(&def).unwrap();
        let parsed: GeminiWebConfig = serde_json::from_str(&serialized).unwrap();
        assert_eq!(def, parsed);
    }

    #[test]
    fn url_validation_accepts_valid_gemini_urls() {
        assert!(is_valid_gemini_usage_url("https://gemini.google.com/usage"));
        assert!(is_valid_gemini_usage_url(
            "https://gemini.google.com/usage/"
        ));
        assert!(is_valid_gemini_usage_url(
            "https://gemini.google.com/usage?pageId=none"
        ));
        assert!(is_valid_gemini_usage_url(
            "https://gemini.google.com/u/0/usage"
        ));
        assert!(is_valid_gemini_usage_url(
            "https://gemini.google.com/u/1/usage"
        ));
        assert!(is_valid_gemini_usage_url(
            "https://gemini.google.com/u/2/usage?pageId=none"
        ));
        assert!(is_valid_gemini_usage_url(
            "https://gemini.google.com/u/10/usage?pageId=none"
        ));
    }

    #[test]
    fn url_validation_rejects_malicious_or_external_urls() {
        assert!(!is_valid_gemini_usage_url("http://gemini.google.com/usage"));
        assert!(!is_valid_gemini_usage_url("https://evil.com/usage"));
        assert!(!is_valid_gemini_usage_url(
            "https://gemini.google.com.evil.com/usage"
        ));
        assert!(!is_valid_gemini_usage_url("https://gemini.google.com/app"));
        assert!(!is_valid_gemini_usage_url(
            "https://gemini.google.com/u/1/app"
        ));
        assert!(!is_valid_gemini_usage_url(
            "https://user:pass@gemini.google.com/usage"
        ));
        assert!(!is_valid_gemini_usage_url(
            "https://gemini.google.com/usage/../admin"
        ));
        assert!(!is_valid_gemini_usage_url(
            "https://gemini.google.com\\evil/usage"
        ));
        assert!(!is_valid_gemini_usage_url(
            "https://gemini.google.com/u/abc/usage"
        ));
        assert!(!is_valid_gemini_usage_url(
            "https://gemini.google.com/usage?extra=param"
        ));
    }

    #[test]
    fn disk_input_uses_same_contract_and_discards_unconfirmed_epoch() {
        let invalid = SAMPLE_JSON.replace("\"hour\": 17", "\"hour\": 99");
        assert!(parse_state_json(&invalid, 1_776_000_060_000).is_none());
        let unknown = SAMPLE_JSON.replace(
            "\"schema_version\": 1",
            "\"schema_version\": 1, \"unknown\": true",
        );
        assert!(parse_state_json(&unknown, 1_776_000_060_000).is_none());
        let epoch = SAMPLE_JSON.replace("\"epoch_ms\": null", "\"epoch_ms\": 1776000001000");
        let snap = parse_state_json(&epoch, 1_776_000_060_000).unwrap();
        assert!(snap.windows.iter().all(|w| w.resets_at.is_none()));
    }

    #[test]
    fn reset_only_changes_are_visible_to_watcher() {
        let a = parse_state_json(SAMPLE_JSON, 1_776_000_060_000).unwrap();
        let b = parse_state_json(
            &SAMPLE_JSON.replace("\"minute\": 6", "\"minute\": 7"),
            1_776_000_060_000,
        )
        .unwrap();
        assert!(!same_reading(&a, &b));
    }

    #[test]
    fn canonical_snapshot_round_trips_without_raw_page_text() {
        let with_text = SAMPLE_JSON.replace(
            "\"hour\": 17",
            "\"raw_text\": \"arbitrary page text\", \"hour\": 17",
        );
        let (_, canonical) =
            validate_and_sanitize_payload(&with_text, 1_776_000_060_000, 0).unwrap();
        assert!(!canonical.contains("arbitrary page text"));
        assert!(parse_state_json(&canonical, 1_776_000_060_000).is_some());
    }

    #[test]
    fn atomic_state_replacement_uses_real_rust_writer() {
        let dir = std::env::temp_dir().join(format!(
            "codenotch-rust-state-{}-{}",
            std::process::id(),
            TMP_SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("state.json");
        let (_, canonical) =
            validate_and_sanitize_payload(SAMPLE_JSON, 1_776_000_060_000, 0).unwrap();
        save_state_atomically(&path, &canonical).unwrap();
        save_state_atomically(&path, &canonical).unwrap();
        assert_eq!(
            read_from_path(&path, 1_776_000_060_000).fetched_at,
            1_776_000_000_000
        );
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn oversized_state_file_fails_closed() {
        let path = std::env::temp_dir().join(format!(
            "codenotch-large-state-{}-{}.json",
            std::process::id(),
            TMP_SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::write(&path, " ".repeat(8193)).unwrap();
        assert_eq!(read_from_path(&path, 1_776_000_060_000).status, "absent");
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn concurrent_native_writers_keep_complete_snapshots() {
        use std::sync::{Arc, Barrier};
        let dir = std::env::temp_dir().join(format!(
            "codenotch-native-concurrent-{}-{}",
            std::process::id(),
            TMP_SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = Arc::new(dir.join("state.json"));
        let (_, initial) =
            validate_and_sanitize_payload(SAMPLE_JSON, 1_776_000_060_000, 0).unwrap();
        save_state_atomically(&path, &initial).unwrap();
        let barrier = Arc::new(Barrier::new(3));
        let mut workers = Vec::new();
        for percent in [37, 62] {
            let path = Arc::clone(&path);
            let barrier = Arc::clone(&barrier);
            workers.push(std::thread::spawn(move || {
                let raw = SAMPLE_JSON.replace(
                    "\"used_percent\": 48",
                    &format!("\"used_percent\": {percent}"),
                );
                let (_, canonical) =
                    validate_and_sanitize_payload(&raw, 1_776_000_060_000, 0).unwrap();
                barrier.wait();
                for _ in 0..4 {
                    save_state_atomically(&path, &canonical).unwrap();
                }
            }));
        }
        let reader_path = Arc::clone(&path);
        let reader_barrier = Arc::clone(&barrier);
        let reader = std::thread::spawn(move || {
            reader_barrier.wait();
            let mut reads = 0;
            for _ in 0..30 {
                match std::fs::read_to_string(&*reader_path) {
                    Ok(raw) => {
                        assert!(parse_state_json(&raw, 1_776_000_060_000).is_some());
                        reads += 1;
                    }
                    Err(e) => panic!("native reader failed: {e}"),
                }
                std::thread::yield_now();
            }
            assert!(reads > 0);
        });
        for worker in workers {
            worker.join().unwrap();
        }
        reader.join().unwrap();
        let final_snapshot = read_from_path(&path, 1_776_000_060_000);
        assert_eq!(final_snapshot.status, "ok");
        assert!([0.37, 0.62].contains(&final_snapshot.windows[0].used));
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
