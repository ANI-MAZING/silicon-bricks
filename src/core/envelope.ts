// One metric geometry model: spatial capacity is independent of FAR allocation.
import { Ring, difference, intersect, polysArea, segmentStrip, shrinkToArea, union } from './geo'
import { HIGH_RISE_M, LARGE_BUILDING_M2, MAX_FLOORS, MIN_FLOOR_PLATE_M2, conceptAreaBudget, RuleSet } from './rules'
export type EdgeRole = 'front' | 'side'
export interface EnvLevel { k: number; z0: number; z1: number; geom: Ring[]; polys: Ring[]; area: number; geomArea: number; limitedBy: 'geometry' | 'coverage' | 'FAR' }
export interface Envelope {
  levels: EnvLevel[]
  /** All spatially usable plates, before spending the FAR budget. */
  capacityLevels: EnvLevel[]
  height: number; totalArea: number; topLimitedBy: 'FAR' | 'road area cap' | 'geometry' | 'floor cap'; geometricFloors: number
}
export function footprintAt(plot: Ring, roles: EdgeRole[], rules: RuleSet, h: number, opts: { sky?: boolean; buildingHeight?: number; extraLarge?: boolean } = {}): Ring[] {
  const buildingHeight = opts.extraLarge ? Math.max(HIGH_RISE_M.value, opts.buildingHeight ?? h) : opts.buildingHeight ?? h
  const strips = plot.flatMap((a, i) => {
    const front = roles[i] === 'front'
    const d = front
      ? opts.sky === false ? Math.max(rules.roadSetbackM, buildingHeight >= HIGH_RISE_M.value ? 6 : 0) : rules.frontSetback(h, buildingHeight)
      : rules.sideSetback(buildingHeight)
    return segmentStrip(a, plot[(i + 1) % plot.length], d)
  })
  return difference([plot], strips.length ? union(strips) : []).filter(r => r.length >= 3)
}
export function buildEnvelope(plot: Ring, roles: EdgeRole[], rules: RuleSet, options: { maxHeight?: number; lowRise?: boolean; extraLarge?: boolean } = {}): Envelope {
  const capacityLevels: EnvLevel[] = []
  const lowRise = options.lowRise ?? false
  // Candidate high-rise has 6 m on every floor. Low-rise gets a whole-building
  // 3 m opening-wall setback (or 2 m when the complete building is <=9 m).
  const maxHeight = options.maxHeight ?? MAX_FLOORS.value * rules.floorHeight
  const buildingHeight = lowRise ? Math.min(maxHeight, HIGH_RISE_M.value - 0.001) : HIGH_RISE_M.value
  const capArea = rules.maxCoverage * rules.plotArea
  let previous: Ring[] | null = null
  for (let k = 0; k < MAX_FLOORS.value; k++) {
    const z0 = k * rules.floorHeight; const z1 = (k + 1) * rules.floorHeight
    if (z1 > maxHeight + 1e-9) break
    const geom = footprintAt(plot, roles, rules, z1, { buildingHeight, extraLarge: options.extraLarge })
    const geomArea = polysArea(geom)
    if (geomArea < MIN_FLOOR_PLATE_M2) break
    let polys: Ring[] = previous ? intersect(geom, previous) : geom
    if (polysArea(polys) > capArea) polys = shrinkToArea(polys, capArea)
    const area = polysArea(polys)
    if (area < MIN_FLOOR_PLATE_M2) break
    capacityLevels.push({ k,z0,z1,geom,polys,area,geomArea,limitedBy:area < geomArea-0.01?'coverage':'geometry' })
    previous = polys
  }
  const levels: EnvLevel[] = []
  let remaining = conceptAreaBudget(rules)
  const areaReason = remaining < rules.maxGFA ? 'road area cap' : 'FAR'
  let topLimitedBy: Envelope['topLimitedBy'] = capacityLevels.length === MAX_FLOORS.value ? 'floor cap' : 'geometry'
  for (const lv of capacityLevels) {
    if (remaining < MIN_FLOOR_PLATE_M2) { topLimitedBy=areaReason; break }
    if (lv.area > remaining) {
      const polys = shrinkToArea(lv.polys, remaining)
      const area = polysArea(polys)
      if (area >= MIN_FLOOR_PLATE_M2) levels.push({ ...lv,polys,area,limitedBy:'FAR' })
      topLimitedBy=areaReason; break
    }
    levels.push(lv); remaining -= lv.area
  }
  // A nominal low-rise may itself become extra-large by area; rebuild its entire
  // footprint with MR33 clearances before any concept uses it.
  if (lowRise && !options.extraLarge && levels.reduce((s,l)=>s+l.area,0) >= LARGE_BUILDING_M2)
    return buildEnvelope(plot, roles, rules, { ...options, extraLarge:true })
  return { levels, capacityLevels, height:levels.at(-1)?.z1??0, totalArea:levels.reduce((s,l)=>s+l.area,0), topLimitedBy, geometricFloors:capacityLevels.length }
}
