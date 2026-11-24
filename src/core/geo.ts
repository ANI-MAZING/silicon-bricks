// Normalised geometry model. All geometry is in metres in a local tangent-plane frame
// (x = east, y = north). Convert to lon/lat only at the map boundary.
import { Clipper, FillRule } from 'clipper2-js'
import type { Paths64 } from 'clipper2-js'

export type Pt = [number, number]
/** A ring is an open list of vertices (first vertex is not repeated at the end). */
export type Ring = Pt[]
export type LonLat = [number, number]

export interface Frame {
  lon0: number
  lat0: number
  mx: number // metres per degree of longitude
  my: number // metres per degree of latitude
}

/** Local equirectangular frame. Error stays well under 0.1% for a few km around the origin. */
export function makeFrame(lon0: number, lat0: number): Frame {
  const rad = (lat0 * Math.PI) / 180
  return {
    lon0,
    lat0,
    mx: 111412.84 * Math.cos(rad) - 93.5 * Math.cos(3 * rad),
    my: 111132.92 - 559.82 * Math.cos(2 * rad),
  }
}
export const toLocal = (f: Frame, p: LonLat): Pt => [(p[0] - f.lon0) * f.mx, (p[1] - f.lat0) * f.my]
export const toLonLat = (f: Frame, p: Pt): LonLat => [f.lon0 + p[0] / f.mx, f.lat0 + p[1] / f.my]

// ---------- basic measures ----------
export function signedArea(r: Ring): number {
  let s = 0
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i]
    const [x2, y2] = r[(i + 1) % r.length]
    s += x1 * y2 - x2 * y1
  }
  return s / 2
}
export const ringArea = (r: Ring) => Math.abs(signedArea(r))
/** Sum of signed areas; with Clipper output (outer +, holes -) this is the true area. */
export const polysArea = (rs: Ring[]) => rs.reduce((a, r) => a + signedArea(r), 0)
export const ensureCCW = (r: Ring): Ring => (signedArea(r) < 0 ? [...r].reverse() : r)

export function perimeter(r: Ring): number {
  let s = 0
  for (let i = 0; i < r.length; i++) s += dist(r[i], r[(i + 1) % r.length])
  return s
}
export const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])

export function centroid(r: Ring): Pt {
  const a = signedArea(r)
  if (Math.abs(a) < 1e-9) return r.reduce((p, q) => [p[0] + q[0] / r.length, p[1] + q[1] / r.length] as Pt, [0, 0] as Pt)
  let cx = 0
  let cy = 0
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i]
    const [x2, y2] = r[(i + 1) % r.length]
    const f = x1 * y2 - x2 * y1
    cx += (x1 + x2) * f
    cy += (y1 + y2) * f
  }
  return [cx / (6 * a), cy / (6 * a)]
}

export function pointInRing(p: Pt, r: Ring): boolean {
  let inside = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i]
    const [xj, yj] = r[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  let t = l2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}
export function distToPolyline(p: Pt, line: Pt[]): number {
  let m = Infinity
  for (let i = 0; i < line.length - 1; i++) m = Math.min(m, distToSegment(p, line[i], line[i + 1]))
  return m
}

/** Exact minimum segment distance, including crossings and collinear contact. */
export function segmentDistance(a:Pt,b:Pt,c:Pt,d:Pt):number {
  return segIntersect(a,b,c,d) ? 0 : Math.min(distToSegment(a,c,d),distToSegment(b,c,d),distToSegment(c,a,b),distToSegment(d,a,b))
}

// ---------- validation ----------
function segIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const on = (p: Pt, q: Pt, r: Pt) =>
    Math.min(p[0], q[0]) - 1e-9 <= r[0] && r[0] <= Math.max(p[0], q[0]) + 1e-9 && Math.min(p[1], q[1]) - 1e-9 <= r[1] && r[1] <= Math.max(p[1], q[1]) + 1e-9
  const o1 = o(a, b, c)
  const o2 = o(a, b, d)
  const o3 = o(c, d, a)
  const o4 = o(c, d, b)
  if (o1 * o2 < 0 && o3 * o4 < 0) return true
  if (Math.abs(o1) < 1e-9 && on(a, b, c)) return true
  if (Math.abs(o2) < 1e-9 && on(a, b, d)) return true
  if (Math.abs(o3) < 1e-9 && on(c, d, a)) return true
  if (Math.abs(o4) < 1e-9 && on(c, d, b)) return true
  return false
}

export function selfIntersects(r: Ring): boolean {
  const n = r.length
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue
      if (segIntersect(r[i], r[(i + 1) % n], r[j], r[(j + 1) % n])) return true
    }
  }
  return false
}

export const LIMITS = {
  minAreaM2: 100, // below this, no sensible building
  maxAreaM2: 80000, // ~50 rai; beyond this the single-plot model is not meaningful
  minWidthM: 6, // narrower than this and the smallest setbacks leave nothing
  minVertexGapM: 0.3,
}

export interface PlotValidation {
  ok: boolean
  errors: string[]
  warnings: string[]
  ring: Ring // cleaned CCW ring (only meaningful when ok)
  area: number
  concave: boolean
}

/** Remove consecutive duplicates / near-duplicates and orient CCW. */
export function cleanRing(r: Ring): Ring {
  const out: Ring = []
  for (const p of r) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue
    const last = out[out.length - 1]
    if (!last || dist(last, p) >= LIMITS.minVertexGapM) out.push(p)
  }
  while (out.length > 1 && dist(out[0], out[out.length - 1]) < LIMITS.minVertexGapM) out.pop()
  return ensureCCW(out)
}

export function isConcave(r: Ring): boolean {
  let sign = 0
  for (let i = 0; i < r.length; i++) {
    const a = r[i]
    const b = r[(i + 1) % r.length]
    const c = r[(i + 2) % r.length]
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
    if (Math.abs(cr) < 1e-9) continue
    const s = Math.sign(cr)
    if (sign === 0) sign = s
    else if (s !== sign) return true
  }
  return false
}

export function validatePlot(raw: Ring): PlotValidation {
  const errors: string[] = []
  const warnings: string[] = []
  if (raw.some(p => !Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return { ok:false, errors:['A plot contains an invalid coordinate. Redraw the plot or load a valid project.'], warnings, ring:[], area:0, concave:false }
  if (raw.length > 100) return { ok:false, errors:['A plot can have at most 100 corners. Simplify its boundary.'], warnings, ring:[], area:0, concave:false }
  const ring = cleanRing(raw)
  if (ring.length < 3) {
    return { ok: false, errors: ['A plot needs at least 3 distinct corners.'], warnings, ring, area: 0, concave: false }
  }
  const area = ringArea(ring)
  if (selfIntersects(ring)) errors.push('The plot outline crosses itself. Drag a corner so the edges no longer cross.')
  if (area < LIMITS.minAreaM2) errors.push(`Plot is only ${area.toFixed(0)} m². The smallest plot supported is ${LIMITS.minAreaM2} m² (about 0.06 rai).`)
  if (area > LIMITS.maxAreaM2) errors.push(`Plot is ${(area / 1600).toFixed(0)} rai. Plots above ${(LIMITS.maxAreaM2 / 1600).toFixed(0)} rai are outside what this tool models.`)
  if (errors.length === 0) {
    // narrowness: if a 3 m inward offset leaves nothing, no building fits once the smallest setback applies
    const inner = inflate([ring], -LIMITS.minWidthM / 2)
    if (polysArea(inner) < 1) errors.push(`Plot is narrower than ${LIMITS.minWidthM} m at every point, so no building fits after setbacks.`)
  }
  const concave = errors.length === 0 && isConcave(ring)
  if (concave) warnings.push('Plot is concave (has an inward corner). Setbacks are applied edge by edge; check the corner by eye.')
  return { ok: errors.length === 0, errors, warnings, ring, area, concave }
}

// ---------- polygon boolean ops (Clipper2, integer millimetres) ----------
const S = 1000
const toP = (rs: Ring[]): Paths64 => rs.map((r) => r.map(([x, y]) => ({ x: Math.round(x * S), y: Math.round(y * S) }))) as unknown as Paths64
const fromP = (ps: Paths64): Ring[] =>
  (ps as unknown as { x: number; y: number }[][]).filter((p) => p.length >= 3).map((p) => p.map((q) => [q.x / S, q.y / S] as Pt))

export const intersect = (a: Ring[], b: Ring[]): Ring[] => (a.length && b.length ? fromP(Clipper.Intersect(toP(a), toP(b), FillRule.NonZero)) : [])
export const difference = (a: Ring[], b: Ring[]): Ring[] => (a.length ? (b.length ? fromP(Clipper.Difference(toP(a), toP(b), FillRule.NonZero)) : a) : [])
export const union = (a: Ring[], b: Ring[] = []): Ring[] => fromP(Clipper.Union(toP(a), b.length ? toP(b) : undefined, FillRule.NonZero))

/** Rectangle covering the region within `d` metres of segment a-b, ends extended by `d` (square caps). */
export function segmentStrip(a: Pt, b: Pt, d: number): Ring[] {
  if (d <= 0) return []
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (len < 1e-9) return []
  const ux = (b[0] - a[0]) / len
  const uy = (b[1] - a[1]) / len
  const nx = -uy
  const ny = ux
  const p0: Pt = [a[0] - ux * d + nx * d, a[1] - uy * d + ny * d]
  const p1: Pt = [b[0] + ux * d + nx * d, b[1] + uy * d + ny * d]
  const p2: Pt = [b[0] + ux * d - nx * d, b[1] + uy * d - ny * d]
  const p3: Pt = [a[0] - ux * d - nx * d, a[1] - uy * d - ny * d]
  return [[p3, p2, p1, p0]] // counter-clockwise
}

/**
 * Inset polygons by `d` metres: subtract a strip along every edge. Straight (mitre-like) corners,
 * works for concave outlines and polygons with holes. Written by hand because clipper2-js 1.2.4
 * returns wrong shapes from InflatePaths.
 */
export function inset(rs: Ring[], d: number): Ring[] {
  if (!rs.length) return []
  if (d <= 1e-6) return rs
  const strips: Ring[] = []
  for (const r of rs) for (let i = 0; i < r.length; i++) strips.push(...segmentStrip(r[i], r[(i + 1) % r.length], d))
  return difference(rs, union(strips))
}
/** Negative delta only. */
export const inflate = (rs: Ring[], delta: number): Ring[] => (delta < 0 ? inset(rs, -delta) : rs)

/** Shrink polygons inward until area <= target. Returns input if already small enough. */
export function shrinkToArea(rs: Ring[], target: number): Ring[] {
  const a0 = polysArea(rs)
  if (a0 <= target + 1e-6) return rs
  if (target <= 0) return []
  let lo = 0
  const box = bboxOf(rs.flat())
  let hi = Math.hypot(box.maxX - box.minX, box.maxY - box.minY)
  let best: Ring[] = []
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2
    const t = inflate(rs, -mid)
    const a = polysArea(t)
    if (a > target) lo = mid
    else {
      hi = mid
      best = t
    }
  }
  return best
}

/** Group Clipper output rings (outers positive, holes negative) into polygons with holes, for rendering. */
export function toPolygons(rs: Ring[]): Ring[][] {
  const outers = rs.filter((r) => signedArea(r) > 0).map((r) => [r])
  const holes = rs.filter((r) => signedArea(r) < 0)
  for (const h of holes) {
    const host = outers.find((o) => pointInRing(h[0], o[0]))
    if (host) host.push(h)
  }
  return outers
}

export const bboxOf = (r: Ring) => {
  const xs = r.map((p) => p[0])
  const ys = r.map((p) => p[1])
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}
