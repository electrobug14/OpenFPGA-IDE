#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  OpenFPGA IDE — Linux build script
#  Builds a .deb and .AppImage installer from source
# ─────────────────────────────────────────────────────────────────────────────
set -e
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║    OpenFPGA IDE — Build Script       ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── 1. Check / install Rust ──────────────────────────────────────────────────
if ! command -v rustc &>/dev/null; then
  info "Rust not found. Installing via rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path
  source "$HOME/.cargo/env"
  ok "Rust installed: $(rustc --version)"
else
  ok "Rust found: $(rustc --version)"
fi
export PATH="$HOME/.cargo/bin:$PATH"

# ── 2. Check / install Node.js ───────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  error "Node.js not found. Install Node.js >= 18 from https://nodejs.org and re-run."
fi
ok "Node.js found: $(node --version)"

if ! command -v npm &>/dev/null; then
  error "npm not found. Please install npm."
fi
ok "npm found: $(npm --version)"

# ── 3. Install system deps (Tauri requirements) ───────────────────────────────
info "Checking system dependencies..."
DEPS_APT="libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev"
DEPS_DNF="webkit2gtk4.1-devel openssl-devel gtk3-devel librsvg2-devel"

if command -v apt-get &>/dev/null; then
  info "Detected apt (Debian/Ubuntu). Installing deps..."
  sudo apt-get update -qq
  sudo apt-get install -y $DEPS_APT 2>/dev/null || warn "Some deps may have failed. Continuing..."
elif command -v dnf &>/dev/null; then
  info "Detected dnf (Fedora/RHEL). Installing deps..."
  sudo dnf install -y $DEPS_DNF 2>/dev/null || warn "Some deps may have failed. Continuing..."
elif command -v pacman &>/dev/null; then
  info "Detected pacman (Arch). Installing deps..."
  sudo pacman -S --needed --noconfirm webkit2gtk-4.1 gtk3 openssl librsvg 2>/dev/null || warn "Some deps may have failed."
else
  warn "Unknown distro. Make sure WebKit2GTK and GTK3 dev libraries are installed."
fi

# ── 4. Generate placeholder icons (requires ImageMagick or skip) ─────────────
info "Generating app icons..."
mkdir -p src-tauri/icons
if command -v convert &>/dev/null; then
  convert -size 128x128 xc:"#00d4aa" -fill "#0d0f14" -draw "text 20,70 'FPGA'" \
    src-tauri/icons/128x128.png 2>/dev/null || true
  convert src-tauri/icons/128x128.png -resize 32x32 src-tauri/icons/32x32.png 2>/dev/null || true
  convert src-tauri/icons/128x128.png src-tauri/icons/128x128@2x.png 2>/dev/null || true
  # .ico for Windows cross-build
  cp src-tauri/icons/32x32.png src-tauri/icons/icon.ico 2>/dev/null || true
  cp src-tauri/icons/128x128.png src-tauri/icons/icon.icns 2>/dev/null || true
  ok "Icons generated."
else
  # Minimal 1x1 PNG fallback so build doesn't fail
  python3 -c "
import base64, os
# Minimal 32x32 green PNG
png_b64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAHklEQVRYw+3BMQEAAADCoPVP7WsIoAAAAAAAAAAAeAMBxAAB3gAAAABJRU5ErkJggg=='
data = base64.b64decode(png_b64)
for f in ['32x32.png','128x128.png','128x128@2x.png','icon.ico','icon.icns']:
    open(f'src-tauri/icons/{f}','wb').write(data)
print('Placeholder icons written.')
" 2>/dev/null || warn "Could not generate icons. Build may fail."
fi

# ── 5. Install npm dependencies ───────────────────────────────────────────────
info "Installing npm dependencies..."
npm install
ok "npm install complete."

# ── 6. Install Tauri CLI ──────────────────────────────────────────────────────
info "Installing @tauri-apps/cli..."
npm install @tauri-apps/cli@latest --save-dev
ok "Tauri CLI ready."

# ── 7. Build ─────────────────────────────────────────────────────────────────
info "Building OpenFPGA IDE (this may take 5-15 min on first run)..."
npm run tauri build

# ── 8. Report output ─────────────────────────────────────────────────────────
echo ""
ok "Build complete! Installers:"
echo ""
find src-tauri/target/release/bundle -type f \( -name "*.deb" -o -name "*.AppImage" -o -name "*.rpm" \) 2>/dev/null | while read f; do
  size=$(du -sh "$f" | cut -f1)
  echo -e "  ${GREEN}▸${NC} $f  (${size})"
done
echo ""
info "To install the .deb:  sudo dpkg -i src-tauri/target/release/bundle/deb/*.deb"
info "To run AppImage:      chmod +x *.AppImage && ./*.AppImage"
echo ""
