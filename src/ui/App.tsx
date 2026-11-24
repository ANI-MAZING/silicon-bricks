import { Component, ReactNode, Suspense, lazy, useEffect, useMemo, useState } from 'react'
import contextJson from '../data/context.json'
import { RawContext, parseContext } from '../core/context'
import { makeFrame } from '../core/geo'
import { Model } from '../core/model'
import { BUILDING_TYPES, BuildingTypeId, STATUS_LABEL, Status, ZONES, ZoneId } from '../core/rules'
import { useStore } from '../store'
import { useModel } from './useModel'
import ProjectActions from './ProjectActions'
const MapView = lazy(() => import('./MapView'))

const raw = contextJson as unknown as RawContext
const ctx = parseContext(raw)
const frame = makeFrame(raw.center.lon, raw.center.lat)

const n0 = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })
const n1 = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export function StatusBadge({ s }: { s: Status }) {
  return (
    <span className={`badge b-${s}`} title={STATUS_LABEL[s]}>
      {s === 'P' ? 'Primary' : s === 'S' ? 'Secondary' : s === 'U' ? 'Unverified' : s === 'C' ? 'Computed' : 'Assumed'}
    </span>
  )
}

class Boundary extends Component<{ children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null }
  static getDerivedStateFromError(e: Error) {
    return { err: e.message }
  }
  render() {
    if (this.state.err)
      return (
        <div className="fatal">
          <h2>Something went wrong</h2>
          <p>{this.state.err}</p>
          <button onClick={() => this.setState({ err: null })}>Try again</button>
        </div>
      )
    return this.props.children
  }
}

export default function App() {
  return (
    <Boundary>
      <Main />
    </Boundary>
  )
}

function Main() {
  const s = useStore()
  const input = useMemo(() => ({plot:s.plot,zoneId:s.zoneId,typeId:s.typeId,roadKey:s.roadKey,roadWidthOverride:s.roadWidthOverride}), [s.plot,s.zoneId,s.typeId,s.roadKey,s.roadWidthOverride])
  const {model,busy} = useModel(input,frame,ctx.roads)

  const result = model.results.find((r) => r.design.id === s.designId) ?? model.results[0]

  return (
    <div className="app">
      <aside className="side" aria-label="Plot controls and results">
        <header className="brand">
          <div className="logo">▦</div>
          <div>
            <span className="eyebrow">BANGKOK · FEASIBILITY STUDIO</span>
            <h1>Plot Envelope</h1>
            <p>From land boundary to building potential.</p>
          </div>
        </header>

        <div className="warnbar" role="note">
          <b>Preliminary scenario · พ.3 / 2013 plan.</b> Core figures are read from Thai legal text. Parcel zoning, current local overlays, road right-of-way and access are not verified. Model checks are not a permit approval.
        </div>

        <ProjectActions model={model} input={input} busy={busy} />
        <PlotPanel model={model} />
        <Inputs model={model} />
        {model.notices.length > 0 && (
          <ul className="notices" aria-live="polite">
            {model.notices.map((n, i) => (
              <li key={i} className={`n-${n.level}`}>
                {n.text}
              </li>
            ))}
          </ul>
        )}
        {model.rules && model.envelope && <Summary model={model} />}
        {model.rules && <Rules model={model} />}
        {model.results.length > 0 && result && <Designs model={model} />}
        <footer className="foot">
          Buildings and roads © OpenStreetMap contributors (ODbL), extract retrieved {raw.retrieved}. Heights where OSM has none are assumed ({12} m). Concept massing only, not legal advice.
        </footer>
      </aside>

      <main className="stage">
        <Suspense fallback={<div className="map-status" role="status">Preparing map…</div>}>
          <MapView frame={frame} buildings={ctx.buildings} roads={ctx.roads} model={model} />
        </Suspense>
        <div className={`scene-status ${busy ? 'updating' : ''}`} role="status">
          <i /> {busy ? 'Updating concepts…' : s.drawing ? 'Drawing a replacement · Cancel keeps your plot' : model.validation.ok ? `${n0(model.validation.area)} m² plot · ${model.results.length} concepts` : 'Rama 9 study area · draw inside dashed boundary'}
        </div>
        <Toolbar />
        {s.plot.length < 3 && !s.drawing && (
          <div className="empty">
            <h2>Start with a plot</h2>
            <p>Draw your plot on the map, or explore the Rama 9 sample. Compare three massing strategies against one named planning scenario.</p>
            <div className="row">
              <button className="primary" onClick={s.startDraw}>
                Draw a plot
              </button>
              <button onClick={s.useSample}>Use sample plot</button>
            </div>
          </div>
        )}
        {s.drawing && (
          <div className="drawbar" role="status">
            <span>
              {s.draft.length < 3 ? `Click the corners of your plot (${s.draft.length} placed, need 3).` : 'Click the first point, double-click, or press Enter to finish.'}
            </span>
            <button onClick={s.undoDraft} disabled={!s.draft.length}>
              Undo
            </button>
            <button className="primary" onClick={s.finishDraw} disabled={s.draft.length < 3}>
              Finish
            </button>
            <button onClick={s.cancelDraw}>Cancel</button>
          </div>
        )}
        {result && !s.drawing && <div className="scene-card" aria-label="Selected concept overview" aria-busy={busy}>
          <span className="eyebrow">CONCEPT {result.design.id} · {model.rules?.type.name}</span>
          <strong>{result.design.name}</strong>
          <div className="scene-numbers"><span><b>{n0(result.design.totalGFA)}</b> m² GFA</span><span><b>{n1(result.design.height)}</b> m high</span></div>
          <span className={`pill ${result.allPass?'ok':'bad'}`}>{result.allPass?'Model checks pass':`${result.checks.filter(c=>!c.pass).length} model checks fail`}</span>
          <div className="scene-switch" role="group" aria-label="Choose a concept on the map">{model.results.map(r=><button key={r.design.id} aria-label={`Show concept ${r.design.id}`} aria-pressed={r.design.id===result.design.id} onClick={()=>s.set({designId:r.design.id})}>{r.design.id}</button>)}</div>
        </div>}
        <Legend />
      </main>
    </div>
  )
}

function Toolbar() {
  const s = useStore()
  return (
    <div className="toolbar" role="toolbar" aria-label="Map tools">
      <button className={s.drawing ? 'on' : ''} onClick={s.drawing ? s.cancelDraw : s.startDraw}>
        {s.drawing ? 'Cancel' : s.plot.length ? 'Redraw' : 'Draw plot'}
      </button>
      <button onClick={s.useSample}>Sample</button>
      <button onClick={s.undo} disabled={!s.past.length || s.drawing} title="Undo plot edit">Undo</button>
      <button onClick={s.redo} disabled={!s.future.length || s.drawing} title="Redo plot edit">Redo</button>
      <button onClick={() => s.set({flyToken:s.flyToken+1})} disabled={!s.plot.length}>Fit plot</button>
      <button onClick={s.clearPlot} disabled={!s.plot.length && !s.draft.length}>
        Clear
      </button>
      <span className="sep" />
      <button className={s.view3d ? 'on' : ''} aria-pressed={s.view3d} onClick={() => s.set({ view3d: !s.view3d })} title="Toggle 3D tilt">
        {s.view3d ? '3D' : '2D'}
      </button>
      <label className="chk">
        <input type="checkbox" checked={s.showEnvelope} onChange={(e) => s.set({ showEnvelope: e.target.checked })} /> Envelope
      </label>
      <label className="chk">
        <input type="checkbox" checked={s.showDesign} onChange={(e) => s.set({ showDesign: e.target.checked })} /> Design
      </label>
      <label className="chk">
        <input type="checkbox" checked={s.showBasemap} onChange={(e) => s.set({ showBasemap: e.target.checked })} /> Street map
      </label>
    </div>
  )
}

function Legend() {
  return (
    <div className="legend" aria-hidden>
      <span>
        <i style={{ background: '#38bdf8', opacity: 0.5 }} /> Setback envelope
      </span>
      <span>
        <i style={{ background: '#f97316' }} /> Design
      </span>
      <span>
        <i style={{ background: '#f59e0b' }} /> Road-facing edge
      </span>
      <span>
        <i style={{ background: '#c9d1d9' }} /> Existing buildings
      </span>
    </div>
  )
}

function PlotPanel({ model }: { model: Model }) {
  const s = useStore()
  const v = model.validation
  const has = s.plot.length >= 3
  return (
    <section className="card">
      <h2>1 · Site boundary</h2>
      {!has ? (
        <p className="muted">No plot yet. Use <b>Draw plot</b> on the map. Drag corners to reshape, drag the small circles to add corners, right-click a corner to remove it.</p>
      ) : (
        <dl className="kv">
          <div>
            <dt>Area</dt>
            <dd>{v.area ? `${n0(v.area)} m² · ${n1(v.area / 1600)} rai` : '–'}</dd>
          </div>
          <div>
            <dt>Corners</dt>
            <dd>{s.plot.length}</dd>
          </div>
          <div>
            <dt>Road frontage</dt>
            <dd>{model.edges && model.edges.frontIndex >= 0 ? `${n1(model.edges.frontLength)} m` : '–'}</dd>
          </div>
        </dl>
      )}
    </section>
  )
}

function Inputs({ model }: { model: Model }) {
  const s = useStore()
  const rw = model.roadWidth
  const estimated = rw && rw.status !== 'S' && s.roadWidthOverride == null
  return (
    <section className="card">
      <h2>2 · Planning scenario</h2>
      <label className="field">
        <span>Zone scenario · selected, not detected</span>
        <select value={s.zoneId} onChange={(e) => s.set({ zoneId: e.target.value as ZoneId })}>
          {Object.values(ZONES).map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">One named zone: พ.3. Confirm the parcel’s official zone and current overlays separately. No FAR bonuses or transit exceptions are claimed.</p>
      <label className="field">
        <span>Building type</span>
        <select value={s.typeId} onChange={(e) => s.set({ typeId: e.target.value as BuildingTypeId })}>
          {Object.values(BUILDING_TYPES).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Road it faces</span>
        <select value={s.roadKey === 'auto' || model.roads.some(r=>r.key===s.roadKey) ? s.roadKey : 'auto'} onChange={(e) => s.set({ roadKey: e.target.value, roadWidthOverride: null })} disabled={!model.roads.length}>
          <option value="auto">{model.roads.length ? `Nearest road (${model.roads[0].name})` : s.plot.length < 3 ? 'Draw a plot to find nearby roads' : 'No road within 90 m'}</option>
          {model.roads.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      {model.road && rw && (
        <div className="field">
          <span>
            Road width <StatusBadge s={s.roadWidthOverride != null ? 'A' : rw.status} />
          </span>
          <div className="rowg">
            <input type="range" min={2} max={80} step={0.5} value={rw.value} onChange={(e) => s.set({ roadWidthOverride: +e.target.value })} aria-label="Road width in metres" />
            <RoadWidthInput value={rw.value} /> m
          </div>
          <small className="muted">
            {estimated ? 'Estimated from the OSM road class. Real right-of-way widths are not in OSM. Drag to correct it.' : s.roadWidthOverride != null ? 'Set by you.' : 'From the OSM width tag.'}{' '}
            {s.roadWidthOverride != null && <button className="link" onClick={() => s.set({ roadWidthOverride: null })}>Reset</button>}
          </small>
        </div>
      )}
    </section>
  )
}

function RoadWidthInput({value}:{value:number}) {
  const [text,setText]=useState(String(value))
  useEffect(()=>setText(String(value)),[value])
  const commit=()=>{
    const n=Number(text)
    if(text.trim()!=='' && Number.isFinite(n) && n>=2 && n<=80) useStore.getState().set({roadWidthOverride:n})
    else setText(String(value))
  }
  return <input className="num" type="number" min={2} max={80} step={0.5} value={text} aria-label="Road width number"
    onChange={e=>{const v=e.target.value;setText(v);const n=Number(v);if(v!=='' && Number.isFinite(n) && n>=2 && n<=80)useStore.getState().set({roadWidthOverride:n})}}
    onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}} />
}

function Summary({ model }: { model: Model }) {
  const r = model.rules!
  const e = model.envelope!
  const lastFloor = e.levels.length
  return (
    <section className="card">
      <h2>3 · Capacity snapshot</h2>
      <div className="kpis">
        <div>
          <b>{n0(r.maxGFA)} m²</b>
          <span>Max floor area (FAR {r.far})</span>
        </div>
        <div>
          <b>{n1(e.height)} m</b>
          <span>
            Broad concept · {lastFloor} floors
          </span>
        </div>
        <div>
          <b>{(r.maxCoverage * 100).toFixed(0)} %</b>
          <span>Scenario ground coverage ({r.coverageDriver})</span>
        </div>
      </div>
      <p className="muted small">FAR limits total floor area, not a unique maximum height. The blue setback envelope follows the selected concept’s height and building class. Area budgets apply to the concept inside it.</p>
      <p className="muted small">
        {e.topLimitedBy === 'road area cap'
          ? `The broad concept stops at floor ${lastFloor} at the road-conditioned floor-area cap. A wider verified right-of-way may allow more area.`
          : e.topLimitedBy === 'FAR'
          ? `The broad concept stops at floor ${lastFloor} because FAR is used up. Its spatial clearance alone allows ${e.geometricFloors} floors.`
          : e.topLimitedBy === 'geometry'
            ? `The broad concept stops at floor ${lastFloor} because setbacks and the road sky plane leave no usable plate above it. FAR would allow more area.`
            : 'The broad concept reaches the 70-floor model cap.'}
      </p>
    </section>
  )
}

function Rules({ model }: { model: Model }) {
  const [open, setOpen] = useState(false)
  const r = model.rules!
  return (
    <section className="card">
      <h2 className="tog">
        <button className="link h" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? '▾' : '▸'} Rules applied, with sources
        </button>
      </h2>
      <ul className="rules">
        {(open ? r.lines : r.lines.slice(0, 4)).map((l) => (
          <li key={l.id}>
            <div className="rl">
              <span>{l.label}</span>
              <StatusBadge s={l.status} />
            </div>
            <div className="rv">{l.value}</div>
            {open && (
              <>
                <div className="effect">Effect: {l.effect}</div>
                <div className="src">
                  Source: {l.url ? <a href={l.url} target="_blank" rel="noreferrer">{l.source}</a> : l.source}
                  {l.note ? ` — ${l.note}` : ''}
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      {!open && <button className="link" onClick={() => setOpen(true)}>Show all {r.lines.length} rules, sources and assumptions</button>}
    </section>
  )
}

function Designs({ model }: { model: Model }) {
  const s = useStore()
  const [all, setAll] = useState(false)
  const rules = model.rules!
  const cur = model.results.find((r) => r.design.id === s.designId) ?? model.results[0]
  const d = cur.design
  const rows = all ? d.floors : d.floors.slice(0, 8)
  return (
    <section className="card">
      <h2>4 · Compare concepts</h2>
      <div className="tablewrap comparison"><table aria-label="Concept comparison">
        <thead><tr><th>Concept</th><th className="r">GFA m²</th><th className="r">Height</th><th>Model checks</th></tr></thead>
        <tbody>{model.results.map(r=><tr key={r.design.id} className={r.design.id===d.id?'selected':''}>
          <td><button className="concept-pick" aria-pressed={r.design.id===d.id} onClick={()=>s.set({designId:r.design.id})}>{r.design.id} · {r.design.name}</button></td>
          <td className="r">{n0(r.design.totalGFA)}</td><td className="r">{n1(r.design.height)} m</td><td><span className={`pill ${r.allPass?'ok':'bad'}`}>{r.allPass?'Pass':`${r.checks.filter(c=>!c.pass).length} fail`}</span></td>
        </tr>)}</tbody>
      </table></div>
      <div className="tabs" role="group" aria-label="Concept designs">
        {model.results.map((r) => (
          <button key={r.design.id} aria-pressed={r.design.id === cur.design.id} className={r.design.id === cur.design.id ? 'on' : ''} onClick={() => s.set({ designId: r.design.id })}>
            <b>{r.design.id}</b> {r.design.name}
            <span className={`pill ${r.allPass ? 'ok' : 'bad'}`}>{r.checks.filter((c) => c.pass).length}/{r.checks.length}</span>
          </button>
        ))}
      </div>
      <p className="muted small">{d.blurb}</p>
      <div className="kpis">
        <div>
          <b>{n1(d.totalGFA)} m²</b>
          <span>{((d.totalGFA / rules.maxGFA) * 100).toFixed(0)}% of FAR used</span>
        </div>
        <div>
          <b>{d.floors.length}</b>
          <span>floors · {n1(d.height)} m</span>
        </div>
        <div>
          <b>{n1(d.totalNet)} m²</b>
          <span>net {rules.type.id === 'condo' ? 'saleable' : 'lettable'}</span>
        </div>
      </div>

      <h3>Model checklist {cur.allPass ? <span className="pill ok">All model checks pass</span> : <span className="pill bad">{cur.checks.filter((c) => !c.pass).length} failing</span>}</h3>
      <p className="muted small">A pass means this scenario’s implemented constraints pass. Parcel zoning, road continuity, fire access engineering and permit approval remain unverified.</p>
      <details key={`${d.id}-${cur.allPass}`} className="check-details" open={!cur.allPass}>
      <summary>{cur.checks.length} checks · {cur.checks.filter(c=>!c.pass).length} failing · inspect evidence</summary>
      <ul className="checks">
        {cur.checks.map((c) => (
          <li key={c.id} className={c.pass ? 'pass' : 'fail'}>
            <span className="ic" aria-label={c.pass ? 'pass' : 'fail'}>{c.pass ? '✓' : '✕'}</span>
            <div>
              <div className="cl">
                {c.label} <StatusBadge s={c.basis} />
              </div>
              <div className="ca">{c.actual}</div>
              <div className="cm">Limit: {c.limit}</div>
              {c.detail && <div className="cm">{c.detail}</div>}
            </div>
          </li>
        ))}
      </ul>

      </details>
      <div className="open-space"><span>Open ground <b>{n0(rules.plotArea-d.groundArea)} m²</b></span><span>Min. permeable planting reservation <b>{n0(0.5*rules.osr/100*d.totalGFA)} m²</b></span></div>
      <h3>Floor schedule</h3>
      <div className="tablewrap">
        <table aria-label="Selected concept floor areas">
          <thead>
            <tr>
              <th>Floor</th>
              <th>Use</th>
              <th className="r">GFA m²</th>
              <th className="r">Net</th>
              <th className="r">Core</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.index}>
                <td>{f.index + 1}</td>
                <td>{f.use}</td>
                <td className="r">{n1(f.area)}</td>
                <td className="r">{n1(f.net)}</td>
                <td className="r">{n1(f.core)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>Total, {d.floors.length} floors</td>
              <td className="r">{n1(d.totalGFA)}</td>
              <td className="r">{n1(d.totalNet)}</td>
              <td className="r">{n1(d.totalCore)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {d.floors.length > 8 && (
        <button className="link" onClick={() => setAll(!all)}>
          {all ? 'Show fewer floors' : `Show all ${d.floors.length} floors`}
        </button>
      )}
      <p className="muted small">Net + core = GFA on every row. Parking is counted in GFA (conservative); real FAR exemptions are not modelled.</p>
    </section>
  )
}
