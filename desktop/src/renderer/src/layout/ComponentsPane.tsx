import { useState } from 'react'
import { Panel, Tag, type TagVariant } from '../components'
import styles from './AppShell.module.css'

interface Row {
  id: string
  tag: string
  name: string
  meta: string
  approximate?: boolean
}

const ROWS: Row[] = [
  { id: 'p1', tag: 'PIPE', name: 'Supply main', meta: 'DN50' },
  { id: 'v1', tag: 'VALVE', name: 'Isolation V-101', meta: 'Kv 40' },
  { id: 'e1', tag: 'ELBOW', name: '90° long radius', meta: 'K 0.30', approximate: true },
  { id: 'p2', tag: 'PUMP', name: 'Booster P-201', meta: '12 m' },
  { id: 'h1', tag: 'HX', name: 'Plate exchanger', meta: 'ΔP 18 kPa', approximate: true },
  { id: 'r1', tag: 'REDUCER', name: 'DN50 → DN32', meta: 'K 0.12' }
]

export function ComponentsPane(): React.JSX.Element {
  const [selected, setSelected] = useState<string>('v1')
  return (
    <Panel title="Components" padded={false}>
      <ul className={styles.list}>
        {ROWS.map((row) => {
          const isSelected = row.id === selected
          const variant: TagVariant = isSelected
            ? 'selected'
            : row.approximate
              ? 'approximate'
              : 'default'
          return (
            <li key={row.id}>
              <button
                type="button"
                className={styles.row}
                aria-current={isSelected}
                onClick={() => setSelected(row.id)}
              >
                <Tag variant={variant}>{row.tag}</Tag>
                <span className={styles.rowMeta}>{row.meta}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}
