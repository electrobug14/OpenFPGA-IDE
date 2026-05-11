# ─────────────────────────────────────────────────────────────────────────────
#  OpenFPGA IDE — Windows Build Script (PowerShell)
#  Run as:  powershell -ExecutionPolicy Bypass -File build_windows.ps1
# ─────────────────────────────────────────────────────────────────────────────
$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "OpenFPGA IDE Builder"

function Info  { Write-Host "[INFO]  $args" -ForegroundColor Cyan }
function Ok    { Write-Host "[OK]    $args" -ForegroundColor Green }
function Warn  { Write-Host "[WARN]  $args" -ForegroundColor Yellow }
function Err   { Write-Host "[ERROR] $args" -ForegroundColor Red; Exit 1 }

Write-Host ""
Write-Host "  ╔══════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║    OpenFPGA IDE — Windows Builder    ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

Set-Location $PSScriptRoot

# ── 1. Check Rust ────────────────────────────────────────────────────────────
try { $rv = & rustc --version 2>&1; Ok "Rust: $rv" }
catch {
  Info "Rust not found. Downloading rustup-init.exe..."
  $rustup = "$env:TEMP\rustup-init.exe"
  Invoke-WebRequest "https://win.rustup.rs/x86_64" -OutFile $rustup
  & $rustup -y --no-modify-path
  $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
  Ok "Rust installed."
}
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"

# ── 2. Check Node ─────────────────────────────────────────────────────────────
try { $nv = & node --version 2>&1; Ok "Node.js: $nv" }
catch { Err "Node.js not found. Install from https://nodejs.org (LTS) and re-run." }

try { $npmv = & npm --version 2>&1; Ok "npm: $npmv" }
catch { Err "npm not found." }

# ── 3. Windows Build Tools check ─────────────────────────────────────────────
Info "Checking for Visual C++ Build Tools..."
$vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vsWhere) {
  Ok "Visual Studio / Build Tools detected."
} else {
  Warn "Visual C++ Build Tools not detected."
  Warn "If build fails, install from: https://visualstudio.microsoft.com/visual-cpp-build-tools/"
  Warn "Select: C++ build tools + Windows 10/11 SDK"
}

# ── 4. WebView2 check ────────────────────────────────────────────────────────
Info "Checking WebView2 runtime..."
$wv2 = Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue
if ($wv2) { Ok "WebView2 found: $($wv2.pv)" }
else {
  Warn "WebView2 not found. Downloading bootstrapper..."
  $wv2Bootstrap = "$env:TEMP\MicrosoftEdgeWebview2Setup.exe"
  Invoke-WebRequest "https://go.microsoft.com/fwlink/p/?LinkId=2124703" -OutFile $wv2Bootstrap
  & $wv2Bootstrap /silent /install
  Ok "WebView2 installed."
}

# ── 5. Generate placeholder icons ────────────────────────────────────────────
Info "Generating icons..."
New-Item -ItemType Directory -Force -Path "src-tauri\icons" | Out-Null
# Minimal valid PNG bytes (1x1 teal pixel)
$pngB64 = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAHklEQVRYw+3BMQEAAADCoPVP7WsIoAAAAAAAAAAAeAMBxAAB3gAAAABJRU5ErkJggg=="
$pngBytes = [Convert]::FromBase64String($pngB64)
foreach ($f in @("32x32.png","128x128.png","128x128@2x.png","icon.ico","icon.icns")) {
  [IO.File]::WriteAllBytes("$PSScriptRoot\src-tauri\icons\$f", $pngBytes)
}
Ok "Icons ready."

# ── 6. npm install ───────────────────────────────────────────────────────────
Info "Installing npm dependencies..."
& npm install
if ($LASTEXITCODE -ne 0) { Err "npm install failed." }
Ok "npm install complete."

Info "Installing Tauri CLI..."
& npm install @tauri-apps/cli@latest --save-dev
Ok "Tauri CLI ready."

# ── 7. Build ─────────────────────────────────────────────────────────────────
Info "Building OpenFPGA IDE (first build: 5-15 min)..."
& npm run tauri build
if ($LASTEXITCODE -ne 0) { Err "Build failed. Check output above." }

# ── 8. Report ────────────────────────────────────────────────────────────────
Write-Host ""
Ok "Build complete! Installers:"
Write-Host ""
Get-ChildItem -Recurse "src-tauri\target\release\bundle" -Include "*.msi","*.exe","*.nsis" -ErrorAction SilentlyContinue | ForEach-Object {
  $size = [math]::Round($_.Length / 1MB, 1)
  Write-Host "  > $($_.FullName)  (${size} MB)" -ForegroundColor Green
}
Write-Host ""
Info "Double-click the .msi or -setup.exe to install."
Write-Host ""
