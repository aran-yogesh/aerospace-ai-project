import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  ipcMain,
  nativeTheme,
  screen,
  session,
  shell,
  type IpcMainInvokeEvent
} from 'electron'
import { getThemeMode, setThemeMode } from './settings'
import { windowBackground } from './windowTheme'
import {
  IPC,
  isThemeMode,
  resolveTheme,
  type ResolvedTheme,
  type ThemeMode,
  type ThemeState
} from '../shared/theme'

const here = dirname(fileURLToPath(import.meta.url))
const rendererUrl = process.env['ELECTRON_RENDERER_URL']
/** Dev = renderer served by the electron-vite dev server. Decided at runtime. */
const isDev = !app.isPackaged && Boolean(rendererUrl)

// Optional isolated profile (used by scripts/screenshots.ts so it never touches the
// user's saved settings). Must run before the app is ready.
/**
 * LEMMA_AUTOMATION=1 (set by scripts/screenshots.ts): show the window without focus,
 * parked at the right edge of the screen, so automated runs never steal focus.
 */
const isAutomation = process.env['LEMMA_AUTOMATION'] === '1'

const userDataOverride = process.env['LEMMA_USER_DATA_DIR']
if (userDataOverride) app.setPath('userData', userDataOverride)

function apiOrigin(): string {
  try {
    return new URL(__LEMMA_API_URL__).origin
  } catch {
    return 'http://localhost:8000'
  }
}

/*
 * Radix Dialog's scroll lock (react-remove-scroll) injects one <style> element at runtime.
 * Production CSP has no 'unsafe-inline', so that element carries a per-launch nonce that
 * the preload hands to the renderer (get-nonce). Dev keeps 'unsafe-inline' (a nonce in
 * the same directive would disable it, breaking Vite's injected styles).
 */
const styleNonce = randomBytes(18).toString('base64')
const STYLE_NONCE_ARG = '--lemma-style-nonce='

function contentSecurityPolicy(): string {
  const directives = isDev
    ? [
        "default-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self' 'unsafe-eval'",
        "font-src 'self' data:",
        `connect-src 'self' ${apiOrigin()} ws://localhost:*`
      ]
    : [
        "default-src 'self'",
        `style-src 'self' 'nonce-${styleNonce}'`,
        "script-src 'self'",
        "font-src 'self' data:",
        `connect-src 'self' ${apiOrigin()} ws://localhost:*`
      ]
  return directives.join('; ')
}

function installCsp(): void {
  const csp = contentSecurityPolicy()
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders }
    // Drop any upstream CSP header (any casing) so ours is the only policy.
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'content-security-policy') delete headers[key]
    }
    headers['Content-Security-Policy'] = [csp]
    callback({ responseHeaders: headers })
  })
}

function systemTheme(): ResolvedTheme {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

function nativeSource(mode: ThemeMode): 'light' | 'dark' | 'system' {
  return mode === 'auto' ? 'system' : mode
}

/**
 * While themeSource is 'system', shouldUseDarkColors is the OS appearance. When the user
 * forces light/dark it reflects the forced value; the renderer ignores `system` then, and
 * switching back to 'auto' returns a fresh value from the themeSet handler.
 */
function themeState(): ThemeState {
  return { mode: getThemeMode(), system: systemTheme() }
}

/** Keep every window's background and renderer in step with the current theme. */
function broadcastTheme(): void {
  const state = themeState()
  const bg = windowBackground(resolveTheme(state))
  for (const win of BrowserWindow.getAllWindows()) {
    win.setBackgroundColor(bg)
    win.webContents.send(IPC.themeChanged, state)
  }
}

/** Only accept IPC from our own top-level frame. */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame
  if (!frame || frame.parent) return false
  const url = frame.url
  if (isDev && rendererUrl) return url.startsWith(rendererUrl)
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
    nativeTheme.themeSource = nativeSource(mode)
    broadcastTheme()
    return themeState()
  })

  // Fires for OS appearance changes and for themeSource changes.
  nativeTheme.on('updated', broadcastTheme)
}

/**
 * LEMMA_CAPTURE_CONSOLE=1 mirrors renderer console output (including Chromium's own CSP
 * reports) to stdout, so scripts/screenshots.ts can count errors from the first message.
 */
function mirrorConsole(win: BrowserWindow): void {
  if (process.env['LEMMA_CAPTURE_CONSOLE'] !== '1') return
  win.webContents.on('console-message', (event) => {
    const line = JSON.stringify({ level: event.level, message: event.message })
    process.stdout.write(`[lemma:console] ${line}\n`)
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
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    useContentSize: true,
    minWidth: 1100,
    minHeight: 640,
    show: false,
    title: 'LemmaLab',
    backgroundColor: windowBackground(resolveTheme(themeState())),
    autoHideMenuBar: true,
    // macOS: hide the title bar, keep the traffic lights inset in our 44px top bar.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 14 },
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      additionalArguments: isDev ? [] : [`${STYLE_NONCE_ARG}${styleNonce}`]
    }
  })

  hardenWebContents(win)
  mirrorConsole(win)
  win.once('ready-to-show', () => {
    if (!isAutomation) {
      win.show()
      return
    }
    const area = screen.getDisplayMatching(win.getBounds()).workArea
    const { width, height } = win.getBounds()
    win.setPosition(
      area.x + Math.max(0, area.width - width),
      area.y + Math.max(0, area.height - height)
    )
    win.showInactive()
  })

  if (isDev && rendererUrl) {
    void win.loadURL(rendererUrl)
  } else {
    void win.loadFile(join(here, '../renderer/index.html'))
  }
}

app.enableSandbox()

void app.whenReady().then(() => {
  nativeTheme.themeSource = nativeSource(getThemeMode())
  installCsp()
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
