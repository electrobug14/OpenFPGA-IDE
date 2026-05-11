// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use openfpga_ide_lib::{discover_tools_impl, list_dir_impl, read_file_impl, run_command_impl, save_file_impl, create_temp_dir_impl, RunResult, ToolInfo};
use std::collections::HashMap;

#[tauri::command]
fn discover_tools() -> HashMap<String, ToolInfo> {
    discover_tools_impl()
}

#[tauri::command]
fn run_command(
    tool_path: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> RunResult {
    run_command_impl(tool_path, args, cwd)
}

#[tauri::command]
fn save_file(path: String, content: String) -> Result<(), String> {
    save_file_impl(path, content)
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    read_file_impl(path)
}

#[tauri::command]
fn create_temp_dir() -> Result<String, String> {
    create_temp_dir_impl()
}

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<String>, String> {
    list_dir_impl(path)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            discover_tools,
            run_command,
            save_file,
            read_file,
            create_temp_dir,
            list_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
