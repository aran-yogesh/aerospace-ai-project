import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// shadcn/ui Button, restyled: square, hairline, mono uppercase labels, accent only on primary.
const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap select-none',
    'mono-label border transition-colors duration-120 ease-out',
    'disabled:pointer-events-none disabled:opacity-40',
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg:not([class*='stroke-'])]:stroke-[1.5]"
  ],
  {
    variants: {
      variant: {
        primary: 'border-accent bg-accent text-on-accent hover:bg-transparent hover:text-accent',
        secondary: 'border-border bg-transparent text-text hover:border-accent',
        ghost:
          'border-transparent bg-transparent text-text-muted hover:bg-surface-raised hover:text-text'
      },
      size: {
        default: 'h-8 px-3',
        sm: 'h-6 px-2',
        icon: 'size-7 p-0',
        'icon-sm': 'size-6 p-0'
      }
    },
    defaultVariants: { variant: 'secondary', size: 'default' }
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : (type ?? 'button')}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
