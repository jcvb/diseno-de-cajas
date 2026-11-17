import { useEffect, type RefObject } from 'react'
import { loadProjectFile, loadSvgFile, saveCutFile, savePrintFile, saveProjectFile } from '../io/commands.ts'
import { useEditor } from '../model/store.ts'
import type { Tool } from '../model/types.ts'

const tools: Record<string, Tool> = {
  m: 'select',
  v: 'select',
  a: 'node',
  h: 'hand',
  '\\': 'line',
  p: 'polyline',
  l: 'ellipse',
  r: 'rect',
  o: 'roundRect',
  e: 'semicircle',
  n: 'arc',
  s: 'square',
  t: 'triangle',
  y: 'rightTriangle',
  d: 'rhombus',
  b: 'parallelogram',
  f: 'trapezoid',
  i: 'kite',
  '5': 'pentagon',
  '6': 'hexagon',
  '8': 'octagon',
  c: 'circle',
  k: 'star',
  x: 'cross',
  q: 'measure',
  j: 'tab',
}

export function useShortcuts(consume: RefObject<((event: KeyboardEvent) => boolean) | null>) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return
      if (consume.current?.(event)) return
      const editor = useEditor.getState()
      const meta = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()

      if (event.key === ' ' ) {
        event.preventDefault()
        return
      }
      if (key === 'escape') {
        editor.clearSelection()
        return
      }
      if (meta && key === 'z' && !event.shiftKey) {
        event.preventDefault()
        editor.undo()
        return
      }
      if ((meta && key === 'z' && event.shiftKey) || (meta && key === 'y')) {
        event.preventDefault()
        editor.redo()
        return
      }
      if (meta && key === 'd') {
        event.preventDefault()
        if (!event.repeat) editor.duplicate()
        return
      }
      if (meta && key === 'c') {
        editor.copy()
        return
      }
      if (meta && key === 'v') {
        event.preventDefault()
        if (!event.repeat) editor.paste()
        return
      }
      if (meta && key === 'a') {
        event.preventDefault()
        if (event.shiftKey) editor.clearSelection()
        else editor.selectAll()
        return
      }
      if (meta && key === 'g') {
        event.preventDefault()
        if (event.shiftKey) editor.ungroupSelected()
        else editor.groupSelected()
        return
      }
      if (meta && key === '0') {
        event.preventDefault()
        editor.fit()
        return
      }
      if (meta && key === '1') {
        event.preventDefault()
        editor.zoomBy(1 / editor.view.zoom)
        return
      }
      if (meta && key === 's') {
        event.preventDefault()
        if (!event.repeat) saveProjectFile()
        return
      }
      if (meta && key === 'o' && event.shiftKey) {
        event.preventDefault()
        if (!event.repeat) loadSvgFile()
        return
      }
      if (meta && key === 'o') {
        event.preventDefault()
        if (!event.repeat) loadProjectFile()
        return
      }
      if (meta && key === 'e' && event.shiftKey) {
        event.preventDefault()
        if (!event.repeat) void savePrintFile()
        return
      }
      if (meta && key === 'e') {
        event.preventDefault()
        if (!event.repeat) saveCutFile()
        return
      }
      if (!meta && event.code === 'KeyZ') {
        event.preventDefault()
        editor.zoomBy(event.altKey ? 1 / 1.15 : 1.15)
        return
      }
      if (key === '+' || key === '=') {
        event.preventDefault()
        editor.zoomBy(1.15)
        return
      }
      if (key === '-') {
        event.preventDefault()
        editor.zoomBy(1 / 1.15)
        return
      }
      if (!meta && !event.repeat && key === '1') {
        editor.setRole('cut')
        return
      }
      if (!meta && !event.repeat && key === '2') {
        editor.setRole('crease')
        return
      }
      if (!meta && !event.repeat && key === 'u') {
        editor.setSnap(!editor.snap)
        return
      }
      if (!meta && !event.repeat && key === 'w') {
        editor.setShowImages(!editor.showImages)
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        if (editor.tool === 'node' && editor.selection.nodeIndex != null) editor.removeNode()
        else editor.deleteSelected()
        return
      }
      if (event.key.startsWith('Arrow')) {
        event.preventDefault()
        const step = event.shiftKey ? 10 : 1
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
        editor.nudge(dx, dy)
        return
      }
      if (!meta && !event.repeat && tools[key]) {
        editor.setTool(tools[key])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [consume])
}
