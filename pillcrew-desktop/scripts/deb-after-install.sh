#!/bin/bash

if type update-alternatives 2>/dev/null >&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

# Electron's SUID sandbox helper must be root-owned with mode 4755 so Pilly can
# start on systems that restrict unprivileged user namespaces (Ubuntu 23.10+ /
# 24.04). Chromium only falls back to the SUID sandbox when user namespaces are
# unavailable, so setting the setuid bit is safe everywhere. dpkg installs the
# helper as 0755, so fix it here (this postinst script runs as root).
chown root:root '/opt/${sanitizedProductName}/chrome-sandbox' 2>/dev/null || true
chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi
