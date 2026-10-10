# Maintainer: Lou <lou@example.com>
# Contributor: Yunfei Chen <alchaincyf@gmail.com>
# PKGBUILD for FanBox — local file browser/previewer with embedded coding agent terminal.

pkgname=fanbox
pkgver=1.8.3
pkgrel=1
pkgdesc="FanBox — the cockpit for vibe coding. Browse/search/preview/edit local files, command coding agents from the built-in terminal."
arch=('x86_64')
url="https://fanbox.vercel.app"
license=('MIT')
depends=(
  'electron42'
  'nodejs'
  'npm'
  'imagemagick'
  'xclip'
  'xdg-utils'
)
optdepends=(
  'wl-clipboard: clipboard support on Wayland'
  'ffmpegthumbnailer: video thumbnails'
  'ffmpeg: video thumbnails'
  'baloo: KDE file content search'
  'tracker3: GNOME file content search'
  'libvips: faster image thumbnails'
  'mupdf-tools: PDF thumbnails'
  'konsole: open terminal in current directory'
  'gnome-terminal: open terminal in current directory'
)
makedepends=(
  'npm'
  'make'
  'gcc'
  'python'
  'rsync'
)
source=()
sha256sums=()

prepare() {
  # Copy project files to srcdir (excluding makepkg's own dirs and build artifacts)
  mkdir -p "$srcdir"
  rsync -a --exclude='src/' --exclude='pkg/' --exclude='dist/' \
    --exclude='node_modules/' --exclude='.git/' --exclude='*.log' \
    --exclude='experiments/' --exclude='素材/' --exclude='design-demos/' \
    "$BUILDDIR/" "$srcdir/"
}

build() {
  cd "$srcdir"

  # Skip downloading Electron's own binary (~200MB); we use system electron42.
  export ELECTRON_SKIP_BINARY_DOWNLOAD=1

  # --- Tell node-gyp to build native modules for Electron 42, not Node.js ---
  # node-pty runs its 'install.js' (node-gyp rebuild) during npm install.
  # If we don't set these, it downloads Node.js 26 headers and compiles for
  # the wrong ABI, causing a segfault at runtime inside Electron 42.
  export npm_config_target=42.3.0
  export npm_config_runtime=electron
  export npm_config_disturl=https://electronjs.org/headers
  export npm_config_arch=x64

  # --- Strip SSH git deps from lockfile ---
  # package-lock.json pins electron/node-gyp via git+ssh://git@github.com/.
  # That would hang waiting for a password if no SSH key is configured.
  # Removing the lockfile lets npm resolve all deps via HTTPS from the registry.
  rm -f package-lock.json

  # Install all dependencies (incl. devDeps for @electron/rebuild).
  # npm_config_target/runtime/disturl above tell node-gyp to compile
  # native modules (node-pty) for Electron 42 ABI during install.
  # @electron/rebuild is NOT needed — the initial install already
  # produces the correct binary.
  npm install --no-audit --no-fund

  # Strip devDependencies: only keep runtime deps (node-pty + its deps)
  npm prune --production
}

package() {
  cd "$srcdir"

  local dest="$pkgdir/opt/fanbox"

  # ---- App files ----
  install -d "$dest"
  cp -a electron public build server.js index.html package.json "$dest/"
  cp -a node_modules "$dest/"

  # Clean up any leftover build artifacts that aren't needed
  rm -rf "$dest/node_modules/.cache" 2>/dev/null || true

  # ---- Wrapper script ----
  install -d "$pkgdir/usr/bin"
  cat > "$pkgdir/usr/bin/fanbox" << 'WRAPPER'
#!/bin/bash
# FanBox launcher — uses system Electron 42.
exec /usr/lib/electron42/electron /opt/fanbox/electron/main.js "$@"
WRAPPER
  chmod 755 "$pkgdir/usr/bin/fanbox"

  # ---- Desktop entry ----
  install -d "$pkgdir/usr/share/applications"
  cat > "$pkgdir/usr/share/applications/fanbox.desktop" << DESKTOP
[Desktop Entry]
Name=FanBox 翻箱
Comment=FanBox — the cockpit for vibe coding
GenericName=File Browser & Coding Agent Terminal
Exec=/usr/bin/fanbox %F
Icon=fanbox
Terminal=false
Type=Application
Categories=Development;Utility;
StartupWMClass=fanbox
MimeType=text/plain;
DESKTOP

  # ---- Icon ----
  local icondir="$pkgdir/usr/share/icons/hicolor/512x512/apps"
  install -d "$icondir"
  install -m644 build/icon.png "$icondir/fanbox.png"
  # Symlink for pixmaps fallback
  install -d "$pkgdir/usr/share/pixmaps"
  ln -s "../icons/hicolor/512x512/apps/fanbox.png" "$pkgdir/usr/share/pixmaps/fanbox.png"
}
