import { exportPrintPdf } from '../export/pdf.ts'
import { exportCutSvg } from '../export/svg.ts'
import { useEditor } from '../model/store.ts'
import { downloadBytes, downloadText, serializeProject } from './project.ts'

let openProject: (() => void) | null = null
let openSvg: (() => void) | null = null

export function bindOpenProject(open: () => void): () => void {
  openProject = open
  return () => {
    if (openProject === open) openProject = null
  }
}

export function bindOpenSvg(open: () => void): () => void {
  openSvg = open
  return () => {
    if (openSvg === open) openSvg = null
  }
}

export function saveProjectFile(): void {
  const state = useEditor.getState()
  downloadText('troquel.json', serializeProject(state.doc), 'application/json')
  state.setStatus('Archivo guardado.')
}

export function loadProjectFile(): void {
  openProject?.()
}

export function loadSvgFile(): void {
  openSvg?.()
}

export function saveCutFile(): void {
  const state = useEditor.getState()
  if (state.doc.pieces.length === 0) {
    state.setStatus('No hay piezas para exportar.')
    return
  }
  downloadText('corte.svg', exportCutSvg(state.doc), 'image/svg+xml')
  state.setStatus('SVG de corte exportado, sin imágenes.')
}

export async function savePrintFile(): Promise<void> {
  const state = useEditor.getState()
  try {
    const bytes = await exportPrintPdf(state.doc)
    if (!bytes) {
      state.setStatus('Ninguna pieza tiene imagen.')
      return
    }
    downloadBytes('impresion.pdf', bytes, 'application/pdf')
    state.setStatus('PDF de impresión listo: una página por pieza con imagen.')
  } catch (error) {
    state.setStatus(error instanceof Error ? error.message : 'No se pudo crear el PDF.')
  }
}
