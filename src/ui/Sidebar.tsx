import { useState } from 'react'
import { pieceWorldBBox } from '../model/geometry.ts'
import { useEditor } from '../model/store.ts'

export function Sidebar() {
  const pieces = useEditor((s) => s.doc.pieces)
  const selected = useEditor((s) => s.selection.pieceIds)
  const [open, setOpen] = useState(true)

  return (
    <aside className={open ? 'panel left' : 'panel left collapsed'}>
      <div className="panel-bar">
        {open && <h2>Piezas</h2>}
        <PanelToggle open={open} side="left" name="piezas" onClick={() => setOpen((value) => !value)} />
      </div>
      {open && <section className="grow">
        {pieces.length === 0 ? (
          <p className="hint">Todavía no hay piezas.</p>
        ) : (
          <ul className="piece-list">
            {pieces.map((piece) => (
              <li key={piece.id}>
                <button
                  type="button"
                  className={selected.includes(piece.id) ? 'active' : ''}
                  onClick={() => useEditor.getState().select([piece.id], null, null)}
                  onDoubleClick={() => focusPiece(piece.id)}
                >
                  <span>{piece.name}</span>
                  <small>
                    {piece.image ? 'con imagen' : 'solo corte'}
                    {piece.detached ? ' · editada' : ''}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>}
    </aside>
  )
}

export function PanelToggle({
  open,
  side,
  name,
  onClick,
}: {
  open: boolean
  side: 'left' | 'right'
  name: string
  onClick: () => void
}) {
  const pointsLeft = side === 'left' ? open : !open
  const label = open ? `Contraer ${name}` : `Mostrar ${name}`
  return (
    <button type="button" className="panel-toggle" aria-expanded={open} aria-label={label} title={label} onClick={onClick}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d={pointsLeft ? 'M14 6 L8 12 L14 18' : 'M10 6 L16 12 L10 18'} />
      </svg>
    </button>
  )
}

function focusPiece(id: string) {
  const state = useEditor.getState()
  const piece = state.doc.pieces.find((item) => item.id === id)
  if (!piece) return
  const box = pieceWorldBBox(piece)
  state.select([id], null, null)
  if (!box) return
  const pad = 24
  const zoom = Math.min(4, Math.max(0.08, Math.min(state.viewport.w / (box.width + pad * 2), state.viewport.h / (box.height + pad * 2))))
  state.setView({ x: box.x - pad, y: box.y - pad, zoom })
}
