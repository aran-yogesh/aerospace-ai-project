import { ThemeProvider } from './theme/ThemeProvider'
import { AppShell } from './layout/AppShell'
import { StyleGuide } from './dev/StyleGuide'
import { useHashRoute } from './hooks/useHashRoute'

export function App(): React.JSX.Element {
  const route = useHashRoute()
  return <ThemeProvider>{route === '/dev' ? <StyleGuide /> : <AppShell />}</ThemeProvider>
}
