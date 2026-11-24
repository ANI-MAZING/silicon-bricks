import { useEffect, useRef, useState } from 'react'
import type { ContextRoad } from '../core/context'
import type { Frame } from '../core/geo'
import { EMPTY_MODEL, computeModel, type Model, type ModelInput } from '../core/model'
import { resolveRules } from '../core/rules'

export function useModel(input: ModelInput, frame: Frame, roads: ContextRoad[]) {
  const [result, setResult] = useState<{ input: ModelInput; model: Model }>(() => ({input,model:EMPTY_MODEL}))
  const worker = useRef<Worker | null>(null)
  const [fallback, setFallback] = useState(false)
  const request = useRef(0)
  const sent = useRef<{id:number;input:ModelInput}|null>(null)
  const current = useRef(input)
  current.current = input
  useEffect(() => {
    let w: Worker
    try { w = new Worker(new URL('../core/model.worker.ts', import.meta.url), {type:'module'}) }
    catch { setFallback(true); return }
    worker.current = w
    w.postMessage({kind:'init',frame,roads})
    w.onerror = () => { w.terminate(); worker.current=null; setFallback(true) }
    w.onmessage = (e) => {
      const job=sent.current
      if (!job || e.data.id !== request.current || job.id !== e.data.id || job.input !== current.current) return
      const m = e.data.model as Model
      // Functions stay on this thread. Every serialized geometric result is from
      // the worker's same normalized model and request revision.
      if (m.rules && m.roadWidth) m.rules = resolveRules({zoneId:current.current.zoneId,typeId:current.current.typeId,roadWidth:m.roadWidth,plotArea:m.validation.area})
      setResult({input:current.current, model:m})
    }
    return () => { w.terminate(); worker.current=null }
  }, [frame,roads])
  useEffect(() => {
    const id=++request.current
    if (input.plot.length < 3) { setResult({input,model:EMPTY_MODEL}); return }
    const timer=setTimeout(() => {
      if (worker.current && !fallback) { sent.current={id,input}; worker.current.postMessage({kind:'compute',id,input}) }
      else {
        try { setResult({input,model:computeModel(input,frame,roads)}) }
        catch { setResult({input,model:{...EMPTY_MODEL,notices:[{level:'error',text:'This boundary could not be processed. Undo the last edit or redraw the plot.'}]}}) }
      }
    }, 35)
    return () => clearTimeout(timer)
  }, [input,frame,roads,fallback])
  return {model:input.plot.length<3?EMPTY_MODEL:result.model, busy:input.plot.length>=3 && result.input!==input}
}
