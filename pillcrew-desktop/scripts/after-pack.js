"use strict";

// electron-builder afterPack hook.
//
// On Linux, electron-builder ships a default AppRun launcher that executes the
// Electron binary without any arguments. An AppImage is a FUSE mount, which is
// mounted nosuid, so Electron's chrome-sandbox SUID helper can never work
// inside it. On Ubuntu 23.10+/24.04 unprivileged user namespaces are blocked
// by AppArmor, so the only reliable way for the AppImage to launch is to pass
// --no-sandbox on the real process command line.
//
// electron-builder's own AppRun generator (app-builder) writes its AppRun into
// the staging directory and then hard-links/copies the packed app dir over it,
// so a file named `AppRun` placed in the app dir wins. We therefore drop a
// patched AppRun here so it is baked into the squashfs of every Linux build.
//
// The deb target packs the same app dir, so it also ships this file at
// /opt/Pilly/AppRun - it is harmless there because the deb launches Pilly via
// the /usr/bin/pilly-desktop symlink, not via AppRun.

const fs = require("fs");
const path = require("path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "linux") {
    return;
  }

  const source = path.join(__dirname, "AppRun.sh");
  const destination = path.join(context.appOutDir, "AppRun");
  await fs.promises.copyFile(source, destination);
  await fs.promises.chmod(destination, 0o755);
};
