import type { ButtonHTMLAttributes } from 'react'
import styles from './Button.module.css'

export type ButtonVariant = 'primary' | 'secondary'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'normal' | 'small'
}

export function Button({
  variant = 'secondary',
  size = 'normal',
  className,
  type = 'button',
  ...rest
}: ButtonProps): React.JSX.Element {
  const classes = [styles.button, styles[variant], size === 'small' ? styles.small : '', className]
    .filter(Boolean)
    .join(' ')
  return <button type={type} className={classes} {...rest} />
}
