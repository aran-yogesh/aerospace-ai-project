import { useRef, useState, type KeyboardEvent } from 'react'
import { Panel } from '../components'
import styles from './AppShell.module.css'

const TABS = [
  { id: '3d', label: '3D', placeholder: '3D viewer placeholder' },
  { id: 'schematic', label: 'Schematic', placeholder: 'Schematic placeholder' },
  { id: 'dp', label: 'ΔP plot', placeholder: 'ΔP plot placeholder' }
] as const

type TabId = (typeof TABS)[number]['id']

export function ViewerPane(): React.JSX.Element {
  const [active, setActive] = useState<TabId>('3d')
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const activeTab = TABS.find((t) => t.id === active) ?? TABS[0]

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number): void {
    let next: number | null = null
    if (e.key === 'ArrowRight') next = (index + 1) % TABS.length
    else if (e.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = TABS.length - 1
    if (next === null) return
    e.preventDefault()
    setActive(TABS[next].id)
    refs.current[next]?.focus()
  }

  return (
    <Panel title="Viewer" padded={false}>
      <div className={styles.viewerBody}>
        <div role="tablist" aria-label="Viewer mode" className={styles.tabs}>
          {TABS.map((tab, index) => (
            <button
              key={tab.id}
              ref={(el) => {
                refs.current[index] = el
              }}
              id={`viewer-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={tab.id === active}
              aria-controls="viewer-tabpanel"
              tabIndex={tab.id === active ? 0 : -1}
              className={styles.tab}
              onClick={() => setActive(tab.id)}
              onKeyDown={(e) => onKeyDown(e, index)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div
          id="viewer-tabpanel"
          role="tabpanel"
          aria-labelledby={`viewer-tab-${activeTab.id}`}
          className={styles.placeholder}
        >
          {activeTab.placeholder}
        </div>
      </div>
    </Panel>
  )
}
