const { test } = require("node:test");
const assert = require("node:assert");
const M = require("./macmenu");

test("macmenu: every role is one macOS actually accepts", () => {
  const items = M.menuItems(M.macAppMenuTemplate({ appName: "Pilly" }));
  for (const it of items) {
    if (it.role) assert.ok(M.ALLOWED_ROLES.has(it.role), `unknown role "${it.role}" in menu "${it.menu}"`);
  }
});

test("macmenu: no development items reach the user", () => {
  const items = M.menuItems(M.macAppMenuTemplate({ appName: "Pilly" }));
  for (const it of items) {
    assert.ok(!M.DEV_ROLES.has(it.role), `dev-only item "${it.role}" in the app menu`);
    assert.ok(!/devtools|reload/i.test(it.label || ""), `dev-only label "${it.label}"`);
  }
});

test("macmenu: the standard editing and lifecycle keys survive", () => {
  const items = M.menuItems(M.macAppMenuTemplate({ appName: "Pilly" }));
  const roles = new Set(items.map((i) => i.role));
  for (const r of ["about", "hide", "quit", "copy", "paste", "cut", "selectAll", "undo", "redo", "close", "minimize"]) {
    assert.ok(roles.has(r), `missing role "${r}"`);
  }
});

test("macmenu: the app menu carries the app's name, not the toolkit's", () => {
  const t = M.macAppMenuTemplate();
  assert.equal(t[0].label, "Pilly");
  assert.equal(t[0].submenu[0].role, "about");
  // app.name is "Electron" whenever Electron cannot read the app's package.json,
  // and macOS prints the menu label verbatim.
  assert.equal(M.menuAppName({ productName: "Pilly", name: "pilly-desktop" }), "Pilly");
  assert.equal(M.menuAppName({ name: "pilly-desktop" }), "pilly-desktop");
  assert.equal(M.menuAppName({ productName: "Electron" }), "Pilly");
  assert.equal(M.menuAppName(null), "Pilly");
  assert.equal(M.menuAppName({ productName: "  " }), "Pilly");
});

test("macmenu: no two menus share a title", () => {
  const t = M.macAppMenuTemplate({ appName: "Pilly" });
  const titles = t.map((m) => m.label);
  assert.equal(new Set(titles).size, titles.length, `duplicate menu titles: ${titles}`);
});

test("macmenu: the menu bar's own commands drive the real actions", () => {
  let chat = 0, reset = 0;
  const t = M.macAppMenuTemplate({
    appName: "Pilly",
    openChat: () => { chat++; },
    resetWindowPosition: () => { reset++; },
  });
  const items = M.menuItems(t);
  const open = items.find((i) => i.label === "Open chat");
  const resetItem = items.find((i) => i.label === "Reset window position");
  assert.ok(open && typeof open.click === "function");
  assert.ok(resetItem && typeof resetItem.click === "function");
  open.click(); resetItem.click();
  assert.equal(chat, 1);
  assert.equal(reset, 1);
});

test("macmenu: works without an actions object (no throw at startup)", () => {
  const t = M.macAppMenuTemplate();
  assert.equal(t[0].label, "Pilly");
  assert.equal(M.menuItems(t).length > 15, true);
});
