# 0002. Design system

- Status: accepted
- Date: 2026-10-18

## Context

LemmaLab is an engineering tool, and the UI should read like an engineering drawing: calm,
precise and dense. We also want two themes and one place to change any color.

## Decision

- **Tokens.** All color comes from CSS variables (`bg`, `surface`, `surface-raised`, `text`,
  `text-muted`, `border`, `accent`, `on-accent`, `warning`, `danger`, `pressure-1..5`), defined
  for `[data-theme="dark"]` and `[data-theme="light"]` and mapped into the Tailwind v4 theme and
  shadcn variables. Components never hardcode a color, and `npm run lint:colors` enforces it.
- **One accent.** Orange `#E0622A` is used only for selected state, focus, the primary action
  and callouts. Everything else is black, white and gray.
- **Shape.** Square corners everywhere (shadcn `--radius: 0`), 1px hairline borders, a 4px grid,
  and 120ms ease-out motion on opacity and color only.
- **Type.** IBM Plex Mono is for labels, headers, buttons, tabs and numbers (11px uppercase with
  0.08em tracking, and tabular numbers at 13px). IBM Plex Sans 14/1.5 is for body and chat text.
  Both are bundled locally with `@fontsource`, with no CDN.
- **Callout.** This is the signature element: a boxed mono label with a 6x6 accent square on its
  left edge and an optional 1px accent leader line to a target, like a callout on a drawing.
  Variants are default, selected, approximate (dashed) and filled.
- **Halftone.** A dot texture used only on empty states and the viewer background.
- **shadcn/ui restyled.** We use shadcn's Radix-based components as owned source in
  `desktop/src/renderer/src/components/ui`, restyled to these rules, not a themed dependency.

## Consequences

- Restyling shadcn means we own those components' maintenance.
- Any new color must be added as a token first, in both themes.
