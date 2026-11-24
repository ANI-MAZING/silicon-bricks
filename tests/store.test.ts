import { beforeEach, expect, it } from 'vitest'
import { SAMPLE_PLOT, useStore } from '../src/store'

beforeEach(() => useStore.getState().clearPlot())

it('preserves the current plot and road settings when a redraw is cancelled', () => {
  const s = useStore.getState()
  s.useSample()
  s.set({ roadWidthOverride: 32, roadKey: 'chosen-road' })
  s.startDraw()
  s.addDraftPoint([100.56, 13.75])
  s.cancelDraw()
  expect(useStore.getState().plot).toEqual(SAMPLE_PLOT)
  expect(useStore.getState().roadWidthOverride).toBe(32)
  expect(useStore.getState().roadKey).toBe('chosen-road')
})

it('only replaces a plot when the new drawing has at least three corners', () => {
  const s = useStore.getState()
  s.useSample()
  s.startDraw()
  s.addDraftPoint([100.56, 13.75])
  s.finishDraw()
  expect(useStore.getState().drawing).toBe(true)
  expect(useStore.getState().plot).toEqual(SAMPLE_PLOT)
  s.addDraftPoint([100.57, 13.75])
  s.addDraftPoint([100.57, 13.76])
  s.finishDraw()
  expect(useStore.getState().drawing).toBe(false)
  expect(useStore.getState().plot).toHaveLength(3)
  expect(useStore.getState().roadKey).toBe('auto')
})
