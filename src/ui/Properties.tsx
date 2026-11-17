import { useMemo, useState } from 'react'
import { imageFittedToPiece, readImageFile } from '../io/images.ts'
import { shapeEdges } from '../model/geometry.ts'
import { formatLength, measureLength } from '../model/measure.ts'
import { useEditor } from '../model/store.ts'
import { IconButton, icons } from './icons.tsx'
import { PanelToggle } from './Sidebar.tsx'
import type { Piece, Role, Shape, Stroke } from '../model/types.ts'

export function Properties() {
  const [open, setOpen] = useState(true)
  const selection = useEditor((s) => s.selection)
  const all = useEditor((s) => s.doc.pieces)
  const pieces = useMemo(
    () => all.filter((piece) => selection.pieceIds.includes(piece.id)),
    [all, selection],
  )
  const stroke = pieces.length === 1 ? pieces[0].strokes.find((item) => item.id === selection.strokeId) ?? null : null
  const allMeasures = useEditor((s) => s.doc.measures)
  const pickedMeasures = useMemo(
    () => (allMeasures ?? []).filter((measure) => (selection.measureIds ?? []).includes(measure.id)),
    [allMeasures, selection.measureIds],
  )

  return (
    <aside className={open ? 'panel right' : 'panel right collapsed'}>
      <div className="panel-bar">
        <PanelToggle open={open} side="right" name="propiedades" onClick={() => setOpen((value) => !value)} />
      </div>
      {open && pieces.length === 0 && pickedMeasures.length === 0 && <p className="hint">Selecciona una pieza para ver sus medidas, o dibuja en el lienzo.</p>}
      {open && pickedMeasures.length > 0 && (
        <section>
          <h2>{pickedMeasures.length === 1 ? 'Referencia' : `${pickedMeasures.length} referencias`}</h2>
          {pickedMeasures.map((measure) => (
            <p key={measure.id} className="hint">
              {formatLength(measureLength(measure))}
            </p>
          ))}
          <button type="button" className="wide" onClick={() => useEditor.getState().deleteSelected()}>
            {pickedMeasures.length === 1 ? 'Eliminar referencia' : 'Eliminar referencias'}
          </button>
          {(allMeasures ?? []).length > pickedMeasures.length && (
            <button type="button" className="wide" onClick={() => useEditor.getState().clearMeasures()}>
              Eliminar todas
            </button>
          )}
        </section>
      )}
      {open && pieces.length > 1 && (
        <section>
          <h2>{pieces.length} piezas</h2>
          <Arrange />
        </section>
      )}
      {open && pieces.length === 1 && (
        <>
          <PieceFields piece={pieces[0]} />
          <ImageFields piece={pieces[0]} />
          {stroke && <StrokeFields pieceId={pieces[0].id} stroke={stroke} />}
          <Arrange />
        </>
      )}
    </aside>
  )
}

function PieceFields({ piece }: { piece: Piece }) {
  return (
    <section>
      <h2>Pieza</h2>
      <NameField key={piece.id} id={piece.id} name={piece.name} />
      <div className="fields">
        <Num label="X" value={piece.x} onChange={(value) => useEditor.getState().setPieceNumber(piece.id, 'x', value)} />
        <Num label="Y" value={piece.y} onChange={(value) => useEditor.getState().setPieceNumber(piece.id, 'y', value)} />
        <Num label="Rotación" value={piece.rotation} step={90} onChange={(value) => useEditor.getState().setPieceNumber(piece.id, 'rotation', value)} />
      </div>
    </section>
  )
}

function NameField({ id, name }: { id: string; name: string }) {
  const [value, setValue] = useState(name)
  return (
    <label className="name">
      <span>Nombre</span>
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => {
          if (value.trim() && value !== name) useEditor.getState().renamePiece(id, value.trim())
        }}
      />
    </label>
  )
}

function ImageFields({ piece }: { piece: Piece }) {
  return (
    <section>
      <h2>Impresión</h2>
      <p className="hint">Puedes dejar la pieza solo en corte, o colocar una imagen. El PDF incluye únicamente las que tengan imagen.</p>
      {piece.image ? (
        <>
          <p className="file-name">{piece.image.name}</p>
          <div className="fields">
            <Num label="Imagen X" value={piece.image.x} onChange={(value) => updateImage(piece, { x: value })} />
            <Num label="Imagen Y" value={piece.image.y} onChange={(value) => updateImage(piece, { y: value })} />
            <Num label="Ancho" value={piece.image.width} min={1} onChange={(value) => updateImage(piece, { width: Math.max(1, value) })} />
            <Num label="Alto" value={piece.image.height} min={1} onChange={(value) => updateImage(piece, { height: Math.max(1, value) })} />
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={!piece.image.hidden}
              onChange={(event) => updateImage(piece, { hidden: !event.target.checked })}
            />
            Mostrar en el lienzo
          </label>
          <button type="button" onClick={() => useEditor.getState().setImage(piece.id, null)}>
            Quitar imagen
          </button>
        </>
      ) : (
        <label className="file-button">
          Agregar imagen
          <input
            className="file"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void addImage(piece, file)
            }}
          />
        </label>
      )}
    </section>
  )
}

async function addImage(piece: Piece, file: File) {
  try {
    const read = await readImageFile(file)
    useEditor.getState().setImage(piece.id, imageFittedToPiece(piece, read))
  } catch (error) {
    useEditor.getState().setStatus(error instanceof Error ? error.message : 'No se pudo colocar la imagen.')
  }
}

function updateImage(piece: Piece, patch: Partial<NonNullable<Piece['image']>>) {
  if (!piece.image) return
  useEditor.getState().setImage(piece.id, { ...piece.image, ...patch })
}

function StrokeFields({ pieceId, stroke }: { pieceId: string; stroke: Stroke }) {
  const shape = stroke.shape
  const segmentIndex = useEditor((s) => s.selection.segmentIndex)
  const edges = shapeEdges(shape, stroke.role)
  const segmentRole = segmentIndex != null ? edges?.[segmentIndex]?.role ?? null : null
  const shown: Role = segmentRole ?? stroke.role
  const set = (next: Shape) => useEditor.getState().replaceShape(pieceId, stroke.id, next)
  const mark = (role: Role) => useEditor.getState().setSegmentRole(role)
  return (
    <section>
      <h2>Trazo</h2>
      <p className="hint">
        {segmentRole
          ? `Tramo ${segmentIndex! + 1}: ${segmentRole === 'crease' ? 'doblez' : 'corte'}. Un doblez no se corta.`
          : 'Un doblez no se corta. Con Nodos, haz clic en un tramo para cambiar solo esa parte.'}
      </p>
      <div className="row">
        <button type="button" className={shown === 'cut' ? 'active' : ''} onClick={() => mark('cut')}>
          Corte
        </button>
        <button type="button" className={shown === 'crease' ? 'active' : ''} onClick={() => mark('crease')}>
          Doblez
        </button>
      </div>
      {edges && edges.length > 0 && (
        <button type="button" className="wide" onClick={() => useEditor.getState().addTabOn(pieceId, stroke.id, segmentIndex)}>
          Pestaña en toda la arista
        </button>
      )}
      <div className="fields">
        {shape.kind === 'line' && (
          <>
            <Num label="X1" value={shape.a.x} onChange={(value) => set({ ...shape, a: { ...shape.a, x: value } })} />
            <Num label="Y1" value={shape.a.y} onChange={(value) => set({ ...shape, a: { ...shape.a, y: value } })} />
            <Num label="X2" value={shape.b.x} onChange={(value) => set({ ...shape, b: { ...shape.b, x: value } })} />
            <Num label="Y2" value={shape.b.y} onChange={(value) => set({ ...shape, b: { ...shape.b, y: value } })} />
          </>
        )}
        {(shape.kind === 'rect' || shape.kind === 'roundRect') && (
          <>
            <Num label="X" value={shape.x} onChange={(value) => set({ ...shape, x: value })} />
            <Num label="Y" value={shape.y} onChange={(value) => set({ ...shape, y: value })} />
            <Num label="Ancho" value={shape.width} min={0} onChange={(value) => set({ ...shape, width: value })} />
            <Num label="Alto" value={shape.height} min={0} onChange={(value) => set({ ...shape, height: value })} />
            {shape.kind === 'roundRect' && (
              <Num label="Radio" value={shape.radius} min={0} onChange={(value) => set({ ...shape, radius: value })} />
            )}
          </>
        )}
        {shape.kind === 'ellipse' && (
          <>
            <Num label="Centro X" value={shape.cx} onChange={(value) => set({ ...shape, cx: value })} />
            <Num label="Centro Y" value={shape.cy} onChange={(value) => set({ ...shape, cy: value })} />
            <Num label="Radio X" value={shape.rx} min={0.5} onChange={(value) => set({ ...shape, rx: value })} />
            <Num label="Radio Y" value={shape.ry} min={0.5} onChange={(value) => set({ ...shape, ry: value })} />
          </>
        )}
        {shape.kind === 'arc' && (
          <>
            <Num label="Centro X" value={shape.cx} onChange={(value) => set({ ...shape, cx: value })} />
            <Num label="Centro Y" value={shape.cy} onChange={(value) => set({ ...shape, cy: value })} />
            <Num label="Radio X" value={shape.rx} min={0.5} onChange={(value) => set({ ...shape, rx: value })} />
            <Num label="Radio Y" value={shape.ry} min={0.5} onChange={(value) => set({ ...shape, ry: value })} />
            <Num label="Inicio" value={shape.startAngle} onChange={(value) => set({ ...shape, startAngle: value })} />
            <Num label="Fin" value={shape.endAngle} onChange={(value) => set({ ...shape, endAngle: value })} />
          </>
        )}
        {shape.kind === 'polyline' && <p className="hint">{shape.points.length} puntos. Arrastra los nodos para moverlos.</p>}
      </div>
    </section>
  )
}

function Arrange() {
  const count = useEditor((s) => s.selection.pieceIds.length)
  const run = (action: () => void) => action()
  return (
    <>
      <section>
        <h2>Trazos</h2>
        <p className="hint">Unir deja un solo contorno. Dividir parte la figura donde se cruzan, también si una línea la atraviesa.</p>
        <div className="row icons">
          <IconButton label="Unir" icon={icons.union} disabled={count < 1} onClick={() => run(() => useEditor.getState().pathOp('union'))} />
          <IconButton label="Intersecar" icon={icons.intersect} disabled={count < 1} onClick={() => run(() => useEditor.getState().pathOp('intersect'))} />
          <IconButton label="Restar" icon={icons.subtract} disabled={count < 1} onClick={() => run(() => useEditor.getState().pathOp('subtract'))} />
          <IconButton label="Excluir" icon={icons.exclude} disabled={count < 1} onClick={() => run(() => useEditor.getState().pathOp('exclude'))} />
          <IconButton label="Dividir" icon={icons.divide} disabled={count < 1} onClick={() => run(() => useEditor.getState().pathOp('divide'))} />
          <IconButton label="Alinear aristas" icon={icons.alignEdges} disabled={count < 1} onClick={() => run(() => useEditor.getState().pathOp('align'))} />
        </div>
      </section>
      <section>
        <h2>Medidas</h2>
        <p className="hint">Al dibujar, el ancho y el alto se pegan a las figuras de alrededor. Aquí puedes igualarlos.</p>
        <div className="row icons">
          <IconButton label="Igualar ancho" icon={icons.width} disabled={count < 1} onClick={() => run(() => useEditor.getState().matchSize('width'))} />
          <IconButton label="Igualar alto" icon={icons.height} disabled={count < 1} onClick={() => run(() => useEditor.getState().matchSize('height'))} />
          <IconButton label="Igualar tamaño" icon={icons.both} disabled={count < 1} onClick={() => run(() => useEditor.getState().matchSize('both'))} />
        </div>
      </section>
      <section>
      <h2>Ordenar</h2>
      <div className="row icons">
        <IconButton label="Izquierda" icon={icons.alignLeft} disabled={count < 2} onClick={() => run(() => useEditor.getState().align('left'))} />
        <IconButton label="Centro" icon={icons.alignCenter} disabled={count < 2} onClick={() => run(() => useEditor.getState().align('centerX'))} />
        <IconButton label="Derecha" icon={icons.alignRight} disabled={count < 2} onClick={() => run(() => useEditor.getState().align('right'))} />
        <IconButton label="Arriba" icon={icons.alignTop} disabled={count < 2} onClick={() => run(() => useEditor.getState().align('top'))} />
        <IconButton label="Medio" icon={icons.alignMiddle} disabled={count < 2} onClick={() => run(() => useEditor.getState().align('centerY'))} />
        <IconButton label="Abajo" icon={icons.alignBottom} disabled={count < 2} onClick={() => run(() => useEditor.getState().align('bottom'))} />
        <IconButton label="Distribuir horizontal" icon={icons.distributeH} disabled={count < 3} onClick={() => run(() => useEditor.getState().distribute('h'))} />
        <IconButton label="Distribuir vertical" icon={icons.distributeV} disabled={count < 3} onClick={() => run(() => useEditor.getState().distribute('v'))} />
        <IconButton label="Reflejar horizontal" icon={icons.mirrorH} disabled={count < 1} onClick={() => run(() => useEditor.getState().mirror('h'))} />
        <IconButton label="Reflejar vertical" icon={icons.mirrorV} disabled={count < 1} onClick={() => run(() => useEditor.getState().mirror('v'))} />
        <IconButton label="Rotar 90°" icon={icons.rotate} disabled={count < 1} onClick={() => run(() => useEditor.getState().rotate90())} />
        <IconButton label="Agrupar" hint="⌘G" icon={icons.group} disabled={count < 2} onClick={() => run(() => useEditor.getState().groupSelected())} />
        <IconButton label="Desagrupar" hint="⌘⇧G" icon={icons.ungroup} disabled={count < 1} onClick={() => run(() => useEditor.getState().ungroupSelected())} />
        <IconButton label="Unir piezas" icon={icons.unite} disabled={count < 2} onClick={() => run(() => useEditor.getState().uniteSelected())} />
        <IconButton label="Unir líneas" icon={icons.weld} disabled={count < 1} onClick={() => run(() => useEditor.getState().weldLines())} />
        <IconButton label="Duplicar" hint="⌘D" icon={icons.duplicate} disabled={count < 1} onClick={() => run(() => useEditor.getState().duplicate())} />
        <IconButton label="Borrar" hint="⌫" icon={icons.trash} disabled={count < 1} onClick={() => run(() => useEditor.getState().deleteSelected())} />
      </div>
    </section>
    </>
  )
}

function Num({
  label,
  value,
  onChange,
  step = 1,
  min,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  step?: number
  min?: number
}) {
  const shown = Number.isFinite(value) ? String(Math.round(value * 100) / 100) : ''
  return (
    <label>
      <span>{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        value={shown}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (Number.isFinite(next)) onChange(next)
        }}
      />
    </label>
  )
}
