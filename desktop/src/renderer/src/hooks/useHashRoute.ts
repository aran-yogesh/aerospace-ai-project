import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

function getRoute(): string {
  const hash = window.location.hash.replace(/^#/, '')
  return hash === '' ? '/' : hash
}

/** Tiny hash router: returns the current route, e.g. "/" or "/dev". */
export function useHashRoute(): string {
  return useSyncExternalStore(subscribe, getRoute)
}

export function navigate(route: string): void {
  window.location.hash = route
}
