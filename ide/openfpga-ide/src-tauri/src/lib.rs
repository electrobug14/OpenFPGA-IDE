use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Command, Stdio};

// ─── Tool Discovery ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolInfo {
    pub name: String,
    pub path: Option<String>,
    pub version: Option<String>,
    pub found: bool,
}

/// All candidate paths to search per OS
fn candidate_paths(binary: &str) -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = Vec::new();

    // 1. PATH resolution (most reliable)
    if let Ok(p) = which::which(binary) {
        paths.push(p);
    }

    // 2. Common install prefixes — Linux
    #[cfg(target_os = "linux")]
    {
        let prefixes = [
            "/usr/bin",
            "/usr/local/bin",
            "/opt/oss-cad-suite/bin",
            "/opt/apio/packages/tools-oss-cad-suite/bin",
            "/opt/apio/bin",
            "/snap/bin",
            "/home/linuxbrew/.linuxbrew/bin",
            "/usr/share/verilator/bin",
            "/opt/yosys/bin",
            "/opt/iverilog/bin",
        ];
        for prefix in prefixes {
            paths.push(PathBuf::from(prefix).join(binary));
        }
        // ~/.local/bin
        if let Ok(home) = std::env::var("HOME") {
            paths.push(PathBuf::from(&home).join(".local/bin").join(binary));
            paths.push(PathBuf::from(&home).join(".apio/packages/tools-oss-cad-suite/bin").join(binary));
        }
    }

    // 3. Common install prefixes — Windows
    #[cfg(target_os = "windows")]
    {
        let binary_exe = format!("{}.exe", binary);
        let prefixes = [
            r"C:\iverilog\bin",
            r"C:\Program Files\iverilog\bin",
            r"C:\oss-cad-suite\bin",
            r"C:\tools\msys64\usr\bin",
            r"C:\tools\msys64\mingw64\bin",
            r"C:\msys64\usr\bin",
            r"C:\msys64\mingw64\bin",
            r"C:\ProgramData\chocolatey\bin",
            r"C:\Users\Public\oss-cad-suite\bin",
        ];
        for prefix in prefixes {
            paths.push(PathBuf::from(prefix).join(&binary_exe));
        }
        // USERPROFILE based
        if let Ok(up) = std::env::var("USERPROFILE") {
            paths.push(PathBuf::from(&up).join("oss-cad-suite\\bin").join(&binary_exe));
            paths.push(PathBuf::from(&up).join(".apio\\packages\\tools-oss-cad-suite\\bin").join(&binary_exe));
            paths.push(PathBuf::from(&up).join("AppData\\Local\\Programs\\iverilog\\bin").join(&binary_exe));
        }
    }

    // 4. macOS common paths
    #[cfg(target_os = "macos")]
    {
        let prefixes = [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/opt/oss-cad-suite/bin",
        ];
        for prefix in prefixes {
            paths.push(PathBuf::from(prefix).join(binary));
        }
    }

    // Deduplicate
    let mut seen = std::collections::HashSet::new();
    paths.retain(|p| seen.insert(p.clone()));
    paths
}

fn get_version(path: &str, version_arg: &str) -> Option<String> {
    Command::new(path)
        .arg(version_arg)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .ok()
        .map(|o| {
            let out = String::from_utf8_lossy(&o.stdout).to_string()
                + &String::from_utf8_lossy(&o.stderr).to_string();
            out.lines().next().unwrap_or("").trim().to_string()
        })
        .filter(|s| !s.is_empty())
}

fn discover_tool(binary: &str, version_flag: &str) -> ToolInfo {
    let candidates = candidate_paths(binary);
    for candidate in &candidates {
        if candidate.exists() && candidate.is_file() {
            let path_str = candidate.to_string_lossy().to_string();
            let version = get_version(&path_str, version_flag);
            return ToolInfo {
                name: binary.to_string(),
                path: Some(path_str),
                version,
                found: true,
            };
        }
    }
    ToolInfo {
        name: binary.to_string(),
        path: None,
        version: None,
        found: false,
    }
}

// ─── Tauri command helpers ───────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct RunResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub success: bool,
}

pub fn discover_tools_impl() -> HashMap<String, ToolInfo> {
    let tool_defs = vec![
        ("iverilog",  "--version"),
        ("vvp",       "--version"),
        ("yosys",     "--version"),
        ("nextpnr-ice40", "--version"),
        ("nextpnr-ecp5",  "--version"),
        ("nextpnr-nexus", "--version"),
        ("icepack",   "--version"),
        ("iceprog",   "--version"),
        ("verilator",  "--version"),
        ("gtkwave",    "--version"),
        ("openocd",    "--version"),
        ("tinyprog",   "--version"),
        ("ecppack",    "--version"),
    ];

    let mut results = HashMap::new();
    for (name, flag) in tool_defs {
        results.insert(name.to_string(), discover_tool(name, flag));
    }
    results
}

pub fn run_command_impl(
    tool_path: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> RunResult {
    let mut cmd = Command::new(&tool_path);
    cmd.args(&args);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    match cmd.output() {
        Ok(output) => RunResult {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code().unwrap_or(-1),
            success: output.status.success(),
        },
        Err(e) => RunResult {
            stdout: String::new(),
            stderr: format!("Failed to run '{}': {}", tool_path, e),
            exit_code: -1,
            success: false,
        },
    }
}

pub fn save_file_impl(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

pub fn read_file_impl(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

pub fn create_temp_dir_impl() -> Result<String, String> {
    let tmp = std::env::temp_dir().join(format!("openfpga_{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs()));
    std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    Ok(tmp.to_string_lossy().to_string())
}

pub fn list_dir_impl(path: String) -> Result<Vec<String>, String> {
    let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    let names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    Ok(names)
}
