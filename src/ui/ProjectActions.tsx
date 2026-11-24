import { useRef, useState } from 'react'
import type { Model, ModelInput } from '../core/model'
import { floorCSV, projectJSON, readProject, reportJSON } from '../core/project'
import { useStore } from '../store'
function download(name:string,text:string,type:string) {
  const url=URL.createObjectURL(new Blob([text],{type}))
  const a=document.createElement('a');a.href=url;a.download=name;a.click()
  setTimeout(()=>URL.revokeObjectURL(url),1000)
}
export default function ProjectActions({model,input,busy}:{model:Model;input:ModelInput;busy:boolean}) {
  const file=useRef<HTMLInputElement>(null)
  const [message,setMessage]=useState('')
  const s=useStore()
  return <section className="project-actions" aria-label="Project files">
    <div className="action-row">
      <button onClick={()=>{download('plot-envelope-project.json',projectJSON(input),'application/json');setMessage('Project saved to Downloads.')}} disabled={busy || !s.plot.length}>Save project</button>
      <button onClick={()=>file.current?.click()}>Open project</button>
      <button disabled={busy || !model.results.length} onClick={()=>{download('plot-envelope-report.json',reportJSON(input,model),'application/json');setMessage('Report saved with all concepts, checks, rules and assumptions.')}}>Export report</button>
      <button disabled={busy || !model.results.length} onClick={()=>{download(`concept-${s.designId}-floors.csv`,floorCSV(model,s.designId),'text/csv;charset=utf-8');setMessage('Floor schedule saved as CSV.')}}>Floor CSV</button>
    </div>
    <input ref={file} type="file" accept=".json,application/json" hidden aria-label="Open Plot Envelope project" onChange={async e=>{
      const f=e.currentTarget.files?.[0];e.currentTarget.value=''; if(!f)return
      try { if(f.size>100000) throw new Error('Choose a project file smaller than 100 KB.'); const project=readProject(await f.text());s.checkpoint();s.set({...project,drawing:false,draft:[],flyToken:useStore.getState().flyToken+1});setMessage('Project opened. Check the selected road and scenario before comparing concepts.') }
      catch(err) { setMessage(err instanceof Error?err.message:'Could not open this project.') }
    }}/>
    {message && <p className="file-message" role="status">{message}</p>}
  </section>
}
