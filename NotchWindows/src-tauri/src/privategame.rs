//! Private games (Flight Economy). After the license server accepts an access code, the game's page is saved in the app's own
//! folder and opened in a window of its own. The page is an ordinary web page: the window has no capability, so it cannot reach
//! the app or the PC through Notch Apple. Only the page for a game this app knows (a short lower-case id) can be saved or opened.

use std::path::PathBuf;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// The game checks a public GitHub file for newer versions; inside the notch it never talks to GitHub (the server sends updates).
const NO_UPDATE_CHECK: &str = "(function(){var f=window.fetch;window.fetch=function(u){if(String(u).indexOf('raw.githubusercontent.com')>=0){return Promise.reject(new Error('offline'))}return f.apply(this,arguments)}})();";

fn path_of(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || id.len() > 40 || !id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
        return Err("Unknown game.".into());
    }
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("games");
    Ok(dir.join(format!("{id}.html")))
}

/// Saves the game's page (sent by the license server) in the app's folder.
#[tauri::command]
pub async fn private_game_save(app: AppHandle, id: String, html: String) -> Result<(), String> {
    if html.len() > 5 * 1024 * 1024 || !html.to_ascii_lowercase().contains("<html") {
        return Err("That isn't a game page.".into());
    }
    let p = path_of(&app, &id)?;
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&p, html).map_err(|e| format!("Couldn't save the game: {e}"))
}

/// Opens the saved game in its own window (or brings it forward if it is already open).
#[tauri::command]
pub async fn private_game_open(app: AppHandle, id: String, name: String) -> Result<(), String> {
    let p = path_of(&app, &id)?;
    if !p.exists() {
        return Err("The game isn't saved on this PC. Enter your access code again.".into());
    }
    let label = format!("game-{id}");
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        return Ok(());
    }
    let url = tauri::Url::from_file_path(&p).map_err(|_| "Couldn't open the game.".to_string())?;
    WebviewWindowBuilder::new(&app, label, WebviewUrl::External(url))
        .title(name.chars().take(60).collect::<String>())
        .inner_size(1180.0, 780.0)
        .min_inner_size(640.0, 460.0)
        .initialization_script(NO_UPDATE_CHECK)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Closes the game's window and deletes the saved page (its access code was cancelled, or the person locked it again).
#[tauri::command]
pub async fn private_game_remove(app: AppHandle, id: String) -> Result<(), String> {
    let p = path_of(&app, &id)?;
    if let Some(w) = app.get_webview_window(&format!("game-{id}")) {
        let _ = w.close();
    }
    let _ = std::fs::remove_file(p);
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_update_check_script_blocks_only_github() {
        assert!(super::NO_UPDATE_CHECK.contains("raw.githubusercontent.com"));
        assert!(super::NO_UPDATE_CHECK.contains("return f.apply(this,arguments)"));
    }
}
