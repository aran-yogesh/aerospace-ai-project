/** Backend base URL (VITE_API_URL, default http://localhost:8000), without trailing slash. */
export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000').replace(/\/+$/, '')

export const APP_VERSION = __APP_VERSION__
