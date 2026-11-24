// Concept designs and their pass/fail checklists.
// A design is a stack of floor plates. The checklist is computed from the design's geometry,
// independently of the generator, so a generator bug shows up as a failed check.
import { Ring, difference, intersect, polysArea, segmentStrip, shrinkToArea, union } from './geo'
import { EdgeRole, Envelope, buildEnvelope, footprintAt } from './envelope'
import { HIGH_RISE_M, HIGH_RISE_SETBACK, LARGE_BUILDING_M2, conceptAreaBudget, MIN_FLOOR_PLATE_M2, MIN_FRONTAGE_HIGH_RISE, PODIUM_FLOORS, RuleSet, Status } from './rules'

export interface Floor {
  index: number
  z0: number
  z1: number
  use: string
  polys: Ring[]
  /** Reported areas in m², rounded down to 0.1. net + core === area exactly. */
  area: number
  net: number
  core: number
}

export interface Design {
  id: 'A' | 'B' | 'C'
  name: string
  blurb: string
  floors: Floor[]
  height: number
  totalGFA: number
  totalNet: number
  totalCore: number
  groundArea: number
}

export interface CheckItem {
  id: string
  label: string
  pass: boolean
  actual: string
  limit: string
  /** Weakest status among the rules the check relies on. */
  basis: Status
  detail?: string
}

export interface DesignResult {
  design: Design
  checks: CheckItem[]
  allPass: boolean
  envelope: { z0:number; z1:number; polys:Ring[] }[]
}

export const PODIUM_EFFICIENCY = 0.4 // assumption: retail share of podium floors; parking counts as core
const TOL_M2 = 0.05

const tenths = (m2: number) => Math.floor(m2 * 10 + 1e-6)

function makeFloor(index: number, z0: number, z1: number, use: string, polys: Ring[], eff: number): Floor {
  const aT = tenths(polysArea(polys))
  const nT = Math.round(aT * eff)
  return { index, z0, z1, use, polys, area: aT / 10, net: nT / 10, core: (aT - nT) / 10 }
}

function finish(id: Design['id'], name: string, blurb: string, floors: Floor[]): Design {
  const T = (f: (x: Floor) => number) => floors.reduce((s, x) => s + Math.round(f(x) * 10), 0) / 10
  return {
    id,
    name,
    blurb,
    floors,
    height: floors.length ? floors[floors.length - 1].z1 : 0,
    totalGFA: T((f) => f.area),
    totalNet: T((f) => f.net),
    totalCore: T((f) => f.core),
    groundArea: floors[0]?.area ?? 0,
  }
}

type PlateFn = (k: number, geomPolys: Ring[], envPolys: Ring[]) => { polys: Ring[]; use: string; eff: number } | null

/** Stack plates until the FAR budget is spent. The last plate shrinks to use the remainder. */
function stack(env: Envelope, rules: RuleSet, plate: PlateFn, maxLevels = Infinity): Floor[] {
  const floors: Floor[] = []
  let budgetT = tenths(rules.maxGFA) // integer tenths of m²
  for (const lv of env.capacityLevels) {
    if (floors.length >= maxLevels) break
    const p = plate(lv.k, lv.geom, lv.polys)
    if (!p || !p.polys.length) break
    let polys = p.polys
    let aT = tenths(polysArea(polys))
    if (aT > budgetT) {
      if (budgetT < MIN_FLOOR_PLATE_M2 * 10) break
      polys = shrinkToArea(polys, budgetT / 10 - 0.05)
      aT = tenths(polysArea(polys))
    }
    if (aT < MIN_FLOOR_PLATE_M2 * 10) break
    const f = makeFloor(lv.k, lv.z0, lv.z1, p.use, polys, p.eff)
    floors.push(f)
    budgetT -= Math.round(f.area * 10)
  }
  return floors
}

export function generateDesigns(env: Envelope, rules: RuleSet, site: { plot: Ring; roles: EdgeRole[]; frontage: number }): Design[] {
  const lowEnv = buildEnvelope(site.plot, site.roles, rules, { lowRise:true, maxHeight:HIGH_RISE_M.value - 0.001 })
  const designRules={...rules,maxGFA:conceptAreaBudget(rules)}
  const tallAllowed=rules.roadWidth.value>=10 && site.frontage>=12
  const tallEnv=tallAllowed && env.capacityLevels.length ? env : lowEnv
  const plotCap = rules.maxCoverage * rules.plotArea
  const tower = rules.type.towerUse
  const eff = rules.efficiency

  // A. Full envelope: every floor uses the whole allowed plate.
  const A = finish(
    'A',
    'Full envelope',
    'Broad floor plates spend the FAR budget efficiently. Whole-building setbacks apply to the podium as well as upper floors.',
    stack(tallEnv, designRules, (_k, _g, e) => ({ polys: e, use: tower, eff })),
  )

  // B. Podium + slim tower: wide low podium, narrower tower above.
  const P = PODIUM_FLOORS.value
  const B = finish(
    'B',
    'Podium and slim tower',
    `${P}-storey podium of parking and retail, then a tower that covers about 40% of the plot. Each concept spends its own FAR budget; the narrower tower can extend above concept A where the road height plane allows.`,
    stack(tallEnv, designRules, (k, _g, e) => {
      if (k < P) return { polys: shrinkToArea(e, plotCap), use: 'Parking & retail', eff: PODIUM_EFFICIENCY }
      return { polys: shrinkToArea(e, 0.4 * rules.plotArea), use: tower, eff }
    }),
  )

  // C. Low-rise: stays under the 23 m high-rise line, so the 6 m high-rise setback never applies.
  const C = finish(
    'C',
    'Low-rise under 23 m',
    'Stays below 23 m. If total area reaches 10,000 m², extra-large building access and 6 m setbacks still apply. Usually leaves FAR unused.',
    stack(lowEnv, designRules, (k, _g, e) => {
      if ((k + 1) * rules.floorHeight >= HIGH_RISE_M.value) return null
      return { polys: e, use: tower, eff }
    }),
  )
  return [A, B, C]
}

// ---------- checklist ----------
export interface CheckContext {
  plot: Ring
  roles: EdgeRole[]
  rules: RuleSet
  frontage: { length: number; gapToRoadEdge: number; hasRoad: boolean }
}

const worst = (...s: Status[]): Status => (['A', 'U', 'S', 'P'] as Status[]).find((x) => s.includes(x)) ?? 'P'
const m2 = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} m²`

export function checkDesign(d: Design, cx: CheckContext): CheckItem[] {
  const { rules, plot, roles } = cx
  const items: CheckItem[] = []
  const add = (c: CheckItem) => items.push(c)
  const sizeStatus = worst(rules.zone.far.status, rules.zone.osr.status)

  // 1. use permitted
  add({
    id: 'use',
    label: `${rules.type.name} scenario selected`,
    pass: rules.allowed.value,
    actual: rules.allowed.value ? 'Permitted' : 'Not permitted',
    limit: 'Permitted',
    basis: rules.allowed.status,
  })

  // 2. FAR
  add({
    id: 'far',
    label: 'Total floor area within FAR',
    pass: d.totalGFA <= rules.maxGFA + 1e-6,
    actual: m2(d.totalGFA),
    limit: `≤ ${m2(rules.maxGFA)} (FAR ${rules.far})`,
    basis: rules.zone.far.status,
    detail: `${((d.totalGFA / rules.maxGFA) * 100).toFixed(1)}% of the FAR allowance used`,
  })

  // 3. floor areas add up
  const sumFloors = d.floors.reduce((s, f) => s + Math.round(f.area * 10), 0)
  const sumParts = d.floors.reduce((s, f) => s + Math.round((f.net + f.core) * 10), 0)
  const geomOff = Math.max(0, ...d.floors.map((f) => Math.abs(polysArea(f.polys) - f.area)))
  const everyFloorAddsUp = d.floors.every(f => Math.round((f.net + f.core)*10) === Math.round(f.area*10))
  const addsUp = d.floors.length > 0 && everyFloorAddsUp && sumFloors === Math.round(d.totalGFA * 10) && sumParts === sumFloors && Math.round((d.totalNet + d.totalCore) * 10) === sumFloors && geomOff < 0.1 + 1e-6
  add({
    id: 'sum',
    label: 'Floor areas add up to the totals',
    pass: addsUp,
    actual: `${d.floors.length} floors = ${m2(sumFloors / 10)}; net ${m2(d.totalNet)} + core ${m2(d.totalCore)}`,
    limit: 'Sum of floors = total = net + core; each plate matches its drawn shape within 0.1 m²',
    basis: 'C',
  })

  // 4. ground coverage
  const ground = d.groundArea
  const covPct = (ground / rules.plotArea) * 100
  add({
    id: 'coverage',
    label: 'Ground coverage within limit',
    pass: ground <= rules.maxCoverage * rules.plotArea + 1e-6,
    actual: `${covPct.toFixed(1)}% (${m2(ground)})`,
    limit: `≤ ${(rules.maxCoverage * 100).toFixed(0)}% (${rules.coverageDriver} governs)`,
    basis: worst(sizeStatus, 'A'),
  })

  // 5. OSR: open ground = plot minus the footprint of every floor projected down
  const projected = d.floors.length ? union(d.floors.flatMap((f) => f.polys)) : []
  const open = rules.plotArea - polysArea(projected)
  const needOpen = (rules.osr / 100) * d.totalGFA
  add({
    id: 'osr',
    label: 'Open space ratio met',
    pass: open + 1e-6 >= needOpen,
    actual: `${m2(open)} open (${d.totalGFA > 0 ? ((open / d.totalGFA) * 100).toFixed(1) : '–'}% of GFA)`,
    limit: `≥ ${m2(needOpen)} (${rules.osr}% of GFA)`,
    basis: rules.zone.osr.status,
  })

  // 6. setbacks (no sky plane)
  let setbackOver = 0
  let skyOver = 0
  let rescueOver = 0
  const regulated = d.height >= HIGH_RISE_M.value || d.totalGFA >= LARGE_BUILDING_M2
  const sideStrips = plot.flatMap((a, i) => segmentStrip(a, plot[(i + 1) % plot.length], HIGH_RISE_SETBACK.value))
  const rescueZone = sideStrips.length ? union(sideStrips) : []
  for (const f of d.floors) {
    setbackOver = Math.max(setbackOver, polysArea(difference(f.polys, footprintAt(plot, roles, rules, f.z1, { sky: false, buildingHeight:d.height, extraLarge:regulated }))))
    skyOver = Math.max(skyOver, polysArea(difference(f.polys, footprintAt(plot, roles, rules, f.z1, { sky: true, buildingHeight:d.height, extraLarge:regulated }))))
    if (regulated) rescueOver = Math.max(rescueOver, polysArea(intersect(f.polys, rescueZone)))
  }
  add({
    id: 'setback',
    label: 'Setbacks from every boundary respected',
    pass: setbackOver <= TOL_M2,
    actual: setbackOver <= TOL_M2 ? 'All floors inside' : `${m2(setbackOver)} outside`,
    limit: `Road ${rules.roadSetbackM.toFixed(1)} m; side / rear ${regulated ? 6 : rules.sideSetback(d.height)} m for the whole building`,
    basis: 'P',
  })
  add({
    id: 'sky',
    label: 'Height under the road sky plane',
    pass: skyOver <= TOL_M2,
    actual: skyOver <= TOL_M2 ? `Top at ${d.height.toFixed(1)} m, all floors inside` : `${m2(skyOver)} above the plane`,
    limit: `Height ≤ 2 × distance to far side of a ${rules.roadWidth.value} m road`,
    basis: worst(rules.roadWidth.status, 'S'),
  })

  // 7. high-rise rules
  const highRise = regulated
  add({
    id: 'rescue',
    label: highRise ? '6 m setback around the entire regulated building' : 'High-rise / extra-large setback not triggered',
    pass: rescueOver <= TOL_M2,
    actual: highRise ? (rescueOver <= TOL_M2 ? 'All floors, including the podium, clear every boundary by 6 m' : `${m2(rescueOver)} inside the 6 m strip`) : `Height ${d.height.toFixed(1)} m`,
    limit: highRise ? '≥ 6 m from all plot boundaries' : 'n/a',
    basis: 'P',
  })
  const frontageOk = !highRise || (cx.frontage.hasRoad && cx.frontage.length >= MIN_FRONTAGE_HIGH_RISE.value)
  add({
    id: 'frontage',
    label: highRise ? 'Road frontage of at least 12 m' : 'Road frontage for high-rise (not needed under 23 m)',
    pass: frontageOk,
    actual: cx.frontage.hasRoad ? `${cx.frontage.length.toFixed(1)} m on the chosen road` : 'No road chosen',
    limit: highRise ? '≥ 12 m' : 'n/a',
    basis: MIN_FRONTAGE_HIGH_RISE.status,
    detail: 'MR33 clause 2. Public-road status and a continuous connection of sufficient width must still be confirmed.',
  })

  const accessWidth = highRise ? (d.totalGFA > 30000 ? 18 : 10) : 0
  const zoneWidth = rules.type.id === 'hotel' ? 16 : d.totalGFA > 10000 ? 30 : d.totalGFA > 5000 ? 16 : 0
  const needWidth = Math.max(accessWidth, zoneWidth)
  add({ id:'road-width', label:'Road width for this use and building size', pass:cx.frontage.hasRoad && rules.roadWidth.value >= needWidth,
    actual:`${rules.roadWidth.value.toFixed(1)} m assumed / entered right-of-way`, limit:`≥ ${needWidth} m`, basis:worst(rules.roadWidth.status,'P'),
    detail:'MR33 clause 2 and Bangkok 2013 plan clause 20(8), (9), (11). Transit exception is not used; hotel room count and road continuity are not verified.' })

  // 8. plot touches the road
  const touches = cx.frontage.hasRoad && cx.frontage.gapToRoadEdge <= 6
  add({
    id: 'access',
    label: 'Plot fronts the selected road',
    pass: touches,
    actual: cx.frontage.hasRoad ? `Front edge ${cx.frontage.gapToRoadEdge.toFixed(1)} m from the road edge` : 'No road chosen',
    limit: '≤ 6 m (plot boundary on or near the road edge)',
    basis: 'A',
  })

  return items
}

export function evaluate(designs: Design[], cx: CheckContext): DesignResult[] {
  return designs.map((design) => {
    const checks = checkDesign(design, cx)
    const envelope = design.floors.map(f=>({z0:f.z0,z1:f.z1,polys:footprintAt(cx.plot,cx.roles,cx.rules,f.z1,{buildingHeight:design.height,extraLarge:design.totalGFA>=LARGE_BUILDING_M2})}))
    return { design, checks, allPass: checks.every((c) => c.pass), envelope }
  })
}
