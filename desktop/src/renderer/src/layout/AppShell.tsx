import { useState } from 'react'
import { Button, Panel, SegmentedControl, Splitter } from '../components'
import { useTheme } from '../theme/useTheme'
import { navigate } from '../hooks/useHashRoute'
import type { ThemeMode } from '../../../shared/theme'
import { ComponentsPane } from './ComponentsPane'
import { ViewerPane } from './ViewerPane'
import { ResultsStrip } from './ResultsStrip'
import { ChatPane } from './ChatPane'
import styles from './AppShell.module.css'

export const THEME_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Auto' }
] as const satisfies readonly { value: ThemeMode; label: string }[]

export function AppShell(): React.JSX.Element {
  const { mode, setMode } = useTheme()
  const [leftWidth, setLeftWidth] = useState(260)
  const [rightWidth, setRightWidth] = useState(360)
  const [resultsHeight, setResultsHeight] = useState(180)

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <h1 className={styles.brand}>LemmaLab</h1>
        <div className={styles.spacer} />
        {import.meta.env.DEV && (
          <Button size="small" onClick={() => navigate('/dev')}>
            Style guide
          </Button>
        )}
        <SegmentedControl<ThemeMode>
          label="Theme"
          options={THEME_OPTIONS}
          value={mode}
          onChange={setMode}
        />
      </header>

      <div className={styles.workspace}>
        <div id="pane-components" className={styles.side} style={{ width: leftWidth }}>
          <ComponentsPane />
        </div>
        <Splitter
          orientation="vertical"
          label="Resize components pane"
          controls="pane-components"
          value={leftWidth}
          min={180}
          max={480}
          onChange={setLeftWidth}
        />
        <div className={styles.center}>
          <div className={styles.viewer}>
            <ViewerPane />
          </div>
          <Splitter
            orientation="horizontal"
            label="Resize results strip"
            controls="pane-results"
            value={resultsHeight}
            min={80}
            max={480}
            direction={-1}
            onChange={setResultsHeight}
          />
          <div id="pane-results" className={styles.results} style={{ height: resultsHeight }}>
            <ResultsStrip />
          </div>
        </div>
        <Splitter
          orientation="vertical"
          label="Resize chat pane"
          controls="pane-chat"
          value={rightWidth}
          min={260}
          max={640}
          direction={-1}
          onChange={setRightWidth}
        />
        <div id="pane-chat" className={styles.side} style={{ width: rightWidth }}>
          <Panel title="Chat" padded={false}>
            <ChatPane />
          </Panel>
        </div>
      </div>
    </div>
  )
}

