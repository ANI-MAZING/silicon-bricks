import { describe, expect, it, beforeEach } from 'vitest'
import { difference, makeFrame, polysArea, toLonLat, validatePlot, type Ring } from '../src/core/geo'
import { estimateRoadWidth, roadSetback, resolveRules } from '../src/core/rules'
import { computeModel, type ModelInput } from '../src/core/model'
import { checkDesign } from '../src/core/designs'
import { floorCSV, projectJSON, readProject, reportJSON } from '../src/core/project'
import { SAMPLE_PLOT, useStore } from '../src/store'
import { parseContext, type RawContext } from '../src/core/context'
import context from '../src/data/context.json'
const frame=makeFrame(100.5655,13.7578)
const plot:Ring=[[0,0],[40,0],[40,40],[0,40]]
const road={id:1,name:'Test',highway:'primary',width:estimateRoadWidth('primary'),line:[toLonLat(frame,[-300,-12]),toLonLat(frame,[300,-12])],bridge:false,tunnel:false}
const input:ModelInput={plot:plot.map(p=>toLonLat(frame,p)),zoneId:'c3',typeId:'condo',roadKey:'auto',roadWidthOverride:30}
const run=(over:Partial<ModelInput>={})=>computeModel({...input,...over},frame,[road])

describe('regulatory regression coverage',()=>{
  it('the narrower tower spends its own FAR budget and can grow above A',()=>{
    const m=run(); const a=m.results[0].design; const b=m.results[1].design
    expect(b.height).toBeGreaterThan(a.height)
    expect(b.totalGFA).toBeLessThanOrEqual(m.rules!.maxGFA)
    expect(b.totalGFA).toBeGreaterThan(a.totalGFA*0.95)
  })
  it('every regulated floor including the podium clears every boundary by six metres',()=>{
    const m=run()
    const inner:Ring=[[6,6],[34,6],[34,34],[6,34]]
    for(const r of m.results.filter(r=>r.design.height>=23||r.design.totalGFA>=10000))
      for(const f of r.design.floors) expect(polysArea(difference(f.polys,[inner]))).toBeLessThan(0.05)
  })
  it('a low building with extra-large floor area still needs the regulated clearance',()=>{
    const large:Ring=[[0,0],[80,0],[80,80],[0,80]]
    const m=run({plot:large.map(p=>toLonLat(frame,p))})
    const c=m.results[2].design
    expect(c.height).toBeLessThan(23)
    expect(c.totalGFA).toBeGreaterThanOrEqual(10000)
    const inner:Ring=[[6,6],[74,6],[74,74],[6,74]]
    for(const f of c.floors)expect(polysArea(difference(f.polys,[inner]))).toBeLessThan(0.05)
  })
  it.each([[9,1.5],[10,1],[15,1.5],[20,2],[24,2]])('road band at %s m gives %s m basic setback',(w,d)=>expect(roadSetback(w).value).toBe(d))
  it('height band changes the setback of the ground floor too',()=>{
    const r=resolveRules({zoneId:'c3',typeId:'condo',roadWidth:road.width,plotArea:1600})
    expect(r.frontSetback(3.2,30)).toBe(6)
    expect(r.sideSetback(30)).toBe(6)
  })
  it('reduces floor area to the road-conditioned budget',()=>{
    const m=run({roadWidthOverride:24})
    expect(m.results[0].design.totalGFA).toBeLessThanOrEqual(10000)
    expect(m.results[0].checks.find(c=>c.id==='road-width')!.pass).toBe(true)
  })
  it('requires the extra-large frontage rule even below 23 m',()=>{
    const m=run();const d=structuredClone(m.results[2].design);d.totalGFA=10000
    const checks=checkDesign(d,{plot:m.plotLocal,roles:m.edges!.roles,rules:m.rules!,frontage:{length:8,gapToRoadEdge:0,hasRoad:true}})
    expect(checks.find(c=>c.id==='frontage')!.pass).toBe(false)
  })
  it('catches cancelling net/core errors on separate floors',()=>{
    const m=run();const d=structuredClone(m.results[0].design)
    d.floors[0].net+=5;d.floors[1].core-=5
    const checks=checkDesign(d,{plot:m.plotLocal,roles:m.edges!.roles,rules:m.rules!,frontage:{length:40,gapToRoadEdge:0,hasRoad:true}})
    expect(checks.find(c=>c.id==='sum')!.pass).toBe(false)
  })
  it('every floor lies inside the exact envelope supplied to the map',()=>{
    for(const r of run().results)for(let i=0;i<r.design.floors.length;i++)
      expect(polysArea(difference(r.design.floors[i].polys,r.envelope[i].polys))).toBeLessThan(0.05)
  })
})

describe('supported study and inputs',()=>{
  it('does not invent context outside the study area',()=>{
    const m=run({plot:plot.map(p=>toLonLat(frame,[p[0]+2000,p[1]]))})
    expect(m.results).toEqual([])
    expect(m.notices.some(n=>n.text.includes('study area'))).toBe(true)
  })
  it.each([NaN,Infinity,0,100])('rejects invalid road override %s',w=>{
    const m=run({roadWidthOverride:w});expect(m.results).toEqual([]);expect(m.notices.some(n=>n.level==='error')).toBe(true)
  })
  it('rejects NaN coordinates without silently reshaping the plot',()=>expect(validatePlot([[NaN,0],[0,0],[40,0],[40,40],[0,40]]).ok).toBe(false))
  it('does not use bridged roads as plot frontage',()=>expect(computeModel(input,frame,[{...road,bridge:true}]).road).toBeNull())
  it('sample produces three nonempty schemes with precise area sums',()=>{
    const ctx=parseContext(context as unknown as RawContext)
    const m=computeModel({...input,plot:SAMPLE_PLOT,roadWidthOverride:null},frame,ctx.roads)
    expect(m.results).toHaveLength(3)
    for(const r of m.results){expect(r.design.floors.length).toBeGreaterThan(0);expect(r.checks.find(c=>c.id==='sum')!.pass).toBe(true)}
  })
})

describe('portable project and report',()=>{
  it('round-trips a project with exact geometry and road settings',()=>expect(readProject(projectJSON(input))).toEqual(input))
  it.each([
    {version:999,scenario:input},
    {version:1,scenario:{...input,zoneId:'red'}},
    {version:1,scenario:{...input,typeId:'__proto__'}},
    {version:1,scenario:{...input,plot:[[1,2],[3,4]]}},
    {version:1,scenario:{...input,roadWidthOverride:'30'}},
  ])('rejects malformed or incompatible projects',x=>expect(()=>readProject(JSON.stringify(x))).toThrow())
  it('exports all concepts with sources and scope limitations',()=>{
    const report=JSON.parse(reportJSON(input,run()))
    expect(report.concepts).toHaveLength(3);expect(report.sources.plan).toContain('mr56-bma.pdf')
    expect(report.scope).toContain('require verification')
  })
  it('CSV includes actual rows and a total matching the selected concept',()=>{
    const m=run();const csv=floorCSV(m,'B');const b=m.results[1].design
    expect(csv.split('\r\n')).toHaveLength(b.floors.length+2)
    expect(csv).toContain(`"${b.totalGFA}"`)
  })
})

describe('edit history',()=>{
  beforeEach(()=>useStore.setState({plot:[],past:[],future:[],draft:[],drawing:false}))
  it('undoes clear and redoes it',()=>{
    const s=useStore.getState();s.useSample();s.clearPlot();s.undo();expect(useStore.getState().plot).toEqual(SAMPLE_PLOT)
    s.redo();expect(useStore.getState().plot).toEqual([])
  })
  it('undo restores road assumptions along with the previous boundary',()=>{
    const s=useStore.getState();s.useSample();s.set({roadWidthOverride:32,roadKey:'verified-choice'});s.clearPlot();s.undo();
    expect(useStore.getState().roadWidthOverride).toBe(32);expect(useStore.getState().roadKey).toBe('verified-choice')
  })
  it('a new edit clears the redo branch',()=>{
    const s=useStore.getState();s.useSample();s.clearPlot();s.undo();s.checkpoint();s.setVertex(0,[100.565,13.756]);expect(useStore.getState().future).toEqual([])
  })
})
