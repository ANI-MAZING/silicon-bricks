import { create } from 'zustand'
import type { LonLat } from './core/geo'
import type { ModelInput } from './core/model'
import type { BuildingTypeId, ZoneId } from './core/rules'

// Demonstration boundary near the Rama 9 / Asok-Din Daeng intersection.
// This is not a cadastral boundary or a verified พ.3 parcel.
export const SAMPLE_PLOT: LonLat[] = [
  [100.565288, 13.755909],
  [100.564956, 13.755935],
  [100.564924, 13.755538],
  [100.565256, 13.755513],
]

export interface State {
  past: ModelInput[]
  future: ModelInput[]
  checkpoint: () => void
  undo: () => void
  redo: () => void
  plot: LonLat[]
  draft: LonLat[]
  drawing: boolean
  zoneId: ZoneId
  typeId: BuildingTypeId
  roadKey: string // 'auto' or a road option key
  roadWidthOverride: number | null
  designId: 'A' | 'B' | 'C'
  showEnvelope: boolean
  showDesign: boolean
  showBasemap: boolean
  view3d: boolean
  flyToken: number // bump to ask the map to frame the plot
  set: (p: Partial<State>) => void
  startDraw: () => void
  addDraftPoint: (p: LonLat) => void
  undoDraft: () => void
  cancelDraw: () => void
  finishDraw: () => void
  setVertex: (i: number, p: LonLat) => void
  insertVertex: (i: number, p: LonLat) => void
  removeVertex: (i: number) => void
  clearPlot: () => void
  useSample: () => void
}

const snapshot=(s:State):ModelInput=>({plot:s.plot,zoneId:s.zoneId,typeId:s.typeId,roadKey:s.roadKey,roadWidthOverride:s.roadWidthOverride})

export const useStore = create<State>((set, get) => ({
  past: [], future: [],
  checkpoint: () => set({past:[...get().past.slice(-29),snapshot(get())],future:[]}),
  undo: () => { const s=get(); if (!s.past.length) return; set({...s.past.at(-1)!,past:s.past.slice(0,-1),future:[snapshot(s),...s.future],drawing:false,draft:[]}) },
  redo: () => { const s=get(); if (!s.future.length) return; set({...s.future[0],past:[...s.past,snapshot(s)],future:s.future.slice(1),drawing:false,draft:[]}) },
  plot: [],
  draft: [],
  drawing: false,
  zoneId: 'c3',
  typeId: 'condo',
  roadKey: 'auto',
  roadWidthOverride: null,
  designId: 'A',
  showEnvelope: true,
  showDesign: true,
  showBasemap: false,
  view3d: true,
  flyToken: 0,
  set: (p) => set(p),
  startDraw: () => set({ drawing: true, draft: [] }),
  addDraftPoint: (p) => set({ draft: [...get().draft, p] }),
  undoDraft: () => set({ draft: get().draft.slice(0, -1) }),
  cancelDraw: () => set({ drawing: false, draft: [] }),
  finishDraw: () => {
    const d = get().draft
    // keep what the user drew even if it is too small; the model explains why it cannot be used
    if (d.length < 3) return
    get().checkpoint()
    set({ drawing: false, draft: [], plot: d, roadKey: 'auto', roadWidthOverride: null, flyToken: get().flyToken + 1 })
  },
  setVertex: (i, p) => set({ plot: get().plot.map((q, j) => (j === i ? p : q)) }),
  insertVertex: (i, p) => {
    const pl = get().plot
    set({ plot: [...pl.slice(0, i + 1), p, ...pl.slice(i + 1)] })
  },
  removeVertex: (i) => {
    const pl = get().plot
    if (pl.length > 3) { get().checkpoint(); set({ plot: pl.filter((_, j) => j !== i) }) }
  },
  clearPlot: () => { get().checkpoint(); set({ plot: [], draft: [], drawing: false, roadKey: 'auto', roadWidthOverride: null }) },
  useSample: () => { get().checkpoint(); set({ plot: SAMPLE_PLOT, draft: [], drawing: false, roadKey: 'auto', roadWidthOverride: null, flyToken: get().flyToken + 1 }) },
}))
