import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
// MapLibre 6 resolves its default worker relative to its module. Vite relocates
// the module, so the worker must be an explicit build asset in production.
maplibregl.setWorkerUrl(mapWorkerUrl)
maplibregl.setWorkerCount(2)
import { useStore } from '../store'
import type { Frame, LonLat, Ring } from '../core/geo'
import { segmentStrip, toLocal, toLonLat, toPolygons, union } from '../core/geo'
import { STUDY_BOUNDS, type ContextBuilding, type ContextRoad } from '../core/context'
import type { Model } from '../core/model'

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const closeLL = (r: LonLat[]): LonLat[] => (r.length ? [...r, r[0]] : r)

function polysFeatures(frame: Frame, polys: Ring[], props: Record<string, any>): GeoJSON.Feature[] {
  return toPolygons(polys).map((rings) => ({
    type: 'Feature',
    properties: props,
    geometry: { type: 'Polygon', coordinates: rings.map((r) => closeLL(r.map((p) => toLonLat(frame, p)))) },
  }))
}



interface Props {
  frame: Frame
  buildings: ContextBuilding[]
  roads: ContextRoad[]
  model: Model
}

export default function MapView({ frame, buildings, roads, model }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const readyRef = useRef(false)
  const modelRef = useRef(model)
  modelRef.current = model
  const s = useStore()
  const [basemapError, setBasemapError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [mapStatus, setMapStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  // ---------- one-time map setup ----------
  useEffect(() => {
    setMapStatus('loading')
    let map: maplibregl.Map
    try { map = new maplibregl.Map({
      container: el.current!,
      style: {
        version: 8,
        sources: {
          osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' },
        },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#e8edf1' } },
          { id: 'osm', type: 'raster', source: 'osm', layout: { visibility: 'none' }, paint: { 'raster-saturation': -0.6, 'raster-opacity': 0.9 } },
        ],
      },
      center: [frame.lon0, frame.lat0],
      zoom: 16.2,
      pitch: 55,
      bearing: -20,
      maxPitch: 80,
      minZoom: 13,
      attributionControl: { compact: true, customAttribution: 'Building & road data © OpenStreetMap contributors (ODbL)' },
    })
    } catch { setMapStatus('error'); return }
    map.on('error', (e) => {
      if ('sourceId' in e && e.sourceId === 'osm') setBasemapError(true)
      else if (!readyRef.current) setMapStatus('error')
    })
    const canvas = map.getCanvas()
    const lost = (e:Event) => { e.preventDefault(); setMapStatus('error') }
    canvas.addEventListener('webglcontextlost', lost)
    const resize = new ResizeObserver(() => map.resize())
    resize.observe(el.current!)
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
    // Optional read-only diagnostics for local release verification; no telemetry.
    if (import.meta.env.DEV || new URLSearchParams(location.search).has('diagnostics')) {
      let last=0
      const frameTimes:number[]=[]
      map.on('movestart',()=>{last=0;frameTimes.length=0})
      map.on('render',()=>{
        if (!map.isMoving()) return
        const now=performance.now()
        if(last)frameTimes.push(now-last)
        last=now
      })
      map.on('moveend',()=>{
        if(!frameTimes.length)return
        const data=map.getContainer().dataset
        data.frameAverageMs=(frameTimes.reduce((a,b)=>a+b,0)/frameTimes.length).toFixed(2)
        data.frameWorstMs=Math.max(...frameTimes).toFixed(2)
        data.frameCount=String(frameTimes.length)
      })
    }
    map.doubleClickZoom.disable() // double-click is used to finish drawing; zoom with wheel / pinch / +

    map.on('load', () => {
      const bData: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: buildings.map((b) => ({ type: 'Feature', properties: { h: b.height, known: b.heightSource !== 'assumed' }, geometry: { type: 'Polygon', coordinates: [closeLL(b.ring)] } })),
      }
      const rData: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: roads
          .filter((r) => !r.tunnel)
          .map((r) => ({ type: 'Feature', properties: { id:r.id, hw: r.highway, w: r.width.value, minor: ['footway', 'path', 'steps'].includes(r.highway) }, geometry: { type: 'LineString', coordinates: r.line } })),
      }
      const roadSurface = (r:ContextRoad, width:number):GeoJSON.Feature[] => {
        const line=r.line.map(p=>toLocal(frame,p))
        const strips=line.slice(1).flatMap((b,i)=>segmentStrip(line[i],b,width/2))
        return polysFeatures(frame,union(strips),{id:r.id})
      }
      const surfaces:GeoJSON.FeatureCollection={type:'FeatureCollection',features:roads.filter(r=>!r.tunnel && !['footway','path','steps'].includes(r.highway)).flatMap(r=>roadSurface(r,r.width.value))}
      map.addSource('road-surfaces',{type:'geojson',data:surfaces})
      map.addSource('road-selected-surface',{type:'geojson',data:EMPTY})
      map.addSource('ctx-roads', { type: 'geojson', data: rData })
      const {west,south,east,north}=STUDY_BOUNDS
      map.addSource('study-area',{type:'geojson',data:{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[west,south],[east,south],[east,north],[west,north],[west,south]]}}})
      map.addLayer({id:'study-area',type:'line',source:'study-area',paint:{'line-color':'#597087','line-width':2,'line-dasharray':[4,3]}})
      map.addSource('ctx-buildings', { type: 'geojson', data: bData })
      for (const id of ['plot', 'plot-edges', 'plot-front', 'plot-verts', 'plot-mids', 'draft', 'envelope', 'design', 'road-hl']) map.addSource(id, { type: 'geojson', data: EMPTY })

      map.addLayer({id:'roads-fill',type:'fill',source:'road-surfaces',paint:{'fill-color':'#ffffff','fill-outline-color':'#cbd5e1'}})
      map.addLayer({id:'roads-minor',type:'line',source:'ctx-roads',filter:['get','minor'],paint:{'line-color':'#cbd5e1','line-width':1,'line-dasharray':[2,2]}})
      map.addLayer({id:'road-selected-surface',type:'fill',source:'road-selected-surface',paint:{'fill-color':'#facc15','fill-opacity':0.45,'fill-outline-color':'#d49b12'}})

      map.addLayer({
        id: 'buildings',
        type: 'fill-extrusion',
        source: 'ctx-buildings',
        paint: { 'fill-extrusion-color': ['case', ['get', 'known'], '#c9d1d9', '#d9dee4'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.96 },
      })
      map.addLayer({ id: 'plot-fill', type: 'fill', source: 'plot', paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.14 } })
      map.addLayer({
        id: 'envelope',
        type: 'fill-extrusion',
        source: 'envelope',
        paint: { 'fill-extrusion-color': '#38bdf8', 'fill-extrusion-height': ['get', 'top'], 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-opacity': 0.18 },
      })
      map.addLayer({
        id: 'design',
        type: 'fill-extrusion',
        source: 'design',
        paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'top'], 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-opacity': 1 },
      }, 'envelope') // opaque design first, translucent envelope blends over it
      map.addLayer({ id: 'plot-edges', type: 'line', source: 'plot-edges', paint: { 'line-color': '#1d4ed8', 'line-width': 2.5 } })
      map.addLayer({ id: 'plot-front', type: 'line', source: 'plot-front', paint: { 'line-color': '#f59e0b', 'line-width': 4.5 } })
      map.addLayer({ id: 'draft-line', type: 'line', source: 'draft', filter: ['==', '$type', 'LineString'], paint: { 'line-color': '#2563eb', 'line-width': 2.5, 'line-dasharray': [2, 1.5] } })
      map.addLayer({ id: 'plot-mids', type: 'circle', source: 'plot-mids', paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-opacity': 0.8, 'circle-stroke-color': '#1d4ed8', 'circle-stroke-width': 1.2 } })
      map.addLayer({ id: 'plot-verts', type: 'circle', source: 'plot-verts', paint: { 'circle-radius': 7.5, 'circle-color': '#fff', 'circle-stroke-color': '#1d4ed8', 'circle-stroke-width': 3 } })
      map.addLayer({ id: 'draft-pts', type: 'circle', source: 'draft', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 6, 'circle-color': '#fff', 'circle-stroke-color': '#2563eb', 'circle-stroke-width': 3 } })

      try {
        map.setLight({ anchor: 'viewport', color: '#ffffff', intensity: 0.42, position: [1.4, 210, 50] })
      } catch {
        /* older style spec: ignore */
      }
      readyRef.current = true
      setMapStatus('ready')
      syncAll()
    })

    // ----- drawing and editing -----
    let dragIdx = -1
    const first = () => useStore.getState().draft[0]
    map.on('click', (e) => {
      const st = useStore.getState()
      if (!readyRef.current || !st.drawing) return
      const p: LonLat = [e.lngLat.lng, e.lngLat.lat]
      if (st.draft.length >= 3 && first()) {
        const px = map.project(first() as [number, number])
        if (Math.hypot(px.x - e.point.x, px.y - e.point.y) < 14) return st.finishDraw()
      }
      // Ignore the second click in a double-click; keep its first corner.
      if (e.originalEvent.detail > 1) return
      st.addDraftPoint(p)
    })
    map.on('dblclick', () => {
      const st = useStore.getState()
      if (st.drawing && st.draft.length >= 3) {
        st.finishDraw()
      }
    })
    map.on('mousemove', (e) => {
      const st = useStore.getState()
      if (st.drawing) {
        map.getCanvas().style.cursor = 'crosshair'
        const src = map.getSource('draft') as maplibregl.GeoJSONSource | undefined
        if (src && st.draft.length) src.setData(draftData(st.draft, [e.lngLat.lng, e.lngLat.lat]))
        return
      }
      if (dragIdx >= 0) return
      const hit = readyRef.current && map.queryRenderedFeatures(e.point, { layers: ['plot-verts', 'plot-mids'] }).length
      map.getCanvas().style.cursor = hit ? 'grab' : ''
    })
    const startDrag = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      if (!readyRef.current || useStore.getState().drawing) return
      const f = map.queryRenderedFeatures(e.point, { layers: ['plot-verts'] })[0]
      if (f) {
        useStore.getState().checkpoint()
        dragIdx = f.properties!.i
        map.dragPan.disable()
        map.getCanvas().style.cursor = 'grabbing'
        e.preventDefault()
        return
      }
      const m = map.queryRenderedFeatures(e.point, { layers: ['plot-mids'] })[0]
      if (m) {
        const i = m.properties!.i as number
        useStore.getState().checkpoint()
        useStore.getState().insertVertex(i, [e.lngLat.lng, e.lngLat.lat])
        dragIdx = i + 1
        map.dragPan.disable()
        e.preventDefault()
      }
    }
    let raf = 0
    let pending: LonLat | null = null
    const moveDrag = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      if (dragIdx < 0) return
      pending = [e.lngLat.lng, e.lngLat.lat]
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0
          if (pending && dragIdx >= 0) useStore.getState().setVertex(dragIdx, pending)
        })
    }
    const endDrag = () => {
      if (dragIdx < 0) return
      if (pending) useStore.getState().setVertex(dragIdx, pending)
      dragIdx = -1
      pending = null
      map.dragPan.enable()
      map.getCanvas().style.cursor = ''
    }
    map.on('mousedown', startDrag)
    map.on('touchstart', startDrag)
    map.on('mousemove', moveDrag)
    map.on('touchmove', moveDrag)
    map.on('mouseup', endDrag)
    map.on('touchend', endDrag)
    map.on('touchcancel', endDrag)
    window.addEventListener('mouseup',endDrag)
    window.addEventListener('blur',endDrag)
    map.on('contextmenu', (e) => {
      if (!readyRef.current || useStore.getState().drawing) return
      const f = map.queryRenderedFeatures(e.point, { layers: ['plot-verts'] })[0]
      if (f) useStore.getState().removeVertex(f.properties!.i)
    })
    const onKey = (ev: KeyboardEvent) => {
      const st = useStore.getState()
      if (st.drawing && ev.key === 'Escape') { ev.preventDefault(); st.cancelDraw(); return }
      if (!st.drawing || (ev.target instanceof HTMLElement && ev.target.closest('input, select, textarea, button, [contenteditable]'))) return
      if (ev.key === 'Escape') st.cancelDraw()
      else if (ev.key === 'Enter' && st.draft.length >= 3) st.finishDraw()
      else if (ev.key === 'Backspace') {
        ev.preventDefault()
        st.undoDraft()
      }
    }
    window.addEventListener('keydown', onKey)

    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mouseup',endDrag)
      window.removeEventListener('blur',endDrag)
      canvas.removeEventListener('webglcontextlost',lost)
      resize.disconnect()
      cancelAnimationFrame(raf)
      map.remove()
      mapRef.current = null
      readyRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retry])

  const draftData = (draft: LonLat[], cursor?: LonLat): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: [
      ...(draft.length > 1 || cursor ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: cursor ? [...draft, cursor] : draft } }] : []),
      ...draft.map((p) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: p } })),
    ],
  })

  // ---------- push state into sources ----------
  const syncAll = () => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const st = useStore.getState()
    const m = modelRef.current
    const set = (id: string, data: GeoJSON.FeatureCollection) => (map.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(data)

    // plot (always from the user's lon/lat so it follows the cursor exactly)
    const pl = st.plot
    set('plot', pl.length >= 3 ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [closeLL(pl)] } }] } : EMPTY)
    set('plot-edges', pl.length >= 3 ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: closeLL(pl) } }] } : EMPTY)
    set('plot-verts', { type: 'FeatureCollection', features: pl.map((p, i) => ({ type: 'Feature', properties: { i }, geometry: { type: 'Point', coordinates: p } })) })
    set('plot-mids', { type: 'FeatureCollection', features: pl.length >= 3 ? pl.map((p, i) => ({ type: 'Feature', properties: { i }, geometry: { type: 'Point', coordinates: [(p[0] + pl[(i + 1) % pl.length][0]) / 2, (p[1] + pl[(i + 1) % pl.length][1]) / 2] } })) : [] })
    set('draft', draftData(st.draft))

    // front edge highlight: model ring is cleaned/re-ordered, so draw from model geometry
    const e = m.edges
    if (e && e.frontIndex >= 0 && m.plotLocal.length) {
      const a = m.plotLocal[e.frontIndex]
      const b = m.plotLocal[(e.frontIndex + 1) % m.plotLocal.length]
      set('plot-front', { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [toLonLat(frame, a), toLonLat(frame, b)] } }] })
    } else set('plot-front', EMPTY)

    const roadPolys = m.road && m.roadWidth ? union(m.road.lines.flatMap(l=>l.slice(1).flatMap((b,i)=>segmentStrip(l[i],b,m.roadWidth!.value/2)))) : []
    set('road-selected-surface',{type:'FeatureCollection',features:polysFeatures(frame,roadPolys,{})})
    if (map.getLayer('roads-fill')) map.setFilter('roads-fill',m.road ? ['!', ['in',['get','id'],['literal',m.road.ids]]] : null)

    // envelope
    const feats: GeoJSON.Feature[] = []
    const selected = m.results.find(r=>r.design.id===st.designId) ?? m.results[0]
    if (selected && st.showEnvelope) for (const lv of selected.envelope) feats.push(...polysFeatures(frame, lv.polys, { base: lv.z0, top: lv.z1 }))
    set('envelope', { type: 'FeatureCollection', features: feats })

    // selected design, one slab per floor with a thin gap so floors read as floors
    const dfeats: GeoJSON.Feature[] = []
    const res = m.results.find((r) => r.design.id === st.designId) ?? m.results[0]
    if (res && st.showDesign) {
      for (const f of res.design.floors) {
        const podium = f.use.startsWith('Parking')
        const shade = f.index % 2 === 0
        const color = podium ? (shade ? '#8b9db3' : '#7f92a9') : f.use === 'Office' ? (shade ? '#3b82f6' : '#2f74e6') : f.use === 'Hotel rooms' ? (shade ? '#a855f7' : '#9a47ec') : shade ? '#f97316' : '#f0690a'
        dfeats.push(...polysFeatures(frame, f.polys, { base: f.z0 + 0.05, top: f.z1 - 0.12, color }))
      }
    }
    set('design', { type: 'FeatureCollection', features: dfeats })
    map.setLayoutProperty('osm', 'visibility', st.showBasemap ? 'visible' : 'none')
  }

  useEffect(syncAll, [model, s.plot, s.draft, s.designId, s.showEnvelope, s.showDesign, s.showBasemap])

  // camera
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const run = () => {
      const pl = useStore.getState().plot
      if (pl.length < 3) return
      const lon = pl.reduce((a, p) => a + p[0], 0) / pl.length
      const lat = pl.reduce((a, p) => a + p[1], 0) / pl.length
      map.flyTo({ center: [lon, lat], zoom: 17.4, pitch: useStore.getState().view3d ? 58 : 0, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 700 })
    }
    if (s.flyToken > 0) run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.flyToken,mapStatus])

  useEffect(() => {
    mapRef.current?.easeTo({ pitch: s.view3d ? 58 : 0, bearing: s.view3d ? mapRef.current.getBearing() : 0, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 400 })
  }, [s.view3d])

  return <>
    <div ref={el} className="map" data-testid="map" />
    {mapStatus !== 'ready' && <div className="map-status" role="status">{mapStatus === 'loading' ? 'Loading Bangkok map…' : '3D map unavailable. Check browser graphics support and try again.'}{mapStatus==='error' && <button onClick={()=>setRetry(r=>r+1)}>Retry map</button>}</div>}
    {basemapError && s.showBasemap && <div className="map-warning" role="status">Street tiles are unavailable. Buildings, roads and plot editing still work. <button onClick={()=>useStore.getState().set({showBasemap:false})}>Use local map</button></div>}
  </>
}
