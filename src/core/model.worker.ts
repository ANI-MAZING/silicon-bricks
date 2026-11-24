import { computeModel, EMPTY_MODEL, type ModelInput } from './model'
import type { Frame } from './geo'
import type { ContextRoad } from './context'
let frame: Frame
let roads: ContextRoad[]
self.onmessage = (e: MessageEvent) => {
  if (e.data.kind === 'init') { frame=e.data.frame; roads=e.data.roads; return }
  const {id,input} = e.data as {id:number;input:ModelInput}
  try {
    const model=computeModel(input,frame,roads)
    const rules=model.rules ? {...model.rules,sideSetback:undefined,frontSetback:undefined} : null
    self.postMessage({id,model:{...model,rules}})
  } catch {
    self.postMessage({id,model:{...EMPTY_MODEL,notices:[{level:'error',text:'This boundary could not be processed. Undo the last edit or redraw the plot.'}]}})
  }
}
