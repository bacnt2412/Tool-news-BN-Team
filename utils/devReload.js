const fs = require('fs');
const path = require('path');

function enableDevReload({ app, mainWindow, rootDir }) {
  if (!process.argv.includes('--dev')) return null;

  let rendererTimer;
  let relaunchTimer;
  let relaunching = false;
  const ignoredRoots = new Set(['.git', 'bin', 'build', 'dist', 'node_modules']);

  const watcher = fs.watch(rootDir, { recursive: true }, (eventType, fileName) => {
    if (!fileName || relaunching) return;
    const relative = String(fileName).replace(/\\/g, '/');
    const firstPart = relative.split('/')[0];
    if (ignoredRoots.has(firstPart)) return;

    const baseName = path.basename(relative);
    const isRendererFile = relative === 'index.html' || relative === 'styles.css' ||
      /^renderer(?:\..+)?\.js$/i.test(baseName);
    const isMainFile = relative === 'main.js' || relative === 'preload.js' ||
      relative === 'config.js' || relative.startsWith('utils/');

    if (isMainFile) {
      clearTimeout(relaunchTimer);
      relaunchTimer = setTimeout(() => {
        if (relaunching) return;
        relaunching = true;
        app.relaunch({ args: process.argv.slice(1) });
        app.exit(0);
      }, 350);
      return;
    }

    if (isRendererFile) {
      clearTimeout(rendererTimer);
      rendererTimer = setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reloadIgnoringCache();
      }, 180);
    }
  });

  console.log('[dev] Hot reload enabled');
  return watcher;
}

module.exports = { enableDevReload };
