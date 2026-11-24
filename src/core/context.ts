// Site context from the baked OpenStreetMap extract (ODbL, © OpenStreetMap contributors).
import { Frame, LonLat, Pt, Ring, distToPolyline, dist, toLocal, bboxOf, pointInRing, segmentDistance } from './geo'
import { Fact, estimateRoadWidth } from './rules'
import type { EdgeRole } from './envelope'

export interface RawFeature {
  type: 'Feature'
  properties: Record<string, any>
  geometry: { type: 'Polygon'; coordinates: LonLat[][] } | { type: 'LineString'; coordinates: LonLat[] }
}
export interface RawContext {
  type: 'FeatureCollection'
  center: { lat: number; lon: number }
  attribution: string
  retrieved: string
  features: RawFeature[]
}

export const STUDY_BOUNDS = { west:100.5611, south:13.7536, east:100.5699, north:13.7620 }

export const DEFAULT_BUILDING_HEIGHT = 12 // m, where OSM has neither height nor levels
export const LEVEL_HEIGHT = 3.2

export interface ContextBuilding {
  id: number
  ring: LonLat[]
  height: number
  heightSource: 'height tag' | 'levels tag' | 'assumed'
}
export interface ContextRoad {
  id: number
  name: string
  highway: string
  width: Fact
  line: LonLat[]
  bridge: boolean
  tunnel: boolean
}

export function parseContext(raw: RawContext): { buildings: ContextBuilding[]; roads: ContextRoad[] } {
  const buildings: ContextBuilding[] = []
  const roads: ContextRoad[] = []
  for (const f of raw.features) {
    const p = f.properties
    if (p.kind === 'building' && f.geometry.type === 'Polygon') {
      const h = Number.isFinite(p.height) && p.height > 0 ? { v: p.height as number, s: 'height tag' as const } : Number.isFinite(p.levels) && p.levels > 0 ? { v: (p.levels as number) * LEVEL_HEIGHT, s: 'levels tag' as const } : { v: DEFAULT_BUILDING_HEIGHT, s: 'assumed' as const }
      buildings.push({ id: p.id, ring: f.geometry.coordinates[0].slice(0, -1) as LonLat[], height: h.v, heightSource: h.s })
    } else if (p.kind === 'road' && f.geometry.type === 'LineString') {
      roads.push({
        id: p.id,
        name: p.name || '',
        highway: p.highway,
        width: estimateRoadWidth(p.highway, p.width),
        line: f.geometry.coordinates as LonLat[],
        bridge: !!p.bridge && p.bridge !== 'no',
        tunnel: !!p.tunnel && p.tunnel !== 'no',
      })
    }
  }
  return { buildings, roads }
}

/** Classes that a plot can sensibly front. Footpaths, steps and slip roads are excluded. */
export const FRONTABLE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'service', 'living_street'])

export interface RoadOption {
  key: string // grouped by name + class so a road split into many OSM ways is one choice
  label: string
  name: string
  highway: string
  width: Fact
  ids: number[]
  lines: Pt[][] // local frame
  distance: number // m from plot
}

export function roadOptions(roads: ContextRoad[], frame: Frame, plot: Ring, maxDistance = 90): RoadOption[] {
  const groups = new Map<string, RoadOption>()
  const bounds=bboxOf(plot)
  for (const r of roads) {
    if (!FRONTABLE.has(r.highway) || r.tunnel || r.bridge) continue
    const line = r.line.map((p) => toLocal(frame, p))
    if(line.length<2)continue
    const roadBounds=bboxOf(line)
    const dx=Math.max(bounds.minX-roadBounds.maxX,roadBounds.minX-bounds.maxX,0)
    const dy=Math.max(bounds.minY-roadBounds.maxY,roadBounds.minY-bounds.maxY,0)
    if(Math.hypot(dx,dy)>maxDistance)continue
    let d=line.some(p=>pointInRing(p,plot)) ? 0 : Infinity
    for(let i=0;d>0 && i<plot.length;i++)for(let j=1;j<line.length;j++)
      d=Math.min(d,segmentDistance(plot[i],plot[(i+1)%plot.length],line[j-1],line[j]))
    if (d > maxDistance) continue
    const key = `${r.name || `(unnamed ${r.id})`}|${r.highway}`
    const g = groups.get(key)
    if (g) {
      g.ids.push(r.id)
      g.lines.push(line)
      g.distance = Math.min(g.distance, d)
      if (r.width.status === 'S') g.width = r.width
    } else {
      groups.set(key, {
        key,
        label: '',
        name: r.name || '(unnamed)',
        highway: r.highway,
        width: r.width,
        ids: [r.id],
        lines: [line],
        distance: d,
      })
    }
  }
  const out = [...groups.values()].sort((a, b) => a.distance - b.distance)
  for (const o of out) o.label = `${o.name} · ${o.highway} · ${o.distance.toFixed(0)} m away`
  return out
}

/** Distance from point to nearest part of a road option (m). */
export const distToRoad = (p: Pt, road: RoadOption) => Math.min(...road.lines.map((l) => distToPolyline(p, l)))

export interface EdgeAnalysis {
  roles: EdgeRole[]
  frontIndex: number // -1 when no road
  frontLength: number
  /** Distance from the front edge midpoint to the road centreline, minus half the road width. ~0 when the plot touches the road. */
  gapToRoadEdge: number
}

/** The edge closest to the chosen road is the front. All other edges are side/rear. */
export function classifyEdges(plot: Ring, road: RoadOption | null, roadWidth: number): EdgeAnalysis {
  const n = plot.length
  const roles: EdgeRole[] = new Array(n).fill('side')
  if (!road) return { roles, frontIndex: -1, frontLength: 0, gapToRoadEdge: Infinity }
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < n; i++) {
    const a = plot[i]
    const b = plot[(i + 1) % n]
    const mids: Pt[] = [0.25,0.5,0.75].map(t=>[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])])
    // An endpoint alone is shared by the adjacent edge. Sample along the edge
    // so a long perpendicular side cannot masquerade as road frontage.
    const d = mids.reduce((sum,m)=>sum+distToRoad(m,road),0)/mids.length
    // prefer longer edges when two edges are about equally close (corner plots)
    const score = d - Math.min(dist(a, b), 40) * 0.02
    if (score < bestD) {
      bestD = score
      best = i
    }
  }
  roles[best] = 'front'
  const a = plot[best]
  const b = plot[(best + 1) % n]
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  return { roles, frontIndex: best, frontLength: dist(a, b), gapToRoadEdge: Math.max(0, distToRoad(mid, road) - roadWidth / 2) }
}
