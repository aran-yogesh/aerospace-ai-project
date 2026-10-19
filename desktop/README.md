# LemmaLab Desktop

Electron + React + TypeScript, built with [electron-vite](https://electron-vite.org).
This is just the app shell and theme system. It makes no backend calls.

## Run

```sh
npm install
npm run dev          # Electron with HMR for the renderer
npm run build        # typecheck, then build into out/
npm run preview      # run the production build
npm run typecheck    # tsc for main/preload (node) and renderer (web)
npm run lint         # ESLint (flat config, typescript-eslint, react-hooks, no color literals)
npm run lint:colors  # fails on color literals in any CSS file except tokens.css
npm run format       # Prettier
```

Recent Electron versions download their binary the first time they run. If `npm run dev`
reports that the binary is missing, run `node node_modules/electron/install.js` once.

**Style guide:** open `#/dev`. In dev builds, use the **STYLE GUIDE** button in the top bar.
It shows every token and component variant in the light and dark themes side by side.

## Layout

```
src/
  main/           Electron main process (window, IPC, nativeTheme, electron-store)
  preload/        contextBridge API (window.lemma), typed in index.d.ts
  shared/         types and constants shared by all three processes
  renderer/
    index.html    CSP meta tag
    src/          renderer source root
      theme/      tokens.css, global.css, fonts.ts, ThemeProvider.tsx, useTheme.ts
      components/ Button, Tag, Panel, SegmentedControl, Splitter
      layout/     AppShell.tsx and its panes (components, viewer, results, chat)
      dev/        StyleGuide (#/dev)
      hooks/      useHashRoute (tiny hash router)
scripts/lint-colors.mjs
```

The spec's paths `src/theme/`, `src/components/` and `src/layout/AppShell.tsx` sit under
the renderer source root, `src/renderer/src/`.

## Theme rules

- **Use tokens only.** Every color comes from `var(--token)` in `src/renderer/src/theme/tokens.css`:
  `--bg --surface --surface-raised --text --text-muted --border --accent --on-accent
  --warning --danger`, plus `--pressure-1..5`, a gray-to-accent scale for the future 3D viewer.
  `tokens.css` is the only file allowed to contain color literals. Two checks enforce this:
  - `npm run lint:colors` flags hex, `rgb()`/`hsl()`-style functions and named colors
    (`white`, `black`, ...) in any other CSS file.
  - ESLint (`no-restricted-syntax`) flags hex/rgb/hsl string literals in renderer `.ts/.tsx`.
- Tokens are scoped by `[data-theme="light" | "dark"]`, so a nested element with its own
  `data-theme` re-themes its subtree. `ThemeProvider` sets the resolved theme on `<html>`.
- Theme modes are `light`, `dark` and `system` (default `system`). The main process sets
  `nativeTheme.themeSource` to match the mode, saves the choice with electron-store, and
  pushes OS changes to the renderer, so `system` updates live.
- **Radius 0** everywhere. Borders are 1px `var(--border)`.
- **Accent orange** (`--accent`) is used only for the selected state, the focus ring and the
  primary action. Primary buttons use a solid accent background with `--on-accent` text.
  Secondary buttons are transparent with a 1px border that turns accent on hover.
- **Fonts** are bundled locally from `@fontsource` (no CDN):
  - IBM Plex Mono for labels, numbers, tables, buttons and headers, in uppercase with
    `letter-spacing: 0.08em`
  - IBM Plex Sans for chat message bodies
- Styling is plain CSS modules with no CSS framework.

## Security

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` (and `app.enableSandbox()`),
  `webviewTag: false`.
- A strict CSP in `index.html`:
  `default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'`.
  In dev, electron-vite serves the page from its dev server origin, so `'self'` also covers HMR.
- The preload exposes only `window.lemma.theme.{get, set, onSystemChange}`. Main checks
  each IPC call: the sender must be our top-level frame, and the mode must be
  `light | dark | system`.
- New windows are denied (http(s) links open in the system browser). Navigation away from
  the app and `<webview>` attachment are blocked.
- electron-store runs only in main, because a sandboxed preload has no Node access.

## Build notes

- `package.json` has `"type": "module"`, so the main process is built as ESM. That lets
  the ESM-only `electron-store` v12 load natively; it is externalized, not bundled.
- Sandboxed preloads must be CommonJS, so the preload is forced to `out/preload/index.cjs`.
