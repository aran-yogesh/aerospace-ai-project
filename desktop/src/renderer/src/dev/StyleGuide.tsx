import { useLayoutEffect, useRef, useState } from 'react'
import { Button, Panel, SegmentedControl, Splitter, Tag } from '../components'
import { COLOR_TOKENS, PRESSURE_TOKENS } from '../theme/tokenList'
import { navigate } from '../hooks/useHashRoute'
import { THEME_OPTIONS } from '../layout/AppShell'
import type { ResolvedTheme, ThemeMode } from '../../../shared/theme'
import styles from './StyleGuide.module.css'

function Swatch({ name }: { name: string }): React.JSX.Element {
  const valueRef = useRef<HTMLSpanElement>(null)

  // Read the live computed value inside this subtree's data-theme scope.
  useLayoutEffect(() => {
    const el = valueRef.current
    if (el) el.textContent = getComputedStyle(el).getPropertyValue(name).trim()
  }, [name])

  return (
    <div className={styles.swatch}>
      <div className={styles.chip} style={{ background: `var(${name})` }} />
      <div className={styles.swatchText}>
        <span>{name}</span>
        <span ref={valueRef} className={styles.swatchValue} />
      </div>
    </div>
  )
}

function ThemeColumn({ theme }: { theme: ResolvedTheme }): React.JSX.Element {
  const [segment, setSegment] = useState<ThemeMode>('system')
  const [split, setSplit] = useState(120)

  return (
    <div data-theme={theme} className={styles.column}>
      <h2 className={styles.columnTitle}>{theme} theme</h2>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Color tokens</h3>
        <div className={styles.swatches}>
          {COLOR_TOKENS.map((t) => (
            <Swatch key={t} name={t} />
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Pressure scale</h3>
        <div className={styles.ramp} aria-hidden="true">
          {PRESSURE_TOKENS.map((t) => (
            <span key={t} style={{ background: `var(${t})` }} />
          ))}
        </div>
        <div className={styles.swatches}>
          {PRESSURE_TOKENS.map((t) => (
            <Swatch key={t} name={t} />
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Typography</h3>
        <div className={styles.type}>
          <span className="mono-label">IBM Plex Mono · label 0.08em</span>
          <span className="mono-label">0123456789 ΔP 18.04 kPa</span>
          <p className={styles.sans}>
            IBM Plex Sans is used for chat message bodies. The quick brown fox jumps over the
            lazy dog.
          </p>
          <p className={`${styles.sans} ${styles.muted}`}>Muted text uses --text-muted.</p>
          <span className={`${styles.status} ${styles.warning}`}>Warning · --warning</span>
          <span className={`${styles.status} ${styles.danger}`}>Danger · --danger</span>
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Button</h3>
        <div className={styles.row}>
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
          <Button variant="secondary" disabled>
            Disabled
          </Button>
        </div>
        <div className={styles.row}>
          <Button variant="primary" size="small">
            Small primary
          </Button>
          <Button variant="secondary" size="small">
            Small secondary
          </Button>
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Tag</h3>
        <div className={styles.row}>
          <Tag>Default</Tag>
          <Tag variant="selected">Selected</Tag>
          <Tag variant="approximate">Approximate</Tag>
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>SegmentedControl</h3>
        <SegmentedControl<ThemeMode>
          label={`Demo segmented control (${theme})`}
          options={THEME_OPTIONS}
          value={segment}
          onChange={setSegment}
        />
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Panel</h3>
        <div className={styles.panelDemo}>
          <Panel title="Panel title" actions={<Tag>Meta</Tag>}>
            <p className={styles.sans}>Panel body content.</p>
          </Panel>
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Splitter</h3>
        <div className={styles.row}>
          <span className={styles.status} style={{ width: split }}>
            Width {Math.round(split)}px
          </span>
          <Splitter
            orientation="vertical"
            label={`Demo splitter (${theme})`}
            value={split}
            min={80}
            max={260}
            onChange={setSplit}
          />
          <span className={styles.status}>Drag or use arrow keys</span>
        </div>
      </section>
    </div>
  )
}

export function StyleGuide(): React.JSX.Element {
  return (
    <div className={styles.page}>
      <header className={styles.bar}>
        <h1 className={styles.heading}>Style guide</h1>
        <span className="mono-label">#/dev</span>
        <div className={styles.spacer} />
        <Button size="small" onClick={() => navigate('/')}>
          Back to app
        </Button>
      </header>
      <div className={styles.columns}>
        <ThemeColumn theme="light" />
        <ThemeColumn theme="dark" />
      </div>
    </div>
  )
}
