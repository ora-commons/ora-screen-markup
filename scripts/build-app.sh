#!/bin/bash
# Builds Ora Screen Markup and, with --install, puts the finished app in
# /Applications.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

APP_NAME="Ora Screen Markup"
BUNDLE_ID="com.golfplan18.orascreenmarkup"
DIST="$root/dist"
APP="$DIST/$APP_NAME.app"
SIGN_IDENTITY="${ORA_SCREEN_MARKUP_SIGN_IDENTITY:-Ora Screen Markup Local Signing}"

# Screen Recording grants follow the signer's identity across app updates.
# An ad hoc signature identifies only one build, so never install one.
if [ "$SIGN_IDENTITY" != "-" ] && security find-identity -v -p codesigning | awk -v wanted="$SIGN_IDENTITY" '
  $2 == toupper(wanted) { found = 1 }
  index($0, "\"") {
    name = substr($0, index($0, "\"") + 1)
    sub(/\".*$/, "", name)
    if (name == wanted) { found = 1 }
  }
  END { exit !found }
'; then
  echo "==> Using signing identity: $SIGN_IDENTITY"
elif [ "${1:-}" = "--install" ]; then
  echo "Installation needs a stable code-signing identity in Keychain: $SIGN_IDENTITY" >&2
  echo "Create a Code Signing identity with that name, or set ORA_SCREEN_MARKUP_SIGN_IDENTITY to an existing identity's full name or SHA-1 fingerprint." >&2
  exit 1
else
  echo "Warning: no stable signing identity was found; this build uses an ad hoc signature and must not replace the installed app." >&2
  SIGN_IDENTITY="-"
fi

echo "==> Installing the pinned editor packages"
(cd "$root/web" && npm ci)

echo "==> Building the editor"
(cd "$root/web" && node build.mjs)

echo "==> Building the app"
swift build -c release --product OraScreenMarkup
BINARY="$(swift build -c release --show-bin-path)/OraScreenMarkup"

echo "==> Packaging $APP_NAME.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BINARY" "$APP/Contents/MacOS/$APP_NAME"
cp -R "$root/web/dist/." "$APP/Contents/Resources/"
cp "$root/resources/OraScreenMarkup.icns" "$APP/Contents/Resources/"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleExecutable</key><string>$APP_NAME</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleIconFile</key><string>OraScreenMarkup.icns</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

echo "==> Signing for this Mac"
codesign --force --sign "$SIGN_IDENTITY" "$APP"
codesign --verify --deep --strict "$APP"

if [ "${1:-}" = "--install" ]; then
  DEST="/Applications/$APP_NAME.app"
  RETAINED="$DIST/$APP_NAME (previous).app"
  echo "==> Installing into /Applications"
  if [ -d "$DEST" ]; then
    # Keep the installed version aside until the replacement has been
    # verified, so it can be put back if anything fails.
    rm -rf "$RETAINED"
    mv "$DEST" "$RETAINED"
  fi
  if ! /usr/bin/ditto "$APP" "$DEST" || ! codesign --verify --deep --strict "$DEST"; then
    echo "Installation failed; restoring the previous version" >&2
    rm -rf "$DEST"
    if [ -d "$RETAINED" ]; then
      mv "$RETAINED" "$DEST"
    fi
    exit 1
  fi
  echo "Installed $DEST"
fi

echo "==> Built $APP"
