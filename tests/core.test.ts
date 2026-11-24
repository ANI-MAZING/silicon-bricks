import { describe, expect, it } from 'vitest'
import { LonLat, makeFrame, polysArea, toLonLat, validatePlot, Pt, intersect, difference, inset, shrinkToArea, segmentStrip, union } from '../src/core/geo'
import { checkDesign } from '../src/core/designs'
import { ContextRoad } from '../src/core/context'
import { computeModel, ModelInput } from '../src/core/model'
import { estimateRoadWidth, resolveRules, ZONES, ZoneId, BuildingTypeId } from '../src/core/rules'
import { footprintAt } from '../src/core/envelope'

const frame = makeFrame(100.5655, 13.7578)
const ll = (pts: Pt[]): LonLat[] => pts.map((p) => toLonLat(frame, p))
const rect = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]

// A 24 m wide primary road whose south... north edge touches the plot's south edge (y = 0).
const road = (cy: number, highway = 'primary', name = 'Test Road'): ContextRoad => ({
  id: 1,
  name,
  highway,
  width: estimateRoadWidth(highway),
  line: ll([[-300, cy], [300, cy]]),
  bridge: false,
  tunnel: false,
})
const roads = [road(-12)]
const base = (over: Partial<ModelInput> = {}): ModelInput => ({ plot: ll(rect(0, 0, 40, 40)), zoneId: 'c3', typeId: 'condo', roadKey: 'auto', roadWidthOverride: null, ...over })
const run = (over: Partial<ModelInput> = {}, rs = roads) => computeModel(base(over), frame, rs)

describe('plot validation', () => {
  it('accepts a normal plot', () => {
    expect(validatePlot(rect(0, 0, 40, 40)).ok).toBe(true)
  })
  it('rejects fewer than 3 points', () => {
    expect(validatePlot([[0, 0], [1, 1]]).ok).toBe(false)
  })
  it('rejects a bow-tie (self-intersecting) plot', () => {
    const v = validatePlot([[0, 0], [40, 40], [40, 0], [0, 40]])
    expect(v.ok).toBe(false)
    expect(v.errors.join(' ')).toMatch(/crosses itself/)
  })
  it('rejects tiny and huge plots', () => {
    expect(validatePlot(rect(0, 0, 5, 5)).ok).toBe(false)
    expect(validatePlot(rect(0, 0, 400, 400)).ok).toBe(false)
  })
  it('rejects a plot that is too narrow to build on', () => {
    const v = validatePlot(rect(0, 0, 4, 100))
    expect(v.ok).toBe(false)
    expect(v.errors.join(' ')).toMatch(/narrower/)
  })
  it('accepts concave plots with a warning', () => {
    const v = validatePlot([[0, 0], [40, 0], [40, 40], [25, 40], [25, 15], [15, 15], [15, 40], [0, 40]])
    expect(v.ok).toBe(true)
    expect(v.concave).toBe(true)
  })
  it('handles clockwise input and duplicate points', () => {
    const v = validatePlot([[0, 0], [0, 0], [0, 40], [40, 40], [40, 0]])
    expect(v.ok).toBe(true)
    expect(v.area).toBeCloseTo(1600, 3)
  })
  it('handles NaN without throwing', () => {
    expect(() => validatePlot([[NaN, 0], [1, 1], [2, 2], [3, 0]])).not.toThrow()
  })
})

describe('rules', () => {
  it('computes max GFA from FAR and plot area', () => {
    const r = resolveRules({ zoneId: 'c3', typeId: 'condo', roadWidth: estimateRoadWidth('primary'), plotArea: 1600 })
    expect(r.maxGFA).toBeCloseTo(ZONES.c3.far.value * 1600, 6)
  })
  it('side setback grows with height bands', () => {
    const r = resolveRules({ zoneId: 'c3', typeId: 'condo', roadWidth: estimateRoadWidth('primary'), plotArea: 1600 })
    expect(r.sideSetback(6)).toBeLessThan(r.sideSetback(15))
    expect(r.sideSetback(15)).toBeLessThan(r.sideSetback(30))
  })
  it('front setback follows the sky plane once it exceeds the road setback', () => {
    const r = resolveRules({ zoneId: 'c3', typeId: 'condo', roadWidth: { ...estimateRoadWidth('primary'), value: 24 }, plotArea: 1600 })
    expect(r.frontSetback(10)).toBe(r.roadSetbackM)
    expect(r.frontSetback(100)).toBeCloseTo(100 / 2 - 24, 9)
  })
  it('a narrower road makes the envelope smaller at the same height', () => {
    const wide = footprintAt(rect(0, 0, 40, 40), ['front', 'side', 'side', 'side'], resolveRules({ zoneId: 'c3', typeId: 'condo', roadWidth: { ...estimateRoadWidth('primary'), value: 30 }, plotArea: 1600 }), 60)
    const narrow = footprintAt(rect(0, 0, 40, 40), ['front', 'side', 'side', 'side'], resolveRules({ zoneId: 'c3', typeId: 'condo', roadWidth: { ...estimateRoadWidth('primary'), value: 8 }, plotArea: 1600 }), 60)
    expect(polysArea(narrow)).toBeLessThan(polysArea(wide))
  })
})

describe('model: each rule visibly changes the envelope', () => {
  it('uses the sourced named zone profile', () => {
    expect(run().rules!.zone.id).toBe('c3')
    expect(run().rules!.osr).toBe(4.5)
  })
  it('FAR caps total plate area', () => {
    const m = run()
    expect(m.envelope!.totalArea).toBeLessThanOrEqual(m.rules!.maxGFA + 0.01)
  })
  it('building type changes floor height', () => {
    const a = run({ typeId: 'condo' }).envelope!
    const b = run({ typeId: 'office' }).envelope!
    expect(a.levels[0].z1).not.toBe(b.levels[0].z1)
  })
  it('road width override changes the envelope', () => {
    const a = run({ roadWidthOverride: 6 }).envelope!
    const b = run({ roadWidthOverride: 40 }).envelope!
    expect(a.levels.at(-1)!.geomArea).not.toBe(b.levels.at(-1)!.geomArea)
  })
  it('envelope plates never grow with height (monotone)', () => {
    const e = run().envelope!
    for (let i = 1; i < e.levels.length; i++) expect(e.levels[i].geomArea).toBeLessThanOrEqual(e.levels[i - 1].geomArea + 1e-6)
  })
})

describe('designs pass their own checklist', () => {
  const zones: ZoneId[] = ['c3']
  const types: BuildingTypeId[] = ['condo', 'office', 'hotel']
  const plots: [string, Pt[]][] = [
    ['square', rect(0, 0, 40, 40)],
    ['wide', rect(0, 0, 80, 25)],
    ['small', rect(0, 0, 18, 22)],
    ['L-shaped', [[0, 0], [60, 0], [60, 20], [25, 20], [25, 50], [0, 50]]],
    ['triangle', [[0, 0], [60, 0], [20, 40]]],
  ]
  for (const [pn, pts] of plots) {
    for (const z of zones) {
      for (const t of types) {
        it(`${pn} / ${z} / ${t}`, () => {
          const m = computeModel({ plot: ll(pts), zoneId: z, typeId: t, roadKey: 'auto', roadWidthOverride: null }, frame, roads)
          expect(m.validation.ok).toBe(true)
          for (const r of m.results) {
            const must = ['far', 'sum', 'coverage', 'osr', 'setback', 'sky', 'rescue']
            for (const c of r.checks.filter((c) => must.includes(c.id))) expect(c.pass, `${pn}/${z}/${t} design ${r.design.id} ${c.id}: ${c.actual} vs ${c.limit}`).toBe(true)
          }
        })
      }
    }
  }
  it('floor areas sum to totals, net + core = floor area, exactly in tenths', () => {
    const m = run()
    for (const r of m.results) {
      const d = r.design
      const sumT = d.floors.reduce((s, f) => s + Math.round(f.area * 10), 0)
      expect(sumT).toBe(Math.round(d.totalGFA * 10))
      for (const f of d.floors) expect(Math.round((f.net + f.core) * 10)).toBe(Math.round(f.area * 10))
      expect(Math.round((d.totalNet + d.totalCore) * 10)).toBe(sumT)
      expect(d.totalGFA).toBeLessThanOrEqual(m.rules!.maxGFA + 1e-6)
    }
  })
  it('at least two designs are produced for a normal plot', () => {
    expect(run().results.filter((r) => r.design.floors.length > 0).length).toBeGreaterThanOrEqual(2)
  })
  it('every floor plate lies inside the geometric envelope', () => {
    const m = run()
    for (const r of m.results) for (const f of r.design.floors) {
      const geom = footprintAt(m.plotLocal, m.edges!.roles, m.rules!, f.z1, {buildingHeight:r.design.height, extraLarge:r.design.totalGFA >= 10000})
      expect(polysArea(difference(f.polys, geom))).toBeLessThan(0.05)
      expect(polysArea(intersect(f.polys, geom))).toBeGreaterThan(f.area - 0.1)
    }
  })
  it('the checklist fails when a design is tampered with', () => {
    const m = run()
    const d = structuredClone(m.results[0].design)
    d.floors[0].area += 5 // area no longer matches the drawn shape or the totals
    const checks = checkDesign(d, { plot: m.plotLocal, roles: m.edges!.roles, rules: m.rules!, frontage: { length: m.edges!.frontLength, gapToRoadEdge: 0, hasRoad: true } })
    expect(checks.find((c) => c.id === 'sum')!.pass).toBe(false)
    const d2 = structuredClone(m.results[0].design)
    d2.totalGFA = m.rules!.maxGFA + 100
    const checks2 = checkDesign(d2, { plot: m.plotLocal, roles: m.edges!.roles, rules: m.rules!, frontage: { length: m.edges!.frontLength, gapToRoadEdge: 0, hasRoad: true } })
    expect(checks2.find((c) => c.id === 'far')!.pass).toBe(false)
  })
  it('a floor poked out past the setback fails the setback check', () => {
    const m = run()
    const d = structuredClone(m.results[0].design)
    d.floors[0].polys = [rect(0, 0, 40, 40)]
    const checks = checkDesign(d, { plot: m.plotLocal, roles: m.edges!.roles, rules: m.rules!, frontage: { length: m.edges!.frontLength, gapToRoadEdge: 0, hasRoad: true } })
    expect(checks.find((c) => c.id === 'setback')!.pass).toBe(false)
  })
})

describe('geometry primitives', () => {
  it('inset of a 40x40 square by 2 m is 36x36', () => {
    expect(polysArea(inset([rect(0, 0, 40, 40)], 2))).toBeCloseTo(1296, 1)
  })
  it('shrinkToArea hits the target area', () => {
    expect(polysArea(shrinkToArea([rect(0, 0, 40, 40)], 900))).toBeLessThanOrEqual(900)
    expect(polysArea(shrinkToArea([rect(0, 0, 40, 40)], 900))).toBeGreaterThan(895)
  })
  it('a front strip of 10 m removes 400 m² from a 40 m wide plot', () => {
    const fp = difference([rect(0, 0, 40, 40)], union(segmentStrip([0, 0], [40, 0], 10)))
    expect(polysArea(fp)).toBeCloseTo(1200, 1)
  })
  it('computes a full model in well under 100 ms', () => {
    const t = performance.now()
    for (let i = 0; i < 5; i++) run()
    expect((performance.now() - t) / 5).toBeLessThan(100)
  })
})

describe('bad inputs give a message, not a crash', () => {
  it('no road in range', () => {
    const m = run({}, [])
    expect(m.notices.some((n) => /No road/.test(n.text))).toBe(true)
    expect(m.results.every((r) => r.checks.find((c) => c.id === 'access')!.pass === false)).toBe(true)
  })
  it('wrong road key falls back with a notice', () => {
    const m = run({ roadKey: 'nope|primary' })
    expect(m.road).not.toBeNull()
    expect(m.notices.some((n) => /no longer within/.test(n.text))).toBe(true)
  })
  it('road far from the plot warns', () => {
    const m = run({}, [road(-60)])
    expect(m.notices.some((n) => /nearest edge/.test(n.text))).toBe(true)
  })
  it('self-intersecting plot returns an error and no results', () => {
    const m = run({ plot: ll([[0, 0], [40, 40], [40, 0], [0, 40]]) })
    expect(m.validation.ok).toBe(false)
    expect(m.results).toEqual([])
  })
  it('generated schemes respect the zone road-width cap on a 24 m road', () => {
    const m=run()
    expect(m.results.find(r=>r.design.id==='A')!.checks.find(c=>c.id==='road-width')!.pass).toBe(true)
  })
  it('rapid random edits never throw', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < 200; i++) {
      const n = 3 + Math.floor(rnd() * 6)
      const pts: Pt[] = Array.from({ length: n }, () => [rnd() * 120 - 20, rnd() * 120 - 20])
      expect(() => computeModel({ plot: ll(pts), zoneId: 'c3', typeId: (['condo', 'office', 'hotel'] as const)[i % 3], roadKey: 'auto', roadWidthOverride: i % 4 === 0 ? 3 + rnd() * 50 : null }, frame, roads)).not.toThrow()
    }
  })
})
