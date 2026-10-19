import type { LemmaApi } from './api'

declare global {
  interface Window {
    /** Undefined only when the renderer runs outside Electron (e.g. a plain browser). */
    lemma?: LemmaApi
  }
}

export {}
