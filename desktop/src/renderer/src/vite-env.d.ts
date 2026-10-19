/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend base URL. Defaults to http://localhost:8000. */
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** package.json version, injected at build time. */
declare const __APP_VERSION__: string
