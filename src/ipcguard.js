const { pathToFileURL } = require('url');

function trustedSender(event, win, entryFile) {
  return Boolean(win && !win.isDestroyed() && event.sender === win.webContents
    && event.senderFrame === win.webContents.mainFrame
    && event.senderFrame.url === pathToFileURL(entryFile).href);
}

module.exports = { trustedSender };
