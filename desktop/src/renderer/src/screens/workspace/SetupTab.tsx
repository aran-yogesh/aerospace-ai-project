import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { api } from '@/lib/api'
import {
  errorTitle,
  fromDisplay,
  fromKelvin,
  inputText,
  kCountsText,
  PRESSURE_UNITS,
  qty,
  toDisplay,
  toKelvin,
  unitOf,
  type PressureUnit,
  type TempUnit
} from '@/lib/format'
import type { FluidInfo, FluidIn } from '@/lib/apiTypes'
import { useUnits } from '@/lib/units'
import { cn } from '@/lib/utils'
import { toSetupIn, useSolve } from '@/workspace/SolveContext'
import { FieldLabel, NativeSelect, NumberField, SourceTag } from './fields'

const GROUPS: FluidInfo['group'][] = ['CRYOGENIC', 'PROPELLANT', 'REFERENCE', 'CUSTOM']
const TEMP_UNITS = [
  { value: 'K', label: 'K' },
  { value: '°C', label: '°C' },
  { value: '°F', label: '°F' }
] as const satisfies readonly { value: TempUnit; label: string }[]
const P_UNITS = [
  { value: 'bar', label: 'bar' },
  { value: 'psi', label: 'psi' }
] as const satisfies readonly { value: PressureUnit; label: string }[]

const PROPS_ERROR: Record<string, string> = {
  not_liquid: 'Not liquid',
  out_of_range: 'Out of range',
  unknown_fluid: 'Unknown fluid',
  invalid_input: 'Invalid input'
}

function PropRow({
  label,
  value,
  unit,
  source,
  testId
}: {
  label: string
  value: string
  unit: string
  source: string | null | undefined
  testId: string
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5 py-1.5" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="mono-label text-text-muted">{label}</span>
        <span className="num text-text">
          {value} <span className="text-text-muted">{unit}</span>
        </span>
      </div>
      <div className="flex justify-end">
        <SourceTag source={source} />
      </div>
    </div>
  )
}

export function SetupTab(): React.JSX.Element {
  const u = useUnits()
  const s = useSolve()
  const [tUnit, setTUnit] = useState<TempUnit>(u === 'US' ? '°F' : '°C')
  const [pUnit, setPUnit] = useState<PressureUnit>(u === 'US' ? 'psi' : 'bar')
  const fluidsQ = useQuery({ queryKey: ['fluids'], queryFn: api.listFluids, staleTime: Infinity })
  const materialsQ = useQuery({
    queryKey: ['materials'],
    queryFn: api.listMaterials,
    staleTime: Infinity
  })

  const setup = s.setup
  if (!setup) {
    const err = s.setupError ?? fluidsQ.error
    return (
      <div className="px-3 py-3 text-body text-text-muted">
        {err ? (
          <span className="text-danger">Setup unavailable: {String(err.message)}</span>
        ) : (
          'Loading setup.'
        )}
      </div>
    )
  }

  const fluids = fluidsQ.data ?? []
  const fluid = setup.fluid
  const info = fluids.find((f) => f.name === fluid.name)
  const save = (patch: Partial<FluidIn> | { material_key: string }): void => {
    const base = toSetupIn(setup)
    if ('material_key' in patch) s.saveSetup({ ...base, material_key: patch.material_key })
    else s.saveSetup({ ...base, fluid: { ...base.fluid, ...patch } })
  }
  const custom = fluid.kind === 'custom'
  const err = setup.props_error
  const props = setup.props
  const confirmBlocked = err
    ? 'Fix the fluid state first'
    : !props
      ? 'Fluid properties not computed'
      : null

  const range =
    info?.t_min_k != null && info.t_max_k != null
      ? `Valid ${inputText(fromKelvin(info.t_min_k, tUnit))} – ${inputText(fromKelvin(info.t_max_k, tUnit))} ${tUnit}`
      : null

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto" data-testid="setup-tab">
      <div className="flex flex-col gap-4 border-b border-border px-3 py-3">
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="setup-fluid">Fluid</FieldLabel>
          <NativeSelect
            id="setup-fluid"
            data-testid="setup-fluid"
            value={fluid.name}
            onChange={(e) => {
              const next = fluids.find((f) => f.name === e.target.value)
              if (next) save({ kind: next.kind, name: next.name })
            }}
          >
            {info ? null : <option value={fluid.name}>{fluid.name}</option>}
            {GROUPS.map((g) => {
              const items = fluids.filter((f) => f.group === g)
              return items.length ? (
                <optgroup key={g} label={g}>
                  {items.map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.name}
                    </option>
                  ))}
                </optgroup>
              ) : null
            })}
          </NativeSelect>
        </div>

        {custom ? (
          <>
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="setup-density">
                Density · <span className="normal-case">{unitOf('density', u)}</span>
              </FieldLabel>
              <NumberField
                id="setup-density"
                data-testid="setup-density"
                value={
                  fluid.density_kg_m3 != null ? toDisplay('density', fluid.density_kg_m3, u) : null
                }
                onCommit={(n) => save({ density_kg_m3: fromDisplay('density', n, u) })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="setup-viscosity">
                Viscosity · <span className="normal-case">{unitOf('viscosity', u)}</span>
              </FieldLabel>
              <NumberField
                id="setup-viscosity"
                data-testid="setup-viscosity"
                value={
                  fluid.viscosity_pa_s != null
                    ? toDisplay('viscosity', fluid.viscosity_pa_s, u)
                    : null
                }
                onCommit={(n) => save({ viscosity_pa_s: fromDisplay('viscosity', n, u) })}
              />
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <FieldLabel htmlFor="setup-temperature">Temperature</FieldLabel>
                <SegmentedControl
                  label="Temperature unit"
                  value={tUnit}
                  onValueChange={setTUnit}
                  options={TEMP_UNITS}
                />
              </div>
              <NumberField
                id="setup-temperature"
                data-testid="setup-temperature"
                value={fluid.temperature_k != null ? fromKelvin(fluid.temperature_k, tUnit) : null}
                onCommit={(n) => save({ temperature_k: toKelvin(n, tUnit) })}
              />
              {range ? <span className="num text-label text-text-muted">{range}</span> : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <FieldLabel htmlFor="setup-pressure">Pressure</FieldLabel>
                <SegmentedControl
                  label="Pressure unit"
                  value={pUnit}
                  onValueChange={setPUnit}
                  options={P_UNITS}
                />
              </div>
              <NumberField
                id="setup-pressure"
                data-testid="setup-pressure"
                value={fluid.pressure_pa != null ? fluid.pressure_pa / PRESSURE_UNITS[pUnit] : null}
                onCommit={(n) => save({ pressure_pa: n * PRESSURE_UNITS[pUnit] })}
              />
            </div>
          </>
        )}

        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="setup-material">Material</FieldLabel>
          <NativeSelect
            id="setup-material"
            data-testid="setup-material"
            value={setup.material_key}
            onChange={(e) => save({ material_key: e.target.value })}
          >
            {(materialsQ.data?.items ?? []).map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="flex flex-col border-b border-border px-3 py-3" data-testid="setup-props">
        <span className="pb-1 mono-label text-text">Properties</span>
        {err ? (
          <div
            role="alert"
            data-testid="setup-error"
            className="mt-1 flex flex-col gap-1 border border-danger px-2 py-1.5"
          >
            <span className="mono-label text-danger">{PROPS_ERROR[err.error] ?? err.error}</span>
            {err.detail ? <p className="text-body text-danger">{err.detail}</p> : null}
          </div>
        ) : null}
        <PropRow
          label="Density"
          testId="prop-density"
          value={props ? qty('density', props.density_kg_m3.value, u, 4) : '—'}
          unit={unitOf('density', u)}
          source={props?.density_kg_m3.source}
        />
        <PropRow
          label="Viscosity"
          testId="prop-viscosity"
          value={props ? qty('viscosity', props.viscosity_pa_s.value, u, 4) : '—'}
          unit={unitOf('viscosity', u)}
          source={props?.viscosity_pa_s.source}
        />
        <PropRow
          label="Roughness"
          testId="prop-roughness"
          value={setup.roughness ? qty('roughness', setup.roughness.value, u) : '—'}
          unit={unitOf('roughness', u)}
          source={setup.roughness?.source}
        />
      </div>

      <div className="flex flex-col gap-2 px-3 py-3">
        <Button
          variant="secondary"
          data-testid="resolve"
          disabled={s.resolving}
          onClick={s.runResolve}
        >
          {s.resolving ? 'Resolving' : 'Resolve'}
        </Button>
        {s.resolved ? (
          <span
            data-testid="resolve-counts"
            className={cn(
              'mono-label tabular-nums',
              s.resolved.counts.missing > 0 ? 'text-danger' : 'text-text-muted'
            )}
          >
            {kCountsText(s.resolved.counts)}
          </span>
        ) : null}
        {s.resolveError ? (
          <p role="alert" className="text-body text-danger" data-testid="resolve-error">
            {s.resolveError.code === 'network_topology'
              ? 'Solving needs a single flow path. This system branches or has separate pieces.'
              : (s.resolveError.detail ?? errorTitle(s.resolveError.code))}
          </p>
        ) : null}
        <Button
          variant="primary"
          data-testid="review-confirm"
          disabled={confirmBlocked !== null || s.saving}
          onClick={s.openConfirm}
        >
          Review and confirm
        </Button>
        {confirmBlocked ? (
          <span className="mono-label text-text-muted">{confirmBlocked}</span>
        ) : null}
        {setup.latest_dataset ? (
          <span
            data-testid="setup-dataset"
            className={cn(
              'mono-label tabular-nums',
              setup.latest_dataset.stale ? 'text-warning' : 'text-text-muted'
            )}
          >
            Dataset {setup.latest_dataset.short_hash} ·{' '}
            {setup.latest_dataset.stale ? 'Setup changed · Reconfirm' : 'Confirmed'}
          </span>
        ) : null}
      </div>
    </div>
  )
}
