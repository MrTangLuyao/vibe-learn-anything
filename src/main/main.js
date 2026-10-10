/* ============================================================
 * src/main/main.js — Vibe Learn Anything, Electron entry point.
 * ============================================================ */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, Menu, shell, nativeTheme } from 'electron';
import { isDev } from './paths.js';
import { registerSchemes, handleProtocols } from './protocols.js';
import { registerIpc } from './ipc.js';
import * as settings from './settings.js';
import * as library from './library.js';
import * as exec from './exec.js';
import * as kit from './kit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let win = null;
const pendingFiles = [];

registerSchemes();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const files = argv.filter(a => a.toLowerCase().endsWith('.vla') && fs.existsSync(a));
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      if (files.length) win.webContents.send('app:openFiles', files);
    }
  });
}

app.on('open-file', (event, file) => {
  event.preventDefault();
  if (win) win.webContents.send('app:openFiles', [file]);
  else pendingFiles.push(file);
});

function themeColors() {
  const t = settings.get('theme');
  const dark = t === 'dark' || (t === 'system' && nativeTheme.shouldUseDarkColors);
  return dark ? { color: '#1f1f1e', symbolColor: '#e8e8e8' } : { color: '#faf8f2', symbolColor: '#2a2722' };
}

function createWindow() {
  const colors = themeColors();
  /* Automated tests (test/drive.mjs, tools/record-media.mjs) use an invisible window. */
  const hiddenRun = process.env.VLA_TEST_HIDDEN === '1';
  win = new BrowserWindow({
    ...(hiddenRun ? { x: 0, y: 0, opacity: 0, skipTaskbar: true } : {}),
    width: 1360,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: colors.color,
    title: 'Vibe Learn Anything',
    ...(fs.existsSync(path.join(app.getAppPath(), 'build', 'icon.png')) ? { icon: path.join(app.getAppPath(), 'build', 'icon.png') } : {}),
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 16, y: 18 } }
      : { titleBarOverlay: { color: colors.color, symbolColor: colors.symbolColor, height: 48 } }),
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
      backgroundThrottling: !hiddenRun,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://')) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    if (key === 'f12' || (input.control && input.shift && key === 'i')) {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
    if (isDev && input.control && key === 'r') {
      win.webContents.reload();
      event.preventDefault();
    }
  });
  win.webContents.on('render-process-gone', () => exec.killAllFor(win.webContents));
  win.on('closed', () => { win = null; });
  win.once('ready-to-show', () => {
    if (!hiddenRun) { win.show(); return; }
    /* Invisible, click-through and never focused, but still rendering. */
    win.setIgnoreMouseEvents(true);
    win.showInactive();
  });

  const wc = win.webContents;
  win.on('close', () => exec.killAllFor(wc));
  wc.on('did-finish-load', () => {
    const files = [
      ...pendingFiles.splice(0),
      ...process.argv.slice(1).filter(a => a.toLowerCase().endsWith('.vla') && fs.existsSync(a)),
    ];
    if (files.length) wc.send('app:openFiles', files);
    if (kit.isPrepared()) kit.watch(wc);
  });
  win.loadURL('app://ui/index.html');
}

app.whenReady().then(() => {
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  handleProtocols();
  registerIpc();
  try { exec.ensureShims(); } catch { /* shims are a convenience */ }
  try { library.seedExamples(); } catch { /* the library still works empty */ }
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => {
  kit.stop();
  if (process.platform !== 'darwin') app.quit();
});

