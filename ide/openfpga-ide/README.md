# OpenFPGA IDE

A native desktop EDA IDE built with **Tauri (Rust) + React**.  
Auto-discovers your installed open-source FPGA/ASIC tools and runs them natively.

## What it does

- **Auto-discovers** iverilog, yosys, nextpnr, icepack, iceprog, verilator, gtkwave from your PATH and common install locations
- **Runs them for real** — no simulation, actual tool invocation with live stdout/stderr in the terminal panel
- **Settings panel** — browse/override any tool path manually
- Syntax-highlighted Verilog editor, waveform viewer, RTL schematic, multi-file project

---

## Building the installer

### Linux (Ubuntu / Debian / Fedora / Arch)

```bash
cd openfpga-ide
chmod +x build_linux.sh
./build_linux.sh
```

Produces:
- `src-tauri/target/release/bundle/deb/openfpga-ide_1.0.0_amd64.deb`
- `src-tauri/target/release/bundle/appimage/openfpga-ide_1.0.0_amd64.AppImage`

Install:
```bash
sudo dpkg -i src-tauri/target/release/bundle/deb/*.deb
# or
chmod +x *.AppImage && ./OpenFPGA-IDE*.AppImage
```

---

### Windows (PowerShell)

```powershell
cd openfpga-ide
powershell -ExecutionPolicy Bypass -File build_windows.ps1
```

**Prerequisites** (script will check and guide you):
- Node.js 18+ — https://nodejs.org
- Rust — https://rustup.rs (script auto-installs)
- Visual C++ Build Tools — https://visualstudio.microsoft.com/visual-cpp-build-tools/
  - Workload: "Desktop development with C++"
  - Include: Windows 10/11 SDK

Produces:
- `src-tauri\target\release\bundle\msi\OpenFPGA IDE_1.0.0_x64_en-US.msi`
- `src-tauri\target\release\bundle\nsis\OpenFPGA IDE_1.0.0_x64-setup.exe`

---

## Tool auto-discovery paths

The Rust backend searches (in order):
1. Your system `PATH`
2. Common install locations:
   - `/opt/oss-cad-suite/bin`
   - `/usr/local/bin`, `/usr/bin`
   - `~/.apio/packages/tools-oss-cad-suite/bin`
   - `C:\oss-cad-suite\bin` (Windows)
   - `C:\iverilog\bin` (Windows)
   - `C:\msys64\usr\bin` (Windows/MSYS2)

If a tool is in a non-standard location, use **⚙ Tools → Browse** to set its path manually. Paths are persisted.

## Supported tools

| Tool | Purpose |
|------|---------|
| iverilog | Verilog compilation |
| vvp | Simulation runner |
| yosys | Logic synthesis |
| nextpnr-ice40 | Place & Route (iCE40) |
| nextpnr-ecp5 | Place & Route (ECP5) |
| icepack | Bitstream packing |
| iceprog | Device programming |
| verilator | Linting / fast sim |
| gtkwave | Waveform viewing |
| openocd | JTAG programming |

## Requirements (runtime)

Just the app `.deb`/`.AppImage`/`.msi` — no extra runtime needed.  
The EDA tools must already be installed on your machine (they are not bundled).
