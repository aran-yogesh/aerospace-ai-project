import { useId, type ReactNode } from 'react'
import styles from './Panel.module.css'

export interface PanelProps {
  title: string
  actions?: ReactNode
  padded?: boolean
  className?: string
  children?: ReactNode
}

export function Panel({
  title,
  actions,
  padded = true,
  className,
  children
}: PanelProps): React.JSX.Element {
  const titleId = useId()
  return (
    <section
      className={[styles.panel, className].filter(Boolean).join(' ')}
      aria-labelledby={titleId}
    >
      <header className={styles.header}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        {actions}
      </header>
      <div className={[styles.body, padded ? styles.padded : ''].filter(Boolean).join(' ')}>
        {children}
      </div>
    </section>
  )
}
