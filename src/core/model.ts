// One pure function from user inputs to everything the UI shows. No DOM, no map.
import { Frame, LonLat, Ring, toLocal, validatePlot, PlotValidation } from './geo'
import { STUDY_BOUNDS, ContextRoad, RoadOption, classifyEdges, roadOptions, EdgeAnalysis } from './context'
import { BuildingTypeId, Fact, RuleSet, ZoneId, conceptAreaBudget, resolveRules } from './rules'
import { Envelope, buildEnvelope } from './envelope'
import { DesignResult, evaluate, generateDesigns } from './designs'

export interface ModelInput {
  plot: LonLat[] // drawn plot, lon/lat
  zoneId: ZoneId
  typeId: BuildingTypeId
  roadKey: string | 'auto'
  roadWidthOverride: number | null
}

export interface Model {
  validation: PlotValidation
  notices: { level: 'error' | 'warn' | 'info'; text: string }[]
  plotLocal: Ring
  roads: RoadOption[]
  road: RoadOption | null
  roadWidth: Fact | null
  edges: EdgeAnalysis | null
  rules: RuleSet | null
  envelope: Envelope | null
  results: DesignResult[]
}

export const EMPTY_MODEL: Model = {
  validation: { ok: false, errors: [], warnings: [], ring: [], area: 0, concave: false },
  notices: [],
  plotLocal: [],
  roads: [],
  road: null,
  roadWidth: null,
  edges: null,
  rules: null,
  envelope: null,
  results: [],
}

export function computeModel(inp: ModelInput, frame: Frame, roadsRaw: ContextRoad[]): Model {
  const local: Ring = inp.plot.map((p) => toLocal(frame, p))
  const validation = validatePlot(local)
  const notices: Model['notices'] = []
  for (const e of validation.errors) notices.push({ level: 'error', text: e })
  for (const w of validation.warnings) notices.push({ level: 'warn', text: w })
  if (!validation.ok) return { ...EMPTY_MODEL, validation, notices, plotLocal: validation.ring.length >= 3 ? validation.ring : local }

  if (inp.plot.some(([lon,lat])=>lon<STUDY_BOUNDS.west || lon>STUDY_BOUNDS.east || lat<STUDY_BOUNDS.south || lat>STUDY_BOUNDS.north)) {
    notices.push({level:'error',text:'This plot extends beyond the Rama 9 study area. Use the sample plot or redraw inside the dashed study boundary; surrounding road and building data are only available there.'})
    return {...EMPTY_MODEL, validation, notices, plotLocal:validation.ring}
  }
  if (inp.roadWidthOverride != null && (!Number.isFinite(inp.roadWidthOverride) || inp.roadWidthOverride < 2 || inp.roadWidthOverride > 80)) {
    notices.push({level:'error',text:'Road right-of-way must be a finite value between 2 and 80 metres.'})
    return {...EMPTY_MODEL,validation,notices,plotLocal:validation.ring}
  }
  const plot = validation.ring
  const roads = roadOptions(roadsRaw, frame, plot)
  let road: RoadOption | null = null
  if (inp.roadKey === 'auto') road = roads[0] ?? null
  else {
    road = roads.find((r) => r.key === inp.roadKey) ?? null
    if (!road) notices.push({ level: 'warn', text: 'The road you chose is no longer within 90 m of the plot. Showing the nearest road instead.' })
    road = road ?? roads[0] ?? null
  }

  let roadWidth: Fact | null = null
  if (road) {
    roadWidth = road.width
    if (inp.roadWidthOverride != null && Number.isFinite(inp.roadWidthOverride) && inp.roadWidthOverride >= 2 && inp.roadWidthOverride <= 80) {
      roadWidth = { value: inp.roadWidthOverride, status: 'A', source: 'Entered by you in the road width box' }
    }
  } else {
    notices.push({ level: 'warn', text: 'No road within 90 m of this plot. The road-facing setback and sky-plane rules cannot be applied, and every design fails the access check. Move the plot next to a road.' })
    roadWidth = { value: 8, status: 'A', source: 'No road found; placeholder width, not used for any edge' }
  }

  const edges = classifyEdges(plot, road, roadWidth.value)
  if (road && edges.gapToRoadEdge > 6) {
    notices.push({ level: 'warn', text: `The plot's nearest edge is ${edges.gapToRoadEdge.toFixed(0)} m from the edge of ${road.name}. The tool assumes the plot boundary is on the road edge, so the sky plane and setback are measured from the plot edge as if it touched the road.` })
  }

  const rules = resolveRules({ zoneId: inp.zoneId, typeId: inp.typeId, roadWidth, plotArea: validation.area })
  if (!rules.allowed.value) notices.push({ level: 'warn', text: `${rules.type.name} is not permitted in the ${rules.zone.name.split(' · ')[0]} zone (assumption). The envelope is still shown, but every design fails the use check.` })

  const budget=conceptAreaBudget(rules)
  if(budget < rules.maxGFA) notices.push({level:'info',text:`The selected road limits generated concepts to ${budget.toLocaleString()} m², below the zoning FAR allowance. No transit-distance exception is assumed.`})
  let envelope = buildEnvelope(plot, edges.roles, rules, (roadWidth.value<10 || edges.frontLength<12) ? {lowRise:true,maxHeight:22.999} : {})
  if (!envelope.levels.length) envelope = buildEnvelope(plot, edges.roles, rules, { lowRise:true, maxHeight:22.999 })
  if (!envelope.levels.length) {
    notices.push({ level: 'error', text: 'After setbacks nothing is left to build on. Make the plot larger or wider.' })
    return { validation, notices, plotLocal: plot, roads, road, roadWidth, edges, rules, envelope, results: [] }
  }
  const designs = generateDesigns(envelope, rules, { plot, roles:edges.roles, frontage:edges.frontLength })
  const results = evaluate(designs, { plot, roles: edges.roles, rules, frontage: { length: edges.frontLength, gapToRoadEdge: edges.gapToRoadEdge, hasRoad: !!road } })
  return { validation, notices, plotLocal: plot, roads, road, roadWidth, edges, rules, envelope, results }
}
