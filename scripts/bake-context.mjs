// Bakes OSM buildings + roads for the demo area into static GeoJSON (ODbL, (c) OpenStreetMap contributors).
import { writeFileSync, mkdirSync } from 'node:fs'
const CENTER = { lat: 13.7578, lon: 100.5655 } // Phra Ram 9 area
const R = { dLat: 0.0042, dLon: 0.0044 }
const bbox = [CENTER.lat - R.dLat, CENTER.lon - R.dLon, CENTER.lat + R.dLat, CENTER.lon + R.dLon].join(',')
const q = `[out:json][timeout:90];(way[building](${bbox});way[highway](${bbox}););out geom tags;`
const mirrors = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
let data
for (let attempt = 0; attempt < 6 && !data; attempt++) {
  for (const m of mirrors) {
    try {
      const res = await fetch(m, { method: 'POST', headers: { 'User-Agent': 'plot-envelope-assessment/0.1', Accept: '*/*', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(100000) })
      if (!res.ok) { console.log(m, res.status); continue }
      data = await res.json(); console.log('ok', m, data.elements.length); break
    } catch (e) { console.log(m, String(e).slice(0, 80)) }
  }
  if (!data) await new Promise(r => setTimeout(r, 4000 * (attempt + 1)))
}
if (!data) { console.error('failed'); process.exit(1) }
const feats = []
for (const e of data.elements) {
  if (e.type !== 'way' || !e.geometry) continue
  const coords = e.geometry.map(p => [p.lon, p.lat])
  const t = e.tags || {}
  if (t.building) {
    if (coords.length < 4) continue
    feats.push({ type: 'Feature', properties: { kind: 'building', id: e.id, height: t.height ? parseFloat(t.height) : undefined, levels: t['building:levels'] ? parseFloat(t['building:levels']) : undefined, name: t.name }, geometry: { type: 'Polygon', coordinates: [coords] } })
  } else if (t.highway) {
    const w = t.width ? parseFloat(t.width) : undefined
    feats.push({ type: 'Feature', properties: { kind: 'road', id: e.id, highway: t.highway, name: t.name, width: w, lanes: t.lanes ? parseInt(t.lanes) : undefined, bridge: t.bridge, tunnel: t.tunnel, layer: t.layer }, geometry: { type: 'LineString', coordinates: coords } })
  }
}
mkdirSync('src/data', { recursive: true })
writeFileSync('src/data/context.json', JSON.stringify({ type: 'FeatureCollection', center: CENTER, attribution: '© OpenStreetMap contributors (ODbL)', retrieved: new Date().toISOString().slice(0, 10), features: feats }))
const b = feats.filter(f => f.properties.kind === 'building')
console.log('buildings', b.length, 'with height', b.filter(f => f.properties.height).length, 'with levels', b.filter(f => f.properties.levels).length, 'roads', feats.length - b.length)
