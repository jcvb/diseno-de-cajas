import { create } from 'zustand'
import {
  addShapeToDoc,
  addTab,
  alignPieces,
  clonePieces,
  deleteSelection,
  distributePieces,
  makeGroup,
  mirrorPieces,
  pruneSelection,
  rotatePieces,
  setPieceImage,
  setStrokeRole,
  syncGroups,
  translatePieces,
  ungroup,
  withStrokeShape,
} from './ops.ts'
import { docBBox, polylineWithoutNode, shapeEdges, shapeWithNode, uid, withEdgeRole } from './geometry.ts'
import { formatLength, measureLength } from './measure.ts'
import { applyPathOp, finishStroke, matchMeasures, type PathOp } from './pathops.ts'
import { unitePieces, weldOpenStroke, weldSelection } from './weld.ts'
import type { AlignMode, Doc, Piece, PieceImage, Point, Role, Selection, Shape, Tool } from './types.ts'
import { emptyDoc, emptySelection } from './types.ts'

type View = { x: number; y: number; zoom: number }

type EditorState = {
  doc: Doc
  selection: Selection
  tool: Tool
  role: Role
  snap: boolean
  grid: number
  showImages: boolean
  view: View
  viewport: { w: number; h: number }
  cursor: Point | null
  status: string
  history: Doc[]
  future: Doc[]
  clipboard: Piece[]
  gestureBase: Doc | null
  gestureDirty: boolean
  setTool: (tool: Tool) => void
  setRole: (role: Role) => void
  setSnap: (snap: boolean) => void
  setShowImages: (showImages: boolean) => void
  setView: (view: View) => void
  setViewport: (w: number, h: number) => void
  setCursor: (cursor: Point | null) => void
  setStatus: (status: string) => void
  zoomAt: (world: Point, screen: Point, factor: number) => void
  zoomBy: (factor: number) => void
  panBy: (dx: number, dy: number) => void
  fit: () => void
  select: (pieceIds: string[], strokeId?: string | null, nodeIndex?: number | null, segmentIndex?: number | null, measureIds?: string[]) => void
  addMeasure: (a: Point, b: Point) => void
  addTabOn: (pieceId: string, strokeId: string, segmentIndex: number | null) => void
  clearMeasures: () => void
  selectAll: () => void
  clearSelection: () => void
  undo: () => void
  redo: () => void
  commit: (recipe: (doc: Doc) => Doc) => void
  beginGesture: () => void
  applyFromBase: (recipe: (doc: Doc) => Doc) => void
  endGesture: () => void
  cancelGesture: () => void
  deleteSelected: () => void
  duplicate: () => void
  copy: () => void
  paste: () => void
  nudge: (dx: number, dy: number) => void
  groupSelected: () => void
  ungroupSelected: () => void
  align: (mode: AlignMode) => void
  distribute: (axis: 'h' | 'v') => void
  mirror: (axis: 'h' | 'v') => void
  rotate90: () => void
  setPieceNumber: (id: string, field: 'x' | 'y' | 'rotation', value: number) => void
  renamePiece: (id: string, name: string) => void
  changeRole: (role: Role) => void
  setSegmentRole: (role: Role) => void
  uniteSelected: () => void
  weldLines: () => void
  pathOp: (op: PathOp) => void
  matchSize: (mode: 'width' | 'height' | 'both') => void
  setNode: (pieceId: string, strokeId: string, index: number, point: Point) => void
  replaceShape: (pieceId: string, strokeId: string, shape: Shape) => void
  addShape: (shape: Shape) => void
  movePiecesBy: (ids: string[], dx: number, dy: number) => void
  removeNode: () => void
  setImage: (pieceId: string, image: PieceImage | null) => void
  patchImage: (pieceId: string, image: PieceImage) => void
  replaceDoc: (doc: Doc, status: string) => void
  addPieces: (pieces: Piece[], status: string) => void
}

const HISTORY = 30

function remember(history: Doc[], doc: Doc): Doc[] {
  return [...history, doc].slice(-HISTORY)
}

export const useEditor = create<EditorState>((set, get) => ({
  doc: emptyDoc(),
  selection: emptySelection(),
  tool: 'select',
  role: 'cut',
  snap: true,
  grid: 1,
  showImages: true,
  view: { x: -40, y: -40, zoom: 0.45 },
  viewport: { w: 800, h: 600 },
  cursor: null,
  status: 'Dibuja una pieza en el lienzo.',
  history: [],
  future: [],
  clipboard: [],
  gestureBase: null,
  gestureDirty: false,

  setTool: (tool) => set({ tool }),
  setRole: (role) => set({ role }),
  setSnap: (snap) => set({ snap }),
  setShowImages: (showImages) => set({ showImages }),
  setView: (view) => set({ view }),
  setViewport: (w, h) => set({ viewport: { w, h } }),
  setCursor: (cursor) => set({ cursor }),
  setStatus: (status) => set({ status }),

  zoomAt: (world, screen, factor) => {
    const view = get().view
    const zoom = Math.min(16, Math.max(0.04, view.zoom * factor))
    set({
      view: {
        zoom,
        x: world.x - screen.x / zoom,
        y: world.y - screen.y / zoom,
      },
    })
  },

  zoomBy: (factor) => {
    const { view, viewport } = get()
    const screen = { x: viewport.w / 2, y: viewport.h / 2 }
    const world = { x: view.x + screen.x / view.zoom, y: view.y + screen.y / view.zoom }
    get().zoomAt(world, screen, factor)
  },

  panBy: (dx, dy) => {
    const view = get().view
    set({ view: { ...view, x: view.x - dx, y: view.y - dy } })
  },

  fit: () => {
    const { doc, viewport } = get()
    const box = docBBox(doc.pieces)
    if (!box || viewport.w < 20 || viewport.h < 20) return
    const pad = 36
    const zoom = Math.min(8, Math.max(0.04, Math.min(viewport.w / (box.width + pad * 2), viewport.h / (box.height + pad * 2))))
    set({ view: { x: box.x - pad, y: box.y - pad, zoom } })
  },

  select: (pieceIds, strokeId = null, nodeIndex = null, segmentIndex = null, measureIds = []) =>
    set({ selection: { pieceIds, strokeId, nodeIndex, segmentIndex, measureIds } }),
  selectAll: () =>
    set({
      selection: {
        pieceIds: get().doc.pieces.map((p) => p.id),
        strokeId: null,
        nodeIndex: null,
        segmentIndex: null,
        measureIds: (get().doc.measures ?? []).map((measure) => measure.id),
      },
    }),
  clearSelection: () => set({ selection: emptySelection() }),

  undo: () => {
    const { history, doc, future, selection } = get()
    const prev = history[history.length - 1]
    if (!prev) return
    set({
      doc: prev,
      history: history.slice(0, -1),
      future: [doc, ...future].slice(0, HISTORY),
      selection: pruneSelection(selection, prev),
    })
  },

  redo: () => {
    const { history, doc, future, selection } = get()
    const next = future[0]
    if (!next) return
    set({
      doc: next,
      future: future.slice(1),
      history: remember(history, doc),
      selection: pruneSelection(selection, next),
    })
  },

  commit: (recipe) => {
    const doc = get().doc
    const next = recipe(doc)
    if (next === doc) return
    set({
      doc: next,
      history: remember(get().history, doc),
      future: [],
      selection: pruneSelection(get().selection, next),
    })
  },

  beginGesture: () => set({ gestureBase: get().doc, gestureDirty: false }),

  applyFromBase: (recipe) => {
    const base = get().gestureBase ?? get().doc
    set({ doc: recipe(base), gestureDirty: true })
  },

  endGesture: () => {
    const { gestureBase, gestureDirty, doc, history } = get()
    if (!gestureBase || !gestureDirty) {
      set({ gestureBase: null, gestureDirty: false })
      return
    }
    set({
      history: remember(history, gestureBase),
      future: [],
      gestureBase: null,
      gestureDirty: false,
      selection: pruneSelection(get().selection, doc),
    })
  },

  cancelGesture: () => {
    const base = get().gestureBase
    if (!base) return
    set({ doc: base, gestureBase: null, gestureDirty: false })
  },

  deleteSelected: () => {
    const { selection } = get()
    const measureIds = selection.measureIds ?? []
    if (selection.pieceIds.length === 0 && !selection.strokeId && measureIds.length === 0) return
    get().commit((current) => {
      const withoutPieces = selection.pieceIds.length > 0 || selection.strokeId ? deleteSelection(current, selection) : current
      if (measureIds.length === 0) return withoutPieces
      const drop = new Set(measureIds)
      return { ...withoutPieces, measures: (withoutPieces.measures ?? []).filter((measure) => !drop.has(measure.id)) }
    })
    set({ selection: emptySelection(), status: measureIds.length > 0 && selection.pieceIds.length === 0 ? 'Referencia eliminada.' : 'Eliminado.' })
  },

  addMeasure: (a, b) => {
    const length = measureLength({ a, b })
    if (length < 0.5) return
    const id = uid('medida')
    get().commit((doc) => ({ ...doc, measures: [...(doc.measures ?? []), { id, a, b }] }))
    set({
      selection: { ...emptySelection(), measureIds: [id] },
      status: `Referencia de ${formatLength(length)}. Supr la elimina.`,
    })
  },

  addTabOn: (pieceId, strokeId, segmentIndex) => {
    let created: string | null = null
    let missingEdge = false
    get().commit((doc) => {
      const piece = doc.pieces.find((item) => item.id === pieceId)
      const stroke = piece?.strokes.find((item) => item.id === strokeId)
      const edges = stroke ? shapeEdges(stroke.shape, stroke.role) : null
      if (!edges || edges.length === 0) return doc
      if (segmentIndex == null && edges.length > 1) {
        missingEdge = true
        return doc
      }
      const result = addTab(doc, pieceId, strokeId, segmentIndex)
      if (!result) return doc
      created = result.strokeId
      return result.doc
    })
    if (missingEdge) {
      set({ tool: 'tab', status: 'Haz clic en la arista. La pestaña se crea en todo ese tramo.' })
      return
    }
    if (!created) {
      set({ status: 'Esa arista no es recta, así que no cabe una pestaña.' })
      return
    }
    const keepTool = get().tool === 'tab'
    set({
      tool: keepTool ? 'tab' : get().tool,
      selection: { pieceIds: [pieceId], strokeId: created, nodeIndex: null, segmentIndex: null, measureIds: [] },
      status: 'Pestaña en trapecio creada en toda la arista. El borde compartido quedó como doblez.',
    })
  },

  clearMeasures: () => {
    if ((get().doc.measures ?? []).length === 0) return
    get().commit((doc) => ({ ...doc, measures: [] }))
    set({ selection: emptySelection(), status: 'Referencias eliminadas.' })
  },

  duplicate: () => {
    get().copy()
    get().paste()
  },

  copy: () => {
    const { doc, selection } = get()
    const pieces = doc.pieces.filter((p) => selection.pieceIds.includes(p.id))
    if (pieces.length === 0) return
    set({ clipboard: pieces.map((p) => structuredClone(p)), status: 'Copiado.' })
  },

  paste: () => {
    const { clipboard } = get()
    if (clipboard.length === 0) return
    const copies = clonePieces(clipboard, { x: 12, y: 12 })
    get().commit((current) => ({ ...current, pieces: [...current.pieces, ...copies] }))
    set({
      selection: { pieceIds: copies.map((p) => p.id), strokeId: null, nodeIndex: null, segmentIndex: null },
      status: 'Pegado.',
    })
  },

  nudge: (dx, dy) => {
    const ids = get().selection.pieceIds
    if (ids.length === 0) return
    get().commit((doc) => translatePieces(doc, ids, dx, dy))
  },

  groupSelected: () => {
    const ids = get().selection.pieceIds
    if (ids.length < 2) return
    get().commit((doc) => makeGroup(doc, ids))
    set({ status: 'Grupo creado.' })
  },

  ungroupSelected: () => {
    const ids = get().selection.pieceIds
    get().commit((doc) => ungroup(doc, ids))
    set({ status: 'Grupo deshecho.' })
  },

  align: (mode) => get().commit((doc) => alignPieces(doc, get().selection.pieceIds, mode)),
  distribute: (axis) => get().commit((doc) => distributePieces(doc, get().selection.pieceIds, axis)),
  mirror: (axis) => {
    get().commit((doc) => mirrorPieces(doc, get().selection.pieceIds, axis))
    set({ status: 'Pieza reflejada.' })
  },
  rotate90: () => get().commit((doc) => rotatePieces(doc, get().selection.pieceIds)),

  setPieceNumber: (id, field, value) => {
    if (!Number.isFinite(value)) return
    get().commit((doc) => ({
      ...doc,
      pieces: doc.pieces.map((p) => (p.id === id ? { ...p, [field]: value } : p)),
    }))
  },

  renamePiece: (id, name) => {
    get().commit((doc) => ({
      ...doc,
      pieces: doc.pieces.map((p) => (p.id === id ? { ...p, name } : p)),
    }))
  },

  changeRole: (role) => {
    get().commit((doc) => setStrokeRole(doc, get().selection, role))
    set({
      role,
      status: role === 'crease' ? 'El trazo completo es un doblez: no se corta.' : 'El trazo completo es corte.',
    })
  },

  setSegmentRole: (role) => {
    const { selection, doc } = get()
    const piece = doc.pieces.find((item) => item.id === selection.pieceIds[0])
    const item = piece?.strokes.find((stroke) => stroke.id === selection.strokeId)
    const index = selection.segmentIndex
    if (!piece || !item || index == null || item.shape.kind === 'line' || item.shape.kind === 'ellipse' || item.shape.kind === 'arc' || item.shape.kind === 'roundRect') {
      get().changeRole(role)
      return
    }
    const next = withEdgeRole(item.shape, index, role, item.role)
    if (next === item.shape) {
      get().changeRole(role)
      return
    }
    get().commit((current) => withStrokeShape(current, piece.id, item.id, next))
    set({
      status: role === 'crease' ? 'Ese tramo quedó como doblez y no se corta.' : 'Ese tramo quedó como corte.',
    })
  },

  uniteSelected: () => {
    const ids = get().selection.pieceIds
    if (ids.length < 2) return
    const keep = ids[0]
    get().commit((doc) => unitePieces(doc, ids))
    set({
      selection: { pieceIds: [keep], strokeId: null, nodeIndex: null, segmentIndex: null },
      status: 'Piezas unidas. Los bordes que coincidían quedaron como doblez.',
    })
  },

  weldLines: () => {
    const ids = get().selection.pieceIds
    if (ids.length === 0) return
    let joined = 0
    get().commit((doc) => {
      const result = weldSelection(doc, ids)
      joined = result.joined
      return result.joined > 0 ? result.doc : doc
    })
    set({
      status: joined > 0 ? 'Las líneas que se tocaban quedaron en un solo trazo.' : 'Acerca los extremos: todavía no se tocan.',
    })
  },

  pathOp: (op) => {
    const ids = get().selection.pieceIds
    let message = 'Selecciona una figura.'
    let changed = false
    get().commit((doc) => {
      const result = applyPathOp(doc, ids, op)
      message = result.message
      changed = result.changed
      return result.changed ? result.doc : doc
    })
    const alive = ids.filter((id) => get().doc.pieces.some((piece) => piece.id === id))
    set({
      ...(changed
        ? { selection: { pieceIds: alive.slice(0, 1), strokeId: null, nodeIndex: null, segmentIndex: null } }
        : {}),
      status: message,
    })
  },

  matchSize: (mode) => {
    const ids = get().selection.pieceIds
    let message = 'Selecciona una figura.'
    get().commit((doc) => {
      const result = matchMeasures(doc, ids, mode)
      message = result.message
      return result.changed ? result.doc : doc
    })
    set({ status: message })
  },

  setNode: (pieceId, strokeId, index, point) => {
    get().applyFromBase((doc) => ({
      ...doc,
      pieces: doc.pieces.map((p) => {
        if (p.id !== pieceId) return p
        return {
          ...p,
          detached: true,
          strokes: p.strokes.map((s) => (s.id === strokeId ? { ...s, shape: shapeWithNode(s.shape, index, point) } : s)),
        }
      }),
    }))
  },

  replaceShape: (pieceId, strokeId, shape) => {
    get().commit((doc) => withStrokeShape(doc, pieceId, strokeId, shape))
  },

  addShape: (shape) => {
    const { selection, role } = get()
    const target = selection.pieceIds.length === 1 ? selection.pieceIds[0] : null
    let created = ''
    let strokeId = ''
    let joined = 0
    let split = 0
    let merged = 0
    const open = shape.kind === 'line' || (shape.kind === 'polyline' && !shape.closed)
    get().commit((doc) => {
      const result = addShapeToDoc(doc, shape, role, target)
      created = result.pieceId
      strokeId = result.strokeId
      if (!open) return result.doc
      const welded = weldOpenStroke(result.doc, created, strokeId, { end: 'both' })
      joined = welded.joined
      const finished = finishStroke(welded.doc, created, strokeId)
      split = finished.split
      merged = finished.merged
      return finished.doc
    })
    const status =
      split > 0
        ? 'La línea partió la figura en dos.'
        : joined > 0 || merged > 0
          ? 'Los trazos quedaron en uno solo.'
          : target
            ? 'Trazo añadido a la pieza.'
            : 'Pieza nueva.'
    set({
      selection: { pieceIds: [created], strokeId, nodeIndex: null, segmentIndex: null },
      status,
    })
  },

  movePiecesBy: (ids, dx, dy) => {
    get().applyFromBase((doc) => translatePieces(doc, ids, dx, dy))
  },

  removeNode: () => {
    const { selection } = get()
    if (selection.nodeIndex == null || !selection.strokeId || selection.pieceIds.length !== 1) return
    const pieceId = selection.pieceIds[0]
    const strokeId = selection.strokeId
    const index = selection.nodeIndex
    get().commit((doc) => ({
      ...doc,
      pieces: doc.pieces.map((p) => {
        if (p.id !== pieceId) return p
        return {
          ...p,
          detached: true,
          strokes: p.strokes.map((s) => {
            if (s.id !== strokeId || s.shape.kind !== 'polyline') return s
            const next = polylineWithoutNode(s.shape, index)
            return next ? { ...s, shape: next } : s
          }),
        }
      }),
    }))
    set({ selection: { ...get().selection, nodeIndex: null } })
  },

  setImage: (pieceId, image) => {
    get().commit((doc) => setPieceImage(doc, pieceId, image))
    set({ status: image ? 'Imagen colocada. El PDF de impresión la incluye.' : 'La pieza volvió a ser solo corte.' })
  },

  patchImage: (pieceId, image) => {
    get().applyFromBase((doc) => setPieceImage(doc, pieceId, image))
  },

  replaceDoc: (doc, status) => {
    const next = syncGroups(doc)
    set({
      doc: next,
      history: remember(get().history, get().doc),
      future: [],
      selection: emptySelection(),
      status,
    })
    get().fit()
  },

  addPieces: (pieces, status) => {
    get().commit((doc) => syncGroups({ ...doc, pieces: [...doc.pieces, ...pieces] }))
    set({
      selection: { pieceIds: pieces.map((p) => p.id), strokeId: null, nodeIndex: null, segmentIndex: null },
      status,
    })
    get().fit()
  },
}))
