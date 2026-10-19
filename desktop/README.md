# LemmaLab Desktop

Electron + React 18 + TypeScript, built with [electron-vite](https://electron-vite.org).
Styling is Tailwind CSS v4 (CSS-first `@theme`) plus shadcn/ui components (Radix) kept as
owned source, lucide-react icons, react-resizable-panels and IBM Plex fonts bundled locally
through `@fontsource`, with no CDN.

## Run

```sh
npm install
npm run dev              # Electron with HMR for the renderer (Vite dev server on :5173)
npm run build            # typecheck, then build into out/
npm run preview          # run the production build
npm run typecheck        # tsc for main/preload/scripts (node) and renderer (web)
npm run lint             # ESLint (flat config, typescript-eslint, react-hooks, no color literals)
npm run lint:colors      # fails on color literals anywhere in src/ except tokens.css
npm run screenshots      # Playwright: shoots ../docs/screenshots/phase0/*.png from out/ (build first)
npm run screenshots:dev  # same against the Vite dev server, reusing `npm run dev` if it is running
```

The backend URL comes from `VITE_API_URL` (default `http://localhost:8000`), read from the
shell or a `.env` file in `desktop/` at build time. The status bar polls `GET /health`
every 5s. In dev, the renderer origin is `http://localhost:5173`, which the backend's CORS
allow-list expects. The production build loads from `file://` (origin `null`).

If `npm run dev` reports that the Electron binary is missing, run
`node node_modules/electron/install.js` once.

## Layout

```
src/
  main/            Electron main: window, CSP, theme IPC, nativeTheme, electron-store
  preload/         contextBridge API (window.lemma), typed in global.d.ts
  shared/          types and constants shared by all three processes
  renderer/
    index.html
    src/           renderer source root, aliased as "@/" (shadcn convention)
      theme/       tokens.css (the only file with colors), globals.css (Tailwind @theme), fonts
      components/
        ui/        shadcn/ui components, restyled (see below)
        app/       TopBar, StatusBar, SettingsDialog, ThemeSelect
      screens/     ProjectsScreen, WorkspaceScreen (+ workspace/ panes)
      hooks/       useHashRoute, useBackendHealth
      lib/         utils (cn), config (API_URL, version), sampleProjects
scripts/
  lint-colors.mjs  color-literal check
  screenshots.ts   Playwright _electron screenshots + console/CSP audit
components.json    shadcn config
```

**Path note.** The spec puts components in `desktop/src/components/ui`. electron-vite's
renderer root is `src/renderer/src`, so they live in `src/renderer/src/components/ui`.
The shadcn `@/` alias (in `electron.vite.config.ts`, `tsconfig.web.json` and
`components.json`) points at `src/renderer/src`, so `@/components/ui/button` resolves there.

## Routes

The router reads the URL hash:

- `#/`: projects (3 static sample projects)
- `#/?empty=1`: projects in the empty state, for previews and screenshots
- `#/workspace/<id>`: the workspace for a project

## Design system

The spec is in `../docs/decisions/0002-design-system.md`.

- **Tokens.** `theme/tokens.css` defines `--bg --surface --surface-raised --text
--text-muted --border --accent --on-accent --warning --danger --pressure-1..5` for
  `[data-theme="dark"|"light"]`. It also defines some extras: `--success` (green for the
  StatusDot "ok" state, which the token table does not have), `--overlay` (dialog scrim) and
  `--halftone-dot`. `globals.css` maps them into Tailwind (`bg-surface`, `text-text-muted`,
  `border-accent`, ...) and maps the shadcn variables (`--background`, `--primary`, ...,
  `--radius: 0`). Tailwind's default palette, radii and shadows are removed, so
  `bg-white`, `rounded-md` and `shadow` generate nothing. In this design `accent` always
  means orange. shadcn's own "accent" hover color is not used.
- **No color literals.** Only `tokens.css` may contain colors. `npm run lint:colors` scans
  every CSS/TS/TSX file in `src/` for hex values, `rgb()`/`hsl()`-style functions, Tailwind
  arbitrary colors (`bg-[#...]`) and Tailwind palette classes (`text-red-500`). ESLint also
  flags color string literals in the renderer. The main process reads `--bg` from
  `tokens.css` (`?raw` import) for the window background, so there is no second copy of it.
- **Utilities.** `mono-label` (Plex Mono 11px, uppercase, 0.08em, 500), `wordmark`,
  `num` (Plex Mono 13px tabular), `halftone` (1px dots on a 6px grid, text color at 6%, used
  only on empty states and the viewer), `app-drag` and `app-no-drag`.
- **Components** in `components/ui`: `button` (primary/secondary/ghost), `callout` (+
  `LeaderLines`), `panel-header`, `segmented-control`, `tabs`, `tooltip`, `dialog`,
  `input`, `status-dot`, `resizable`.

## Theme

The modes are `light`, `dark` and `auto` (the default). The main process sets
`nativeTheme.themeSource`, saves the mode with electron-store and broadcasts every change
(a new mode or an OS appearance change) to all windows, so `auto` follows the OS live. The
BrowserWindow background follows the resolved theme, so there is no flash. Use
`window.lemma.theme.get() / set(mode) / onChange(cb)`.

## Security

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
  (plus `app.enableSandbox()`) and `webviewTag: false`. New windows are denied, and
  navigation away from the app is blocked.
- The CSP is sent as a response header from `session.webRequest.onHeadersReceived`, and it
  depends on the environment:
  - dev: `default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-eval'; font-src 'self' data:; connect-src 'self' <api origin> ws://localhost:*`
  - prod: the same without `'unsafe-inline'` and `'unsafe-eval'`, with one addition:
    `style-src 'self' 'nonce-<random per launch>'`. Radix Dialog's scroll lock
    (react-remove-scroll) inserts one `<style>` element at runtime. The preload passes the
    nonce to the renderer, which hands it to `get-nonce`. Without it, opening Settings would
    cause a CSP violation.
  - dev scripts: dev has no `'unsafe-inline'` for scripts, so a small Vite plugin
    (`externalReactPreamble` in `electron.vite.config.ts`) serves the React Refresh
    preamble as an external module instead of an inline `<script>`.
- The preload logs every `securitypolicyviolation` as a `[CSP]` console error.

## Screenshots and audit

`scripts/screenshots.ts` (run by Node's built-in TypeScript type stripping) launches
`out/main/index.js` with Playwright's `_electron`. It uses a 1440x900 window and a throwaway
userData dir, so your saved theme is untouched. It sets the theme through
`window.lemma.theme.set()` and captures `projects-dark`, `projects-light`,
`projects-empty-dark`, `workspace-dark`, `workspace-light` and `settings-dark`. It
also exercises the chat tooltip and the dialog, then reports:

- every renderer console message, mirrored to stdout by main when
  `LEMMA_CAPTURE_CONSOLE=1`
- page errors
- CSP violations
- a CSP probe that injects an inline `<style>`: it must be blocked in prod and applied in dev

The run fails if any errors or violations are found. `--no-shots` runs only the audit.

The script sets `LEMMA_AUTOMATION=1`. In that mode the window opens with `showInactive()`,
parked at the right edge of the screen, so it never takes focus. `npm run dev` is not
affected. Screenshots are page captures, so the macOS traffic lights (drawn by the OS in the
84px inset at the top left) do not appear in them.
