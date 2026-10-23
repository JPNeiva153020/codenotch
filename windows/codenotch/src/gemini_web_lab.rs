//! Opt-in local laboratory. This startup does not initialize the regular application.
use crate::{gemini_lab_profile as profile, gemini_web, AppState};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const CONTROL: &str = "gemini_lab_control";
const PAGE: &str = "/experimental/gemini-web-lab.html";
static SMOKE: AtomicBool = AtomicBool::new(false);
static WATCHER_STARTED: AtomicBool = AtomicBool::new(false);

fn control_origin(url: &tauri::Url) -> bool {
    url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && ((url.scheme() == "tauri" && url.host_str() == Some("localhost"))
            || (matches!(url.scheme(), "http" | "https")
                && url.host_str() == Some("tauri.localhost")))
}

fn accepts_control(label: &str, url: &tauri::Url, lab_active: bool) -> bool {
    lab_active
        && label == CONTROL
        && url.path() == PAGE
        && control_origin(url)
        && url.query().is_none()
        && url.fragment().is_none()
}

fn authorized(window: &WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|_| "control unavailable")?;
    if accepts_control(window.label(), &url, profile::is_lab()) {
        Ok(())
    } else {
        Err("experimental command rejected".into())
    }
}

#[tauri::command]
fn lab_status(window: WebviewWindow) -> Result<serde_json::Value, String> {
    authorized(&window)?;
    Ok(
        serde_json::json!({"mode":"experimental", "automatic":profile::automatic_allowed(),
        "snapshot":gemini_web::load_persisted()}),
    )
}

#[tauri::command]
fn lab_ready(window: WebviewWindow) -> Result<(), String> {
    authorized(&window)?;
    if SMOKE.load(Ordering::SeqCst) {
        let root = profile::root().ok_or("profile unavailable")?;
        let evidence = serde_json::json!({
            "local_ui_ready":true,
            "automatic":profile::automatic_allowed(),
            "identifier":window.app_handle().config().identifier.clone(),
            "config_isolated":crate::config::config_path()==root.join("config.json"),
            "state_isolated":gemini_web::state_path()==root.join("gemini-web-state.json"),
            "data_namespace_isolated":window.app_handle().path().app_data_dir().is_ok_and(|p|p.ends_with("com.codenotch.gemini-web-lab")),
            "quota_window_present":window.app_handle().get_webview_window("gemini_web_probe").is_some()
        });
        std::fs::write(root.join("smoke-ready"), evidence.to_string())
            .map_err(|_| "ready marker unavailable")?;
    }
    Ok(())
}

#[tauri::command]
fn lab_read(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    authorized(&window)?;
    gemini_web::force_manual_probe(&app);
    Ok(())
}

#[tauri::command]
fn lab_open_usage(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    authorized(&window)?;
    gemini_web::open_usage_window(&app);
    Ok(())
}

#[tauri::command]
fn lab_automatic(app: AppHandle, window: WebviewWindow, enabled: bool) -> Result<(), String> {
    authorized(&window)?;
    profile::set_automatic(enabled);
    if enabled {
        if !WATCHER_STARTED.swap(true, Ordering::SeqCst) {
            gemini_web::start(app);
        }
    } else {
        WATCHER_STARTED.store(false, Ordering::SeqCst);
        gemini_web::stop_probe(&app);
    }
    Ok(())
}

#[tauri::command]
fn lab_clear(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    authorized(&window)?;
    profile::set_automatic(false);
    WATCHER_STARTED.store(false, Ordering::SeqCst);
    gemini_web::stop_probe(&app);
    let path = gemini_web::state_path();
    if path.exists() {
        std::fs::remove_file(path).map_err(|_| "cannot clear observation")?;
    }
    Ok(())
}

#[tauri::command]
fn lab_exit(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    authorized(&window)?;
    shutdown_lab(&app);
    Ok(())
}

fn shutdown_lab(app: &AppHandle) {
    profile::set_automatic(false);
    gemini_web::stop_probe(app);
    for window in app.webview_windows().into_values() {
        let _ = window.destroy();
    }
    // Let native controller teardown drain before leaving the event loop.
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(250));
        handle.exit(0);
    });
}

fn empty_state() -> AppState {
    AppState {
        store: Mutex::new(Default::default()),
        cfg: Mutex::new(Default::default()),
        usage: Mutex::new(Default::default()),
        codex: Mutex::new(Default::default()),
        reset_alerts: Default::default(),
        cursor: Mutex::new(Default::default()),
        grok: Mutex::new(Default::default()),
        copilot: Mutex::new(Default::default()),
        antigravity: Mutex::new(Default::default()),
        gemini_web: Mutex::new(Default::default()),
        glm: Mutex::new(Default::default()),
        opencode: Mutex::new(Default::default()),
        glyphs: Mutex::new(Default::default()),
        activity: Mutex::new(Default::default()),
    }
}

pub fn run(args: &[String]) -> Result<(), String> {
    let smoke = args.get(1).is_some_and(|s| s == "--gemini-web-lab-smoke");
    if !smoke && args.get(1).map(String::as_str) != Some("--gemini-web-lab") {
        return Err("unsupported experimental mode".into());
    }
    if args.len() != 3 {
        return Err("experimental mode requires one dedicated profile directory".into());
    }
    profile::initialize(std::path::Path::new(&args[2]), smoke)?;
    SMOKE.store(smoke, Ordering::SeqCst);
    let root = profile::root().ok_or("profile unavailable")?;
    if crate::config::config_path() != root.join("config.json")
        || gemini_web::state_path() != root.join("gemini-web-state.json")
        || gemini_web::config_path().parent() != Some(root)
        || profile::automatic_allowed()
    {
        return Err("experimental isolation preflight failed".into());
    }
    let mut context = tauri::generate_context!();
    let config = context.config_mut();
    config.identifier = "com.codenotch.gemini-web-lab".into();
    config.product_name = Some("Codenotch Gemini Web Lab".into());
    config.app.windows.clear();
    config.app.with_global_tauri = true;
    config.app.security.csp=Some(tauri::utils::config::Csp::Policy(
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src ipc: http://ipc.localhost; img-src 'self' data:; object-src 'none'; frame-src 'none'".into()));
    let root = profile::root()
        .ok_or("experimental profile unavailable")?
        .to_path_buf();
    tauri::Builder::default()
        // Deliberately no updater, single-instance plugin, tray, server, hooks or other provider initialization.
        .manage(empty_state())
        .invoke_handler(tauri::generate_handler![
            lab_status,
            lab_ready,
            lab_read,
            lab_open_usage,
            lab_automatic,
            lab_clear,
            lab_exit
        ])
        .setup(move |app| {
            WebviewWindowBuilder::new(
                app,
                CONTROL,
                WebviewUrl::App("experimental/gemini-web-lab.html".into()),
            )
            .title("Gemini Web — laboratório isolado")
            .inner_size(560.0, 650.0)
            .visible(!smoke)
            .focused(false)
            .data_directory(root.join("control-webview"))
            .additional_browser_args("--disable-background-networking --disable-component-update")
            .on_navigation(|url| control_origin(url) && url.path() == PAGE)
            .build()?;
            if smoke {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(8));
                    let app = handle.clone();
                    let _ = handle.run_on_main_thread(move || shutdown_lab(&app));
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == CONTROL {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    shutdown_lab(window.app_handle());
                }
            }
        })
        .run(context)
        .map_err(|_| "experimental runtime failed".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn commands_accept_only_the_local_control_with_an_active_lab_profile() {
        let local =
            tauri::Url::parse("http://tauri.localhost/experimental/gemini-web-lab.html").unwrap();
        assert!(accepts_control(CONTROL, &local, true));
        assert!(!accepts_control(CONTROL, &local, false));
        assert!(!accepts_control("gemini_web_probe", &local, true));
        for raw in [
            "https://gemini.google.com/experimental/gemini-web-lab.html",
            "https://tauri.localhost.evil.invalid/experimental/gemini-web-lab.html",
            "http://tauri.localhost/notch.html",
            "http://tauri.localhost:9999/experimental/gemini-web-lab.html",
            "http://user:password@tauri.localhost/experimental/gemini-web-lab.html",
            "http://tauri.localhost/experimental/gemini-web-lab.html?untrusted=1",
            "http://tauri.localhost/experimental/gemini-web-lab.html#untrusted",
        ] {
            assert!(!accepts_control(
                CONTROL,
                &tauri::Url::parse(raw).unwrap(),
                true
            ));
        }
    }
}
