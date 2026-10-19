import * as React from 'react'
import { cn } from '@/lib/utils'

// shadcn/ui Input, restyled: square, 1px border, accent border on focus, mono placeholder.
const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'h-8 w-full min-w-0 border border-border bg-transparent px-3 text-body text-text',
        'transition-colors duration-120 ease-out outline-none',
        'placeholder:mono-label placeholder:text-text-muted',
        'focus-visible:border-accent focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-60',
        'read-only:num read-only:text-text-muted',
        className
      )}
      {...props}
    />
  )
)
Input.displayName = 'Input'

export { Input }
