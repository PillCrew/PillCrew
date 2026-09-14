// Whether the chat window is "open" decides what a click on Pilly does, and the
// platforms disagree about how to ask. Electron reports isMinimized() everywhere,
// but on macOS a minimised window still reports isVisible() === true - AppKit's
// isVisible - while on Windows the same window reports false. A minimised chat is
// in front of the user either way, so both answers are folded into one question
// here, and keeping it pure means `npm test` (which runs on Linux) can cover the
// macOS answer too. See src/macmenu.js for the same reasoning.
//
// A window that does not exist yet is not open: the caller has to build it.

function chatIsOpen(state) {
  if (!state) return false;
  if (state.destroyed) return false;
  if (!state.visible) return false;
  // Minimised == out of the way. Treating it as "already open" is what made a
  // click on Pilly do nothing at all until the pet was switched off and on.
  return !state.minimized;
}

// What a click on Pilly is asking for: put him away, or bring him out. A click
// on a window that is already up means "go away" (the tray toggle), a click on
// one that is minimised means "come back".
function chatToggle(state) {
  return chatIsOpen(state) ? "hide" : "reveal";
}

module.exports = { chatIsOpen, chatToggle };
