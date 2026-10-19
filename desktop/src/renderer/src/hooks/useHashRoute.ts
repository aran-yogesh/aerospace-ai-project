import { useCallback, useSyncExternalStore } from 'react'

export type Route = { name: 'projects'; empty: boolean } | { name: 'workspace'; projectId: string }

/*
 * Tiny hash router:
 *   #/                    projects
 *   #/?empty=1            projects, forced empty state (preview / screenshots)
 *   #/workspace/<id>      workspace for a project
 */
function parse(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/'
  const [path = '/', query = ''] = raw.split('?')
  const ws = /^\/workspace\/([^/]+)$/.exec(path)
  if (ws?.[1]) return { name: 'workspace', projectId: decodeURIComponent(ws[1]) }
  return { name: 'projects', empty: new URLSearchParams(query).get('empty') === '1' }
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

const getHash = (): string => window.location.hash

export function useHashRoute(): [Route, (hash: string) => void] {
  const hash = useSyncExternalStore(subscribe, getHash)
  const navigate = useCallback((next: string) => {
    window.location.hash = next
  }, [])
  return [parse(hash), navigate]
}
