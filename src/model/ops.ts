import {
  bakePiece,
  clearEdgeRoles,
  docBBox,
  hasEdgeRoles,
  mirrorPiece,
  pieceWorldBBox,
  rotatePiece90,
  pointInShape,
  shapeEdges,
  shapeNodes,
  uid,
  withEdgeRole,
} from './geometry.ts'
import type { AlignMode, Doc, Group, Piece, PieceImage, Point, Role, Selection, Shape, Stroke } from './types.ts'
import { emptyDoc, emptySelection } from './types.ts'

export function syncGroups(doc: Doc): Doc {
  const ids = new Set(doc.pieces.map((p) => p.id))
  const groups = doc.groups
    .map((g) => ({ ...g, pieceIds: g.pieceIds.filter((id) => ids.has(id)) }))
    .filter((g) => g.pieceIds.length >= 2)
  return { ...doc, groups }
}

export function pruneSelection(selection: Selection, doc: Doc): Selection {
  const pieces = new Set(doc.pieces.map((p) => p.id))
  const pieceIds = selection.pieceIds.filter((id) => pieces.has(id))
  const piece = doc.pieces.find((p) => p.id === pieceIds[0])
  const stroke = piece?.strokes.find((s) => s.id === selection.strokeId)
  const nodes = stroke ? shapeNodes(stroke.shape).length : 0
  const edges = stroke ? (shapeEdges(stroke.shape, stroke.role)?.length ?? 0) : 0
  const alive = new Set((doc.measures ?? []).map((measure) => measure.id))
  return {
    pieceIds,
    strokeId: stroke ? selection.strokeId : null,
    nodeIndex: stroke && selection.nodeIndex != null && selection.nodeIndex < nodes ? selection.nodeIndex : null,
    segmentIndex: stroke && selection.segmentIndex != null && selection.segmentIndex < edges ? selection.segmentIndex : null,
    measureIds: (selection.measureIds ?? []).filter((id) => alive.has(id)),
  }
}

export function groupMates(doc: Doc, pieceIds: string[]): string[] {
  const set = new Set(pieceIds)
  for (const group of doc.groups) {
    if (group.pieceIds.some((id) => set.has(id))) {
      for (const id of group.pieceIds) set.add(id)
    }
  }
  return [...set]
}

export function translatePieces(doc: Doc, ids: string[], dx: number, dy: number): Doc {
  if (dx === 0 && dy === 0) return doc
  const set = new Set(ids)
  return {
    ...doc,
    pieces: doc.pieces.map((p) => (set.has(p.id) ? { ...p, x: p.x + dx, y: p.y + dy } : p)),
  }
}

function detachPiece(piece: Piece): Piece {
  return { ...piece, detached: true }
}

const TAB_HEIGHT = 5

function outwardNormal(shape: Shape, a: Point, b: Point): Point {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const plus = { x: mid.x + nx, y: mid.y + ny }
  const minus = { x: mid.x - nx, y: mid.y - ny }
  if (pointInShape(shape, plus) && !pointInShape(shape, minus)) return { x: -nx, y: -ny }
  return { x: nx, y: ny }
}

export function addTab(
  doc: Doc,
  pieceId: string,
  strokeId: string,
  segmentIndex: number | null,
  depth = TAB_HEIGHT,
): { doc: Doc; strokeId: string } | null {
  const piece = doc.pieces.find((item) => item.id === pieceId)
  const item = piece?.strokes.find((stroke) => stroke.id === strokeId)
  if (!piece || !item) return null
  const edges = shapeEdges(item.shape, item.role)
  if (!edges || edges.length === 0) return null
  const index = segmentIndex ?? (edges.length === 1 ? 0 : null)
  if (index == null || index < 0 || index >= edges.length) return null
  const edge = edges[index]
  const dx = edge.b.x - edge.a.x
  const dy = edge.b.y - edge.a.y
  const length = Math.hypot(dx, dy)
  if (length < 1 || depth < 0.8) return null
  const inset = Math.min(depth, Math.max(0, (length - 4) / 2))
  const tx = dx / length
  const ty = dy / length
  const normal = outwardNormal(item.shape, edge.a, edge.b)
  const outerA = { x: edge.a.x + tx * inset + normal.x * depth, y: edge.a.y + ty * inset + normal.y * depth }
  const outerB = { x: edge.b.x - tx * inset + normal.x * depth, y: edge.b.y - ty * inset + normal.y * depth }
  const tab = stroke('cut', { kind: 'polyline', points: [edge.a, outerA, outerB, edge.b], closed: false })
  const creased = item.shape.kind === 'line' ? item.shape : withEdgeRole(item.shape, index, 'crease', item.role)
  const hostRole = item.shape.kind === 'line' ? 'crease' : item.role
  return {
    doc: {
      ...doc,
      pieces: doc.pieces.map((current) => {
        if (current.id !== piece.id) return current
        return detachPiece({
          ...current,
          strokes: current.strokes
            .map((entry) => (entry.id === item.id ? { ...entry, role: hostRole, shape: creased } : entry))
            .concat(tab),
        })
      }),
    },
    strokeId: tab.id,
  }
}

export function addShapeToDoc(doc: Doc, shape: Shape, role: Role, targetId: string | null): { doc: Doc; pieceId: string; strokeId: string } {
  const next = stroke(role, shape)
  if (targetId) {
    const pieces = doc.pieces.map((p) =>
      p.id === targetId ? detachPiece({ ...p, strokes: [...p.strokes, next] }) : p,
    )
    return { doc: { ...doc, pieces }, pieceId: targetId, strokeId: next.id }
  }
  const count = doc.pieces.filter((p) => p.name.startsWith('Pieza')).length + 1
  const piece: Piece = {
    id: uid('pieza'),
    name: `Pieza ${count}`,
    x: 0,
    y: 0,
    rotation: 0,
    strokes: [next],
    image: null,
    source: null,
    detached: true,
  }
  return { doc: { ...doc, pieces: [...doc.pieces, piece] }, pieceId: piece.id, strokeId: next.id }
}

function stroke(role: Role, shape: Shape): Stroke {
  return { id: uid('trazo'), role, shape }
}

export function deleteSelection(doc: Doc, selection: Selection): Doc {
  if (selection.strokeId && selection.pieceIds.length === 1) {
    const pieces = doc.pieces.flatMap((p) => {
      if (p.id !== selection.pieceIds[0]) return [p]
      const strokes = p.strokes.filter((s) => s.id !== selection.strokeId)
      if (strokes.length === 0 && !p.image) return []
      return [detachPiece({ ...p, strokes })]
    })
    return syncGroups({ ...doc, pieces })
  }
  const drop = new Set(selection.pieceIds)
  return syncGroups({ ...doc, pieces: doc.pieces.filter((p) => !drop.has(p.id)) })
}

export function clonePieces(pieces: Piece[], offset: Point): Piece[] {
  return pieces.map((piece) => ({
    ...structuredClone(piece),
    id: uid('pieza'),
    name: `${piece.name} copia`,
    x: piece.x + offset.x,
    y: piece.y + offset.y,
    source: null,
    detached: true,
    strokes: piece.strokes.map((s) => ({ ...s, id: uid('trazo') })),
  }))
}

export function setStrokeRole(doc: Doc, selection: Selection, role: Role): Doc {
  const ids = new Set(selection.pieceIds)
  return {
    ...doc,
    pieces: doc.pieces.map((p) => {
      if (!ids.has(p.id)) return p
      let changed = false
      const strokes = p.strokes.map((s) => {
        if (selection.strokeId && s.id !== selection.strokeId) return s
        if (s.role === role && !hasEdgeRoles(s.shape)) return s
        changed = true
        return { ...s, role, shape: clearEdgeRoles(s.shape) }
      })
      return changed ? detachPiece({ ...p, strokes }) : p
    }),
  }
}

export function withStrokeShape(
  doc: Doc,
  pieceId: string,
  strokeId: string,
  shape: Shape,
): Doc {
  return {
    ...doc,
    pieces: doc.pieces.map((p) => {
      if (p.id !== pieceId) return p
      return detachPiece({
        ...p,
        strokes: p.strokes.map((s) => (s.id === strokeId ? { ...s, shape } : s)),
      })
    }),
  }
}

export function alignPieces(doc: Doc, ids: string[], mode: AlignMode): Doc {
  const selected = doc.pieces.filter((p) => ids.includes(p.id))
  const boxes = selected.map((p) => ({ piece: p, box: pieceWorldBBox(p) })).filter((item) => item.box)
  if (boxes.length < 2) return doc
  const union = docBBox(boxes.map((item) => item.piece))
  if (!union) return doc
  const shifts = new Map<string, Point>()
  for (const item of boxes) {
    const box = item.box!
    let dx = 0
    let dy = 0
    if (mode === 'left') dx = union.x - box.x
    if (mode === 'right') dx = union.x + union.width - (box.x + box.width)
    if (mode === 'centerX') dx = union.x + union.width / 2 - (box.x + box.width / 2)
    if (mode === 'top') dy = union.y - box.y
    if (mode === 'bottom') dy = union.y + union.height - (box.y + box.height)
    if (mode === 'centerY') dy = union.y + union.height / 2 - (box.y + box.height / 2)
    shifts.set(item.piece.id, { x: dx, y: dy })
  }
  return {
    ...doc,
    pieces: doc.pieces.map((p) => {
      const shift = shifts.get(p.id)
      return shift ? { ...p, x: p.x + shift.x, y: p.y + shift.y } : p
    }),
  }
}

export function distributePieces(doc: Doc, ids: string[], axis: 'h' | 'v'): Doc {
  const items = doc.pieces
    .filter((p) => ids.includes(p.id))
    .map((piece) => ({ piece, box: pieceWorldBBox(piece) }))
    .filter((item) => item.box)
  if (items.length < 3) return doc
  const sorted = items.slice().sort((a, b) => {
    const ac = axis === 'h' ? a.box!.x + a.box!.width / 2 : a.box!.y + a.box!.height / 2
    const bc = axis === 'h' ? b.box!.x + b.box!.width / 2 : b.box!.y + b.box!.height / 2
    return ac - bc
  })
  const first = sorted[0].box!
  const last = sorted[sorted.length - 1].box!
  const start = axis === 'h' ? first.x + first.width / 2 : first.y + first.height / 2
  const end = axis === 'h' ? last.x + last.width / 2 : last.y + last.height / 2
  const step = (end - start) / (sorted.length - 1)
  const shifts = new Map<string, number>()
  sorted.forEach((item, index) => {
    const center = axis === 'h' ? item.box!.x + item.box!.width / 2 : item.box!.y + item.box!.height / 2
    shifts.set(item.piece.id, start + step * index - center)
  })
  return {
    ...doc,
    pieces: doc.pieces.map((p) => {
      const delta = shifts.get(p.id)
      if (delta == null) return p
      return axis === 'h' ? { ...p, x: p.x + delta } : { ...p, y: p.y + delta }
    }),
  }
}

export function mirrorPieces(doc: Doc, ids: string[], axis: 'h' | 'v'): Doc {
  const selected = doc.pieces.filter((p) => ids.includes(p.id))
  const union = docBBox(selected)
  if (!union) return doc
  const center = { x: union.x + union.width / 2, y: union.y + union.height / 2 }
  const set = new Set(ids)
  return {
    ...doc,
    pieces: doc.pieces.map((p) => (set.has(p.id) ? mirrorPiece(p, axis, center) : p)),
  }
}

export function rotatePieces(doc: Doc, ids: string[]): Doc {
  const set = new Set(ids)
  return {
    ...doc,
    pieces: doc.pieces.map((p) => (set.has(p.id) ? rotatePiece90(p) : p)),
  }
}

export function makeGroup(doc: Doc, ids: string[]): Doc {
  if (ids.length < 2) return doc
  const set = new Set(ids)
  const groups = doc.groups
    .map((g) => ({ ...g, pieceIds: g.pieceIds.filter((id) => !set.has(id)) }))
    .filter((g) => g.pieceIds.length >= 2)
  const group: Group = { id: uid('grupo'), name: `Grupo ${groups.length + 1}`, pieceIds: ids }
  return { ...doc, groups: [...groups, group] }
}

export function ungroup(doc: Doc, ids: string[]): Doc {
  const set = new Set(ids)
  return {
    ...doc,
    groups: doc.groups.filter((g) => !g.pieceIds.some((id) => set.has(id))),
  }
}

export function setPieceImage(doc: Doc, pieceId: string, image: PieceImage | null): Doc {
  return {
    ...doc,
    pieces: doc.pieces.map((p) => (p.id === pieceId ? { ...p, image } : p)),
  }
}

export function mergeGenerated(doc: Doc, incoming: Piece[]): Doc {
  const generatorId = incoming[0]?.source?.generatorId
  if (!generatorId) return { ...doc, pieces: [...doc.pieces, ...incoming] }
  const reusable = new Map(
    doc.pieces
      .filter((p) => p.source?.generatorId === generatorId && !p.detached)
      .map((p) => [p.name, p]),
  )
  const detached = doc.pieces.filter((p) => p.source?.generatorId === generatorId && p.detached)
  const others = doc.pieces.filter((p) => p.source?.generatorId !== generatorId)
  const merged = incoming.map((piece) => {
    const prev = reusable.get(piece.name)
    if (!prev) return piece
    return {
      ...piece,
      id: prev.id,
      x: prev.x,
      y: prev.y,
      rotation: prev.rotation,
      image: prev.image,
    }
  })
  return syncGroups({ ...doc, pieces: [...others, ...detached, ...merged] })
}

export function packPieces(pieces: Piece[], rowWidth = 1700, gap = 28): Piece[] {
  let x = 0
  let y = 0
  let rowH = 0
  return pieces.map((piece) => {
    const box = pieceWorldBBox({ ...piece, x: 0, y: 0, rotation: 0 })
    const w = box?.width ?? 0
    const h = box?.height ?? 0
    if (x > 0 && x + w > rowWidth) {
      x = 0
      y += rowH + gap
      rowH = 0
    }
    const placed = { ...piece, x: x - (box?.x ?? 0), y: y - (box?.y ?? 0) }
    x += w + gap
    rowH = Math.max(rowH, h)
    return placed
  })
}

export { bakePiece, emptyDoc, emptySelection }
