import { type LonLat } from './geo'
import type { ModelInput, Model } from './model'
import { BUILDING_TYPES, RULE_REVIEW_DATE, SOURCES } from './rules'
export const PROJECT_VERSION=1
export function projectJSON(input: ModelInput) {
  return JSON.stringify({version:PROJECT_VERSION,application:'Plot Envelope',scenario:input},null,2)
}
export function readProject(text:string): ModelInput {
  const data=JSON.parse(text)
  const s=data?.scenario
  if (data?.version!==PROJECT_VERSION || !s || s.zoneId!=='c3' || !Object.hasOwn(BUILDING_TYPES,s.typeId)) throw new Error('Choose a Plot Envelope v1 project using the พ.3 scenario.')
  if (!Array.isArray(s.plot) || s.plot.length>100 || (s.plot.length>0 && s.plot.length<3) || s.plot.some((p:LonLat)=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||p[0]<-180||p[0]>180||p[1]<-85||p[1]>85)) throw new Error('The project contains invalid plot coordinates. Use a boundary with 3–100 corners.')
  if (typeof s.roadKey!=='string' || s.roadKey.length>300 || (s.roadWidthOverride!==null && (typeof s.roadWidthOverride!=='number'||!Number.isFinite(s.roadWidthOverride)||s.roadWidthOverride<2||s.roadWidthOverride>80))) throw new Error('The project contains an invalid road setting.')
  return {plot:s.plot,zoneId:'c3',typeId:s.typeId,roadKey:s.roadKey,roadWidthOverride:s.roadWidthOverride}
}
export function reportJSON(input:ModelInput,model:Model) {
  return JSON.stringify({application:'Plot Envelope',exportedAt:new Date().toISOString(),ruleReviewDate:RULE_REVIEW_DATE,
    scope:'Preliminary 2013 พ.3 scenario; parcel zoning, effective local overlays, public road status, right-of-way and continuity require verification. No transit bonus or exception claimed. Not a permit or compliance certificate.',
    sources:SOURCES,scenario:input,areaM2:model.validation.area,road:model.road?.name,roadWidth:model.roadWidth,
    rules:model.rules?.lines,notices:model.notices,concepts:model.results.map(r=>({ ...r.design, floors:r.design.floors.map(({polys:_polys,...f})=>f), checks:r.checks, allModelChecksPass:r.allPass,
      openGroundM2:model.validation.area-r.design.projectedArea,minimumPermeablePlantingM2:0.5*(model.rules?.osr??0)/100*r.design.totalGFA }))},null,2)
}
const csv=(v:unknown)=>`"${String(v).replaceAll('"','""')}"`
export function floorCSV(model:Model,designId:string) {
  const result=model.results.find(r=>r.design.id===designId)??model.results[0]
  if (!result) return ''
  const d=result.design
  return ['Concept,Floor,Use,GFA m2,Net m2,Core m2,Base m,Top m',...d.floors.map(f=>[d.id,f.index+1,f.use,f.area,f.net,f.core,f.z0,f.z1].map(csv).join(',')),[d.id,'Total','',d.totalGFA,d.totalNet,d.totalCore,'',d.height].map(csv).join(',')].join('\r\n')
}
