import { useEffect, useRef, type CSSProperties } from 'react'
import { importSvg } from '../io/importSvg.ts'
import { bindOpenProject, bindOpenSvg, loadProjectFile, loadSvgFile, saveCutFile, savePrintFile, saveProjectFile } from '../io/commands.ts'
import { parseProject } from '../io/project.ts'
import { docBBox } from '../model/geometry.ts'
import { useEditor } from '../model/store.ts'
import type { Role, Tool } from '../model/types.ts'
import { IconButton, icons } from './icons.tsx'
import { Key } from './Key.tsx'

const tools: { id: Tool; label: string; hint: string }[] = [
  { id: 'select', label: 'Mover', hint: 'M' },
  { id: 'node', label: 'Nodos', hint: 'A' },
  { id: 'hand', label: 'Mano', hint: 'H' },
  { id: 'line', label: 'Línea', hint: '\\' },
  { id: 'polyline', label: 'Polilínea', hint: 'P' },
  { id: 'measure', label: 'Medir', hint: 'Q' },
  { id: 'tab', label: 'Pestaña', hint: 'J' },
]

const figures: { id: Tool; label: string; hint: string }[] = [
  { id: 'rect', label: 'Rectángulo', hint: 'R' },
  { id: 'square', label: 'Cuadrado', hint: 'S' },
  { id: 'roundRect', label: 'Redondeado', hint: 'O' },
  { id: 'triangle', label: 'Triángulo', hint: 'T' },
  { id: 'rightTriangle', label: 'Triángulo recto', hint: 'Y' },
  { id: 'rhombus', label: 'Rombo', hint: 'D' },
  { id: 'parallelogram', label: 'Romboide', hint: 'B' },
  { id: 'trapezoid', label: 'Trapecio', hint: 'F' },
  { id: 'kite', label: 'Deltoide', hint: 'I' },
  { id: 'pentagon', label: 'Pentágono', hint: '5' },
  { id: 'hexagon', label: 'Hexágono', hint: '6' },
  { id: 'octagon', label: 'Octágono', hint: '8' },
  { id: 'ellipse', label: 'Elipse', hint: 'L' },
  { id: 'circle', label: 'Círculo', hint: 'C' },
  { id: 'semicircle', label: 'Semicírculo', hint: 'E' },
  { id: 'arc', label: 'Arco', hint: 'N' },
  { id: 'star', label: 'Estrella', hint: 'K' },
  { id: 'cross', label: 'Cruz', hint: 'X' },
]

export function Toolbar() {
  const tool = useEditor((s) => s.tool)
  const role = useEditor((s) => s.role)
  const snap = useEditor((s) => s.snap)
  const showImages = useEditor((s) => s.showImages)
  const hasPieces = useEditor((s) => s.doc.pieces.length > 0)
  const hasImages = useEditor((s) => s.doc.pieces.some((piece) => piece.image))
  const projectInput = useRef<HTMLInputElement>(null)
  const svgInput = useRef<HTMLInputElement>(null)

  useEffect(() => bindOpenProject(() => projectInput.current?.click()), [])
  useEffect(() => bindOpenSvg(() => svgInput.current?.click()), [])

  const setTool = (next: Tool) => useEditor.getState().setTool(next)
  const setRole = (next: Role) => useEditor.getState().setRole(next)

  const current = [...tools, ...figures].find((item) => item.id === tool)

  const buttonCount = tools.length + figures.length + 12

  return (
    <header className="toolbar" style={{ '--n': buttonCount } as CSSProperties}>
      <div className="toolbar-main">
      <div className="brand">Troqueles</div>
      <span className="sep" />
      <div className="tool-strip">
        {tools.map((item) => (
          <IconButton
            key={item.id}
            label={item.label}
            hint={item.hint}
            icon={icons[item.id]}
            pressed={tool === item.id}
            onClick={() => {
              if (item.id !== 'tab') {
                setTool(item.id)
                return
              }
              const state = useEditor.getState()
              state.setTool('tab')
              const selected = state.selection
              if (selected.pieceIds.length === 1 && selected.strokeId) {
                state.addTabOn(selected.pieceIds[0], selected.strokeId, selected.segmentIndex)
              }
            }}
          />
        ))}
      </div>
      <span className="sep" />
      <span className="figures-label">Figuras</span>
      <div className="tool-strip">
        {figures.map((item) => (
          <IconButton
            key={item.id}
            label={item.label}
            hint={item.hint}
            icon={icons[item.id]}
            pressed={tool === item.id}
            onClick={() => setTool(item.id)}
          />
        ))}
      </div>
      <span className="sep" />
      <IconButton label="Corte" hint="1" icon={icons.cut} pressed={role === 'cut'} onClick={() => setRole('cut')} />
      <IconButton label="Doblez" hint="2" icon={icons.crease} pressed={role === 'crease'} onClick={() => setRole('crease')} />
      <IconButton label="Imán" hint="U" icon={icons.magnet} pressed={snap} onClick={() => useEditor.getState().setSnap(!snap)} />
      <IconButton label="Imágenes" hint="W" icon={icons.image} pressed={showImages} onClick={() => useEditor.getState().setShowImages(!showImages)} />
      <span className="sep" />
      <IconButton label="Deshacer" hint="⌘Z" icon={icons.undo} onClick={() => useEditor.getState().undo()} />
      <IconButton label="Rehacer" hint="⌘⇧Z" icon={icons.redo} onClick={() => useEditor.getState().redo()} />
      <IconButton label="Encajar" hint="⌘0" icon={icons.fit} onClick={() => useEditor.getState().fit()} />
      <span className="sep" />
      <IconButton label="Cargar" hint="⌘O" icon={icons.open} onClick={loadProjectFile} />
      <IconButton label="Guardar archivo" hint="⌘S" icon={icons.save} onClick={saveProjectFile} />
      <IconButton label="Importar SVG" hint="⌘⇧O" icon={icons.import} onClick={loadSvgFile} />
      <IconButton label="SVG de corte" hint="⌘E" icon={icons.svg} disabled={!hasPieces} onClick={saveCutFile} />
      <IconButton label="PDF de impresión" hint="⌘⇧E" icon={icons.pdf} disabled={!hasImages} onClick={() => void savePrintFile()} />
      </div>
      {current && (
        <div className="tool-current">
          {current.label}
          <Key>{current.hint}</Key>
        </div>
      )}
      <input
        ref={projectInput}
        className="file"
        type="file"
        accept="application/json,.json"
        onChange={(event) => void openProject(event.target.files?.[0], event.target)}
      />
      <input
        ref={svgInput}
        className="file"
        type="file"
        accept="image/svg+xml,.svg"
        onChange={(event) => void openSvg(event.target.files?.[0], event.target)}
      />
    </header>
  )
}

async function openProject(file: File | undefined, input: HTMLInputElement) {
  if (!file) return
  try {
    useEditor.getState().replaceDoc(parseProject(await file.text()), 'Proyecto abierto.')
  } catch (error) {
    useEditor.getState().setStatus(error instanceof Error ? error.message : 'No se pudo abrir el proyecto.')
  } finally {
    input.value = ''
  }
}

async function openSvg(file: File | undefined, input: HTMLInputElement) {
  if (!file) return
  try {
    const piece = importSvg(await file.text(), file.name)
    const box = docBBox(useEditor.getState().doc.pieces)
    if (box) piece.x = box.x + box.width + 30
    useEditor.getState().addPieces([piece], 'SVG importado como pieza editable.')
  } catch (error) {
    useEditor.getState().setStatus(error instanceof Error ? error.message : 'No se pudo importar el SVG.')
  } finally {
    input.value = ''
  }
}
