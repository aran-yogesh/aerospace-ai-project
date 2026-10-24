import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { UnitSystem } from './format'

const KEY = 'lemma.units'

function load(): UnitSystem {
  try {
    return localStorage.getItem(KEY) === 'US' ? 'US' : 'SI'
  } catch {
    return 'SI'
  }
}

interface UnitsValue {
  units: UnitSystem
  setUnits: (u: UnitSystem) => void
}

const UnitsContext = createContext<UnitsValue>({ units: 'SI', setUnits: () => undefined })

/** Display unit system (Settings: SI | US). The API always stays SI. */
export function UnitsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [units, setState] = useState<UnitSystem>(load)
  const setUnits = useCallback((u: UnitSystem) => {
    setState(u)
    try {
      localStorage.setItem(KEY, u)
    } catch {
      // Storage unavailable: the choice lasts for this session only.
    }
  }, [])
  const value = useMemo(() => ({ units, setUnits }), [units, setUnits])
  return <UnitsContext.Provider value={value}>{children}</UnitsContext.Provider>
}

export function useUnits(): UnitSystem {
  return useContext(UnitsContext).units
}

export function useSetUnits(): UnitsValue {
  return useContext(UnitsContext)
}
