import type { HTMLAttributes } from 'react'
import styles from './Tag.module.css'

export type TagVariant = 'default' | 'selected' | 'approximate'

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: TagVariant
}

export function Tag({ variant = 'default', className, ...rest }: TagProps): React.JSX.Element {
  const classes = [styles.tag, variant !== 'default' ? styles[variant] : '', className]
    .filter(Boolean)
    .join(' ')
  return <span className={classes} data-variant={variant} {...rest} />
}
