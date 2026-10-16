#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use codenotch_gemini_experimental::isolation::{InstanceGuard, Paths, APP_ID, APP_NAME};
use tauri::{WebviewUrl, WebviewWindowBuilder};

fn main() {
    if std::env::args_os().len()!=1 { eprintln!("gemini_experimental_unsupported_argument"); std::process::exit(1); }
    if start().is_err() { eprintln!("gemini_experimental_start_failed"); std::process::exit(1); }
}
fn start() -> Result<(), Box<dyn std::error::Error>> {
    // No CLI command, account adapter, plugin updater, hooks, HTTP or native host.
    let base=dirs::data_local_dir();
    let paths=Paths::prepare(base.as_deref())?;
    let _instance=InstanceGuard::acquire(&paths)?;
    // Process-only overrides, before UI threads: no system/user environment changes.
    std::env::set_var("TEMP", paths.temp());
    std::env::set_var("TMP", paths.temp());
    std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", paths.webview2());
    std::env::remove_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS");
    let context=tauri::generate_context!("tauri.conf.json");
    if context.config().identifier!=APP_ID { return Err(codenotch_gemini_experimental::Error::Directory.into()); }
    tauri::Builder::default()
        .setup(move |app| {
            paths.verify()?;
            WebviewWindowBuilder::new(app,"gemini-experimental",WebviewUrl::App("index.html".into()))
                .title(APP_NAME)
                .data_directory(paths.webview2())
                .on_navigation(|url| url.port().is_none() && ((url.scheme()=="tauri" && url.host_str()==Some("localhost")) || (url.scheme()=="http" && url.host_str()==Some("tauri.localhost"))))
                .build()?;
            Ok(())
        })
        .run(context)?;
    Ok(())
}
