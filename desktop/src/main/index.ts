import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain, nativeTheme, shell, type IpcMainInvokeEvent } from 'electron'
import { getThemeMode, setThemeMode } from './settings'
import { IPC, isThemeMode, type ResolvedTheme, type ThemeState } from '../shared/theme'

const here = dirname(fileURLToPath(import.meta.url))
const isDev = !app.isPackaged && Boolean(process.env['ELECTRON_RENDERER_URL'])

function systemTheme(): ResolvedTheme {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

/**
 * When themeSource is 'system', shouldUseDarkColors is the OS appearance. When the user
 * forces light/dark it reflects the forced value; the renderer ignores `system` then, and
 * switching back to 'system' returns a fresh value from the themeSet handler.
 */
function themeState(): ThemeState {
  return { mode: getThemeMode(), system: systemTheme() }
}

/** Only accept IPC from our own top-level frame. */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame
  if (!frame || frame.parent) return false
  const url = frame.url
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    return url.startsWith(process.env['ELECTRON_RENDERER_URL'])
  }
  return url.startsWith('file://')
}

function registerIpc(): void {
  ipcMain.handle(IPC.themeGet, (event) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted sender')
    return themeState()
  })

  ipcMain.handle(IPC.themeSet, (event, mode: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted sender')
    if (!isThemeMode(mode)) throw new TypeError('Invalid theme mode')
    setThemeMode(mode)
    nativeTheme.themeSource = mode
    return themeState()
  })

  nativeTheme.on('updated', () => {
    if (nativeTheme.themeSource !== 'system') return
    const os = systemTheme()
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.themeSystemChanged, os)
    }
  })
}

function hardenWebContents(win: BrowserWindow): void {
  const contents = win.webContents
  // No new windows. Open http(s) links in the user's browser instead.
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // No navigation away from the app (hash changes are not navigations).
  contents.on('will-navigate', (event, url) => {
    const current = contents.getURL()
    if (url.split('#')[0] !== current.split('#')[0]) event.preventDefault()
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'LemmaLab',
    backgroundColor: systemTheme() === 'dark' ? '#000000' : '#FFFFFF',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false
    }
  })

  hardenWebContents(win)
  win.once('ready-to-show', () => win.show())

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(here, '../renderer/index.html'))
  }
}

app.enableSandbox()

void app.whenReady().then(() => {
  nativeTheme.themeSource = getThemeMode()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
