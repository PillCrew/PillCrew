// src/macmenu.js - the macOS application menu template (v1.1.2).
//
// Pure data, no Electron, because macOS is the one platform the tests cannot
// boot. Electron accepts an unknown role *silently* - the item keeps an empty
// label and does nothing when clicked - so a typo in a role would ship as a dead
// entry in the menu bar with no error anywhere to catch it (verified against
// Electron 31.7.7: `buildFromTemplate([{ role: "bogusRole" }])` builds an item
// with `label === ""`). Keeping the template here means src/macmenu.test.js can
// validate every role and the shape of the menu on any platform, and the boot
// gate adds the same check inside Electron.

// Roles macOS accepts in this menu. Kept explicit on purpose: Electron takes an
// unrecognised role without complaining, so a typo here would be a menu item
// that silently does nothing - on the one platform that cannot be smoke-tested
// from Windows or Linux.
const ALLOWED_ROLES = new Set([
  "about", "hide", "hideOthers", "unhide", "quit",
  "undo", "redo", "cut", "copy", "paste", "selectAll", "pasteAndMatchStyle",
  "minimize", "zoom", "close", "front",
]);

// Roles Electron offers but a shipping app must not put in front of a user:
// Reload / Force Reload / Toggle DevTools can strand the chat renderer in a
// half-loaded state (and the shortcut for it is muscle memory).
const DEV_ROLES = new Set(["reload", "forceReload", "toggleDevTools", "resetZoom", "zoomIn", "zoomOut"]);

function macAppMenuTemplate(actions) {
  const a = actions || {};
  return [
    {
      label: a.appName || "Pilly",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      // The tray menu is the real control surface; this is the menu bar twin of
      // its two most-used entries so the menu bar is not just the standard three.
      // Not labelled "Pilly" - that name is already the app menu at the far left,
      // and two menus with the same title read as a bug.
      label: "Pet",
      submenu: [
        { label: "Open chat", click: a.openChat },
        { label: "Reset window position", click: a.resetWindowPosition },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "close" },   // the chat window hides on close, so Cmd+W hides it
        { role: "front" },
      ],
    },
  ];
}

// macOS labels the first menu in the bar with whatever we hand it, and Electron
// falls back to "Electron" whenever it cannot see the app's package.json (running
// a script directly, for instance). A menu bar that reads "Electron" on somebody's
// machine is exactly the sort of detail that makes an app look unfinished, so the
// name is taken from the package and never from the toolkit.
function menuAppName(pkg) {
  const name = pkg && (pkg.productName || pkg.name);
  if (typeof name === "string" && name.trim() && name.trim() !== "Electron") return name.trim();
  return "Pilly";
}

// Flattened view for checking: every item that is not a separator.
function menuItems(template) {
  const out = [];
  const walk = (items, menuLabel) => {
    for (const it of items || []) {
      if (it && it.type === "separator") continue;
      out.push({ ...it, menu: menuLabel });
      if (it && it.submenu) walk(it.submenu, it.label || menuLabel);
    }
  };
  for (const m of template || []) walk(m.submenu, m.label);
  return out;
}

module.exports = { macAppMenuTemplate, menuItems, menuAppName, ALLOWED_ROLES, DEV_ROLES };
