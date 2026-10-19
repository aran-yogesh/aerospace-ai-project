import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

// Matches color literals in string/template literals: hex, rgb()/hsl() etc., and common
// named colors used as whole values. Colors must come from CSS tokens (var(--token)).
const COLOR_LITERAL =
  "/(#[0-9a-fA-F]{3,8}\\b|\\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\\s*\\(|^\\s*(white|black|red|green|blue|gray|grey|orange|yellow|purple|pink)\\s*$)/i"

const noColorLiterals = {
  'no-restricted-syntax': [
    'error',
    {
      selector: `Literal[value=${COLOR_LITERAL}]`,
      message: 'Hardcoded color. Use a CSS token, e.g. var(--accent), defined in theme/tokens.css.'
    },
    {
      selector: `TemplateElement[value.raw=${COLOR_LITERAL}]`,
      message: 'Hardcoded color. Use a CSS token, e.g. var(--accent), defined in theme/tokens.css.'
    }
  ]
}

export default tseslint.config(
  { ignores: ['node_modules/**', 'out/**', 'dist/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'src/shared/**/*.ts', '*.config.{js,ts}', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...noColorLiterals
    }
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  }
)
