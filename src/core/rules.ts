// Pure scenario rules. P means the number was read in the legal text, not that a
// parcel, survey, local overlay or current permit application has been verified.
export type Status = 'P' | 'S' | 'U' | 'A' | 'C'
export interface Fact<T = number> { value: T; status: Status; source: string; url?: string; note?: string }
const fact = <T,>(value: T, status: Status, source: string, note?: string, url?: string): Fact<T> => ({ value, status, source, note, url })
export const SOURCES = {
  plan: 'https://download.asa.or.th/03media/04law/cpa/mr56-bma.pdf',
  mr33: 'https://download.asa.or.th/03media/04law/cba/mr/mr35-33-upd69.pdf',
  mr55: 'https://download.asa.or.th/03media/04law/cba/mr/mr43-55-upd68.pdf',
}
export const RULE_REVIEW_DATE = '2026-11-24'
export type ZoneId = 'c3'
export type BuildingTypeId = 'condo' | 'office' | 'hotel'
export interface Zone { id: ZoneId; name: string; nameTh: string; colour: string; far: Fact; osr: Fact; allowed: Record<BuildingTypeId, Fact<boolean>> }
export interface BuildingType { id: BuildingTypeId; name: string; floorHeight: Fact; efficiency: Fact; towerUse: string }
export const ZONES: Record<ZoneId, Zone> = {
  c3: {
    id: 'c3', name: 'พ.3 · Commercial (2013 plan scenario)', nameTh: 'พ.๓ พาณิชยกรรม', colour: '#dc2626',
    far: fact(7, 'P', 'Bangkok Comprehensive Plan B.E. 2556, clause 20, p. 46, final paragraph (1)', 'Base FAR only; bonuses and exemptions excluded. Parcel membership and superseding local provisions require confirmation.', SOURCES.plan),
    osr: fact(4.5, 'P', 'Bangkok Comprehensive Plan B.E. 2556, clause 20, p. 46, final paragraph (2)', 'At least 50% of required open space must be permeable for planting; reserved in the report, not a landscape design.', SOURCES.plan),
    allowed: {
      condo: fact(true, 'A', 'Scenario: condominium use, subject to clause 20(9) road / transit conditions', 'Parcel zoning is selected, not detected.', SOURCES.plan),
      office: fact(true, 'A', 'Scenario: office use, subject to clause 20(11) road / transit conditions', undefined, SOURCES.plan),
      hotel: fact(true, 'A', 'Scenario: hotel use, subject to clause 20(8); room count is not modelled', 'Conservatively require a 16 m road for all hotel concepts; transit exception is not claimed.', SOURCES.plan),
    },
  },
}
export const BUILDING_TYPES: Record<BuildingTypeId, BuildingType> = {
  condo: { id: 'condo', name: 'Condominium', floorHeight: fact(3.2, 'A', 'Residential floor-to-floor design assumption'), efficiency: fact(0.75, 'A', 'Residential net / gross design assumption'), towerUse: 'Residential' },
  office: { id: 'office', name: 'Office', floorHeight: fact(3.8, 'A', 'Office floor-to-floor design assumption'), efficiency: fact(0.8, 'A', 'Office net / gross design assumption'), towerUse: 'Office' },
  hotel: { id: 'hotel', name: 'Hotel', floorHeight: fact(3.4, 'A', 'Hotel floor-to-floor design assumption'), efficiency: fact(0.65, 'A', 'Hotel net / gross design assumption'), towerUse: 'Hotel rooms' },
}
export const ROAD_CLASS_WIDTH: Record<string, number> = { motorway: 30, motorway_link: 12, trunk: 30, primary: 24, primary_link: 12, secondary: 18, secondary_link: 10, tertiary: 14, residential: 9, unclassified: 8, service: 6, living_street: 6 }
export const DEFAULT_ROAD_WIDTH = 8
export function estimateRoadWidth(highway: string, tagWidth?: number): Fact {
  if (tagWidth && Number.isFinite(tagWidth) && tagWidth > 0) return fact(tagWidth, 'S', 'OpenStreetMap width tag', 'May be carriageway width; not a verified legal right-of-way.', 'https://www.openstreetmap.org/copyright')
  return fact(ROAD_CLASS_WIDTH[highway] ?? DEFAULT_ROAD_WIDTH, 'A', `Estimated from OSM road class “${highway}”`, 'Confirm legal right-of-way width with a survey before relying on the result.')
}
export const HIGH_RISE_M = fact(23, 'P', 'Ministerial Regulation 33, clause 1', 'Roof-deck height; roof structures and service equipment are not modelled.', SOURCES.mr33)
export const LARGE_BUILDING_M2 = 10000
export const SKY_PLANE = fact(2, 'P', 'Ministerial Regulation 55, clause 44, p. 9', 'Model assumes a straight road parallel to the selected frontage, with the plot boundary on the road edge. Corner-road exceptions excluded.', SOURCES.mr55)
export const HIGH_RISE_SETBACK = fact(6, 'P', 'Ministerial Regulation 33, clauses 3–4, p. 2', 'Applied to ALL floors and ALL boundaries of a high-rise or extra-large building; fire access route engineering remains outside scope.', SOURCES.mr33)
export const MID_SETBACK = fact(3, 'P', 'Ministerial Regulation 55, clause 50', 'Opening-bearing walls of a building over 9 m and below 23 m. Applied to the whole building.', SOURCES.mr55)
export const LOW_SETBACK = fact(2, 'P', 'Ministerial Regulation 55, clause 50', 'Opening-bearing walls of buildings up to 9 m. Blank-wall exceptions excluded.', SOURCES.mr55)
export const LOW_BAND_M = 9
export const MAX_SITE_COVERAGE = fact(0.7, 'A', 'Conservative scenario: reserve 30% open ground for every concept', 'MR33 clause 6 requires 30% for residential and 10% for non-residential high-rise / extra-large buildings. This model reserves 30% for all uses.', SOURCES.mr33)
export const MIN_FRONTAGE_HIGH_RISE = fact(12, 'P', 'Ministerial Regulation 33, clause 2, p. 2', 'Applies to high-rise OR total floor area ≥10,000 m². Road must be ≥10 m; >30,000 m² requires ≥18 m. Connection continuity is not verified.', SOURCES.mr33)
export const MAX_FLOORS = fact(70, 'A', 'Computational scenario limit of 70 floors')
export const PODIUM_FLOORS = fact(4, 'A', 'Four podium floors in concept B')
export const MIN_FLOOR_PLATE_M2 = 60
export function roadSetback(width: number): Fact {
  const value = width < 10 ? Math.max(0, 6 - width / 2) : width <= 20 ? width / 10 : 2
  return fact(value, 'P', 'Ministerial Regulation 55, clause 41(1)–(3), p. 9', 'Uses the road band for buildings over two floors / 8 m and listed commercial uses; conservative for smaller buildings.', SOURCES.mr55)
}
export interface RuleLine { id: string; label: string; value: string; status: Status; source: string; url?: string; note?: string; effect: string }
export interface RuleSet {
  zone: Zone; type: BuildingType; roadWidth: Fact; plotArea: number; far: number; osr: number; maxGFA: number; floorHeight: number; efficiency: number; maxCoverage: number; coverageDriver: 'site coverage' | 'OSR'; allowed: Fact<boolean>; roadSetbackM: number
  sideSetback: (buildingHeight: number) => number
  frontSetback: (pointHeight: number, buildingHeight?: number) => number
  lines: RuleLine[]
}
export interface RuleInput { zoneId: ZoneId; typeId: BuildingTypeId; roadWidth: Fact; plotArea: number }
export function resolveRules(inp: RuleInput): RuleSet {
  const zone = ZONES[inp.zoneId]; const type = BUILDING_TYPES[inp.typeId]
  if (!zone || !type) throw new Error('Unsupported zone or building type')
  const W = inp.roadWidth.value
  if (!Number.isFinite(W) || W < 2 || W > 80) throw new Error('Road width must be between 2 and 80 metres')
  const rs = roadSetback(W); const far = zone.far.value; const osr = zone.osr.value
  // Reserve enough open ground for the FULL FAR budget. This is conservative for
  // low-utilisation concepts; the independent checklist measures actual open ground.
  const osrCap = Math.max(0, 1 - osr / 100 * far)
  const maxCoverage = Math.min(MAX_SITE_COVERAGE.value, osrCap)
  const sideSetback = (h: number) => h >= HIGH_RISE_M.value ? HIGH_RISE_SETBACK.value : h > LOW_BAND_M ? MID_SETBACK.value : LOW_SETBACK.value
  const frontSetback = (h: number, buildingHeight = h) => Math.max(rs.value, buildingHeight >= HIGH_RISE_M.value ? HIGH_RISE_SETBACK.value : 0, h / SKY_PLANE.value - W)
  const citation = ({ value: _value, ...rest }: Fact<unknown>) => rest
  const lines: RuleLine[] = [
    { id:'far', label:'Base floor area ratio (FAR)', value:`${far}:1 · ${(far * inp.plotArea).toFixed(0)} m² total floor area`, ...citation(zone.far), effect:'Limits cumulative floor area independently for each concept.' },
    { id:'osr', label:'Open space ratio (OSR)', value:`${osr}% of gross floor area`, ...citation(zone.osr), effect:`Reserves open ground for the full FAR budget; footprint ≤${(maxCoverage*100).toFixed(1)}% of the plot.` },
    { id:'permeable', label:'Permeable planting reservation', value:'At least 50% of required open space', status:'P', source:'Bangkok 2013 plan, clause 20, p. 46, final paragraph (2)', url:SOURCES.plan, note:'Area reservation only; soil, planting and drainage design not checked.', effect:'Reported alongside each concept’s open-ground area.' },
    { id:'cover', label:'Scenario ground coverage cap', value:`${MAX_SITE_COVERAGE.value*100}% before OSR`, ...citation(MAX_SITE_COVERAGE), effect:'Reserves conservative open ground for every use.' },
    { id:'road', label:'Road right-of-way width', value:`${W.toFixed(1)} m`, ...citation(inp.roadWidth), effect:'Changes road footprint, setback, sky plane and access checks.' },
    { id:'frontSetback', label:'Basic road setback', value:`${rs.value.toFixed(1)} m`, ...citation(rs), effect:'Moves the building away from the road boundary.' },
    { id:'sky', label:'Road height plane', value:'Height ≤ 2 × distance to opposite road edge', ...citation(SKY_PLANE), effect:'Upper floor plates step back from the road.' },
    { id:'side-low', label:'Buildings up to 9 m', value:'2 m side / rear setback', ...citation(LOW_SETBACK), effect:'Insets the complete low building footprint.' },
    { id:'side-mid', label:'Buildings over 9 m and below 23 m', value:'3 m side / rear setback', ...citation(MID_SETBACK), effect:'Insets every floor, including the ground floor.' },
    { id:'side-high', label:'High-rise / extra-large buildings', value:'6 m from every boundary', ...citation(HIGH_RISE_SETBACK), effect:'Insets every floor, including the podium and road side.' },
    { id:'frontage', label:'High-rise / extra-large road access', value:'12 m frontage · 10 m road (18 m above 30,000 m²)', ...citation(MIN_FRONTAGE_HIGH_RISE), effect:'Independent check; a failing access result is never a compliant scheme.' },
    { id:'use', label:'พ.3 use and road conditions', value:'Condo / office above 5,000 m²: 16 m road; above 10,000 m²: 30 m', status:'P', source:'Bangkok 2013 plan, clause 20(8), (9), (11), p. 44', url:SOURCES.plan, note:'Transit-distance exception is not claimed. Hotels conservatively require 16 m regardless of room count. Office operating area is conservatively treated as total GFA.', effect:'Checks the selected use against the final concept size and road width.' },
    { id:'floorH', label:'Floor-to-floor height', value:`${type.floorHeight.value} m`, ...citation(type.floorHeight), effect:'Changes floor count and building height.' },
    { id:'eff', label:'Net / gross efficiency', value:`${type.efficiency.value*100}%`, ...citation(type.efficiency), effect:'Splits each floor into net and core areas.' },
  ]
  return { zone, type, roadWidth:inp.roadWidth, plotArea:inp.plotArea, far, osr, maxGFA:far*inp.plotArea, floorHeight:type.floorHeight.value, efficiency:type.efficiency.value, maxCoverage, coverageDriver: maxCoverage === osrCap ? 'OSR':'site coverage', allowed:zone.allowed[type.id], roadSetbackM:rs.value, sideSetback, frontSetback, lines }
}
export const STATUS_LABEL: Record<Status,string> = { C:'Calculated from the current geometry', P:'Read in primary legal text; applicability still requires verification', S:'Secondary or mapped source', U:'Unverified', A:'Modelling assumption' }

/** Conservative use-area budget without claiming the transit-distance exception. */
export function conceptAreaBudget(rules:RuleSet):number {
  const w=rules.roadWidth.value
  const zoneCap=rules.type.id==='hotel' ? Infinity : w<16 ? 5000 : w<30 ? 10000 : Infinity
  const nationalCap=w<18 ? 30000 : Infinity
  return Math.min(rules.maxGFA,zoneCap,nationalCap)
}
