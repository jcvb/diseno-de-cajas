import { Canvas } from './editor/Canvas.tsx'
import { useEditor } from './model/store.ts'
import { Properties } from './ui/Properties.tsx'
import { Sidebar } from './ui/Sidebar.tsx'
import { Toolbar } from './ui/Toolbar.tsx'

export default function App() {
  const status = useEditor((s) => s.status)
  const cursor = useEditor((s) => s.cursor)
  const zoom = useEditor((s) => s.view.zoom)
  const pieces = useEditor((s) => s.doc.pieces.length)

  return (
    <div className="app">
      <Toolbar />
      <div className="workspace">
        <Sidebar />
        <main className="board">
          <Canvas />
          {pieces === 0 && <p className="empty">Dibuja con las herramientas de arriba.</p>}
        </main>
        <Properties />
      </div>
      <footer className="status">
        <span>{status}</span>
        <span className="legend">
          <i className="swatch" /> Corte
          <i className="swatch fold" /> Doblez
        </span>
        <span className="zoom-control">
          {cursor ? `${cursor.x.toFixed(1)} mm, ${cursor.y.toFixed(1)} mm · ` : ''}
          <button type="button" className="zoom-btn" title="Aleja el lienzo (⌥Z)" onClick={() => useEditor.getState().zoomBy(1 / 1.15)}>
            −
          </button>
          {Math.round(zoom * 100)}%
          <button type="button" className="zoom-btn" title="Acerca el lienzo (Z)" onClick={() => useEditor.getState().zoomBy(1.15)}>
            +
          </button>
        </span>
      </footer>
    </div>
  )
}
