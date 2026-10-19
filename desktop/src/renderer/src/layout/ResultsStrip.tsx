import { Panel, Tag } from '../components'
import styles from './AppShell.module.css'

const RESULTS = [
  { id: 'V-101', flow: '2.40', dp: '3.60', status: 'OK' },
  { id: 'ELBOW-1', flow: '2.40', dp: '0.86', status: 'APPROX' },
  { id: 'HX-1', flow: '2.40', dp: '18.0', status: 'APPROX' }
]

export function ResultsStrip(): React.JSX.Element {
  return (
    <Panel title="Results" padded={false}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Component</th>
            <th scope="col" className={styles.num}>
              Flow (L/s)
            </th>
            <th scope="col" className={styles.num}>
              ΔP (kPa)
            </th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {RESULTS.map((r) => (
            <tr key={r.id}>
              <td>{r.id}</td>
              <td className={styles.num}>{r.flow}</td>
              <td className={styles.num}>{r.dp}</td>
              <td>
                <Tag variant={r.status === 'APPROX' ? 'approximate' : 'default'}>{r.status}</Tag>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  )
}
