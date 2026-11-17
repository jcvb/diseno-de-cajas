import { bakePiece, localToWorld, shapeEdges, stroke, uid, worldToLocal } from './geometry.ts'
import { syncGroups } from './ops.ts'
import type { Doc, Piece, Point, Role, Stroke } from './types.ts'

const TOL = 0.75

type Chain = {
  id: string
  pieceId: string
  role: Role
  points: Point[]
  segments: Role[]
  closed: boolean
}

type WeldFocus = { end: 'start' | 'end' | 'both'; origin?: Point }

function near(a: Point, b: Point, tol = TOL): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= tol
}

function endpoint(chain: Chain, end: 'start' | 'end'): Point {
  return end === 'start' ? chain.points[0] : chain.points[chain.points.length - 1]
}

function reversed(chain: Chain): Chain {
  return { ...chain, points: [...chain.points].reverse(), segments: [...chain.segments].reverse() }
}

function toChain(piece: Piece, item: Stroke): Chain | null {
  if (item.shape.kind === 'line') {
    return {
      id: item.id,
      pieceId: piece.id,
      role: item.role,
      points: [localToWorld(piece, item.shape.a), localToWorld(piece, item.shape.b)],
      segments: [item.role],
      closed: false,
    }
  }
  if (item.shape.kind === 'polyline' && !item.shape.closed && item.shape.points.length >= 2) {
    const count = item.shape.points.length - 1
    const edges = shapeEdges(item.shape, item.role) ?? []
    return {
      id: item.id,
      pieceId: piece.id,
      role: item.role,
      points: item.shape.points.map((p) => localToWorld(piece, p)),
      segments: Array.from({ length: count }, (_, i) => edges[i]?.role ?? item.role),
      closed: false,
    }
  }
  return null
}

function findPartner(
  active: Chain,
  others: Chain[],
  end: 'start' | 'end',
  origin?: Point,
): { other: Chain; otherEnd: 'start' | 'end' } | null {
  const point = endpoint(active, end)
  let best: { other: Chain; otherEnd: 'start' | 'end'; dist: number } | null = null
  for (const other of others) {
    if (other.role !== active.role || other.closed) continue
    for (const otherEnd of ['start', 'end'] as const) {
      const target = endpoint(other, otherEnd)
      const dist = Math.hypot(point.x - target.x, point.y - target.y)
      if (dist > TOL) continue
      if (origin && near(origin, target)) continue
      if (!best || dist < best.dist) best = { other, otherEnd, dist }
    }
  }
  return best
}

function mergeChains(active: Chain, activeEnd: 'start' | 'end', other: Chain, otherEnd: 'start' | 'end'): Chain {
  const a = activeEnd === 'end' ? active : reversed(active)
  const b = otherEnd === 'start' ? other : reversed(other)
  return {
    id: active.id,
    pieceId: active.pieceId,
    role: active.role,
    points: [...a.points, ...b.points.slice(1)],
    segments: [...a.segments, ...b.segments],
    closed: false,
  }
}

function closeWith(active: Chain, other: Chain): Chain | null {
  const direct = near(endpoint(active, 'end'), endpoint(other, 'start')) && near(endpoint(active, 'start'), endpoint(other, 'end'))
  const flip = near(endpoint(active, 'end'), endpoint(other, 'end')) && near(endpoint(active, 'start'), endpoint(other, 'start'))
  if (!direct && !flip) return null
  const b = direct ? other : reversed(other)
  const points = [...active.points, ...b.points.slice(1, -1)]
  if (points.length < 3) return { ...active }
  return { ...active, points, segments: [...active.segments, ...b.segments], closed: true }
}

function chainToStroke(chain: Chain, piece: Piece): Stroke {
  const points = chain.points.map((p) => worldToLocal(piece, p))
  const mixed = chain.segments.some((role) => role !== chain.role)
  const segmentsOk = chain.closed ? chain.segments.length === points.length : chain.segments.length === points.length - 1
  if (!chain.closed && points.length === 2 && !mixed) {
    return { id: chain.id, role: chain.role, shape: { kind: 'line', a: points[0], b: points[1] } }
  }
  return {
    id: chain.id,
    role: chain.role,
    shape: {
      kind: 'polyline',
      points,
      closed: chain.closed,
      ...(mixed && segmentsOk ? { segments: chain.segments } : {}),
    },
  }
}

function writeBack(doc: Doc, chain: Chain, removed: string[]): Doc {
  const host = doc.pieces.find((piece) => piece.id === chain.pieceId)
  if (!host) return doc
  const nextStroke = chainToStroke(chain, host)
  const gone = new Set(removed)
  const pieces = doc.pieces
    .map((piece) => {
      const strokes = piece.strokes.flatMap((item) => {
        if (gone.has(item.id)) return []
        if (item.id === chain.id && piece.id === chain.pieceId) return [nextStroke]
        return [item]
      })
      const changed = strokes.length !== piece.strokes.length || strokes.some((item, index) => item !== piece.strokes[index])
      return changed ? { ...piece, strokes, detached: true } : piece
    })
    .filter((piece) => piece.strokes.length > 0 || piece.image)
  return syncGroups({ ...doc, pieces })
}

export function weldOpenStroke(doc: Doc, pieceId: string, strokeId: string, focus: WeldFocus = { end: 'both' }): { doc: Doc; joined: number } {
  const chains: Chain[] = []
  for (const piece of doc.pieces) {
    for (const item of piece.strokes) {
      const chain = toChain(piece, item)
      if (chain) chains.push(chain)
    }
  }
  const original = chains.find((chain) => chain.id === strokeId && chain.pieceId === pieceId)
  if (!original) return { doc, joined: 0 }
  const removed: string[] = []
  let joined = 0
  let active = original
  const pool = () => chains.filter((chain) => chain.id !== original.id && !removed.includes(chain.id))

  if (focus.end === 'both') {
    const twin = pool().find((chain) => chain.role === active.role && closeWith(active, chain))
    if (twin) {
      active = closeWith(active, twin) ?? active
      removed.push(twin.id)
      joined++
    }
  }

  if (!active.closed) {
    const startPartner = focus.end === 'end' ? null : findPartner(original, pool(), 'start', focus.origin)
    const endPartner = focus.end === 'start' ? null : findPartner(original, pool(), 'end', focus.origin)
    if (startPartner && endPartner && startPartner.other.id === endPartner.other.id) {
      active = closeWith(original, startPartner.other) ?? original
      removed.push(startPartner.other.id)
      joined++
    } else {
      if (startPartner) {
        active = mergeChains(active, 'start', startPartner.other, startPartner.otherEnd)
        removed.push(startPartner.other.id)
        joined++
      }
      if (endPartner) {
        const endAfter = startPartner ? 'start' : 'end'
        active = mergeChains(active, endAfter, endPartner.other, endPartner.otherEnd)
        removed.push(endPartner.other.id)
        joined++
      }
    }
  }

  if (!active.closed && active.points.length >= 4 && near(active.points[0], active.points[active.points.length - 1])) {
    const already = focus.origin && near(focus.origin, active.points[0]) && near(focus.origin, active.points[active.points.length - 1])
    if (!already) {
      active = { ...active, points: active.points.slice(0, -1), closed: true }
      joined++
    }
  }

  if (joined === 0) return { doc, joined: 0 }
  return { doc: writeBack(doc, active, removed), joined }
}

export function weldSelection(doc: Doc, pieceIds: string[]): { doc: Doc; joined: number } {
  let current = doc
  let total = 0
  const allowed = new Set(pieceIds)
  for (let pass = 0; pass < 40; pass++) {
    const target = firstTouching(current, allowed)
    if (!target) break
    const result = weldOpenStroke(current, target.pieceId, target.strokeId, { end: 'both' })
    if (result.joined === 0) break
    current = result.doc
    total += result.joined
  }
  return { doc: current, joined: total }
}

function firstTouching(doc: Doc, allowed: Set<string>): { pieceId: string; strokeId: string } | null {
  const chains: Chain[] = []
  for (const piece of doc.pieces) {
    if (!allowed.has(piece.id)) continue
    for (const item of piece.strokes) {
      const chain = toChain(piece, item)
      if (chain) chains.push(chain)
    }
  }
  for (const chain of chains) {
    const others = chains.filter((other) => other.id !== chain.id)
    if (findPartner(chain, others, 'start') || findPartner(chain, others, 'end')) {
      return { pieceId: chain.pieceId, strokeId: chain.id }
    }
  }
  return null
}

function loopOf(item: Stroke): Point[] | null {
  if (item.role !== 'cut') return null
  if (item.shape.kind === 'rect') {
    const edges = shapeEdges(item.shape, 'cut')
    return edges ? edges.map((edge) => edge.a) : null
  }
  if (item.shape.kind === 'polyline' && item.shape.closed && item.shape.points.length >= 3) {
    const pts = item.shape.points
    if (near(pts[0], pts[pts.length - 1], 0.05) && pts.length >= 4) return pts.slice(0, -1)
    return pts
  }
  return null
}

function findShared(a: Point[], b: Point[], tol: number): { ai: number; bi: number; flip: boolean } | null {
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i]
    const a2 = a[(i + 1) % a.length]
    if (Math.hypot(a2.x - a1.x, a2.y - a1.y) < 2) continue
    for (let j = 0; j < b.length; j++) {
      const b1 = b[j]
      const b2 = b[(j + 1) % b.length]
      if (near(a1, b1, tol) && near(a2, b2, tol)) return { ai: i, bi: j, flip: false }
      if (near(a1, b2, tol) && near(a2, b1, tol)) return { ai: i, bi: j, flip: true }
    }
  }
  return null
}

function joinLoops(a: Point[], b: Point[], shared: { ai: number; bi: number; flip: boolean }): Point[] {
  const open = (points: Point[], edge: number) => {
    const result: Point[] = []
    for (let k = 1; k <= points.length; k++) result.push(points[(edge + k) % points.length])
    return result
  }
  const aOpen = open(a, shared.ai)
  const bOpen = shared.flip ? open(b, shared.bi) : [...open(b, shared.bi)].reverse()
  return [...aOpen, ...bOpen.slice(1, -1)]
}

function fuseTouchingCuts(strokes: Stroke[]): Stroke[] {
  let current = strokes
  for (let pass = 0; pass < 20; pass++) {
    let merged: Stroke[] | null = null
    for (let i = 0; i < current.length && !merged; i++) {
      const a = loopOf(current[i])
      if (!a) continue
      for (let j = i + 1; j < current.length && !merged; j++) {
        const b = loopOf(current[j])
        if (!b) continue
        const shared = findShared(a, b, 1.2)
        if (!shared) continue
        const points = joinLoops(a, b, shared)
        if (points.length < 3) continue
        const cut = stroke('cut', { kind: 'polyline', points, closed: true })
        const crease = stroke('crease', {
          kind: 'line',
          a: a[shared.ai],
          b: a[(shared.ai + 1) % a.length],
        })
        merged = [...current.filter((_, index) => index !== i && index !== j), cut, crease]
      }
    }
    if (!merged) return current
    current = merged
  }
  return current
}

export function unitePieces(doc: Doc, ids: string[]): Doc {
  const set = new Set(ids)
  const selected = doc.pieces.filter((piece) => set.has(piece.id))
  if (selected.length < 2) return doc
  const strokes: Stroke[] = []
  let image: Piece['image'] = null
  for (const piece of selected) {
    const baked = bakePiece(piece)
    if (!image && baked.image) image = baked.image
    for (const item of baked.strokes) strokes.push({ ...item, id: uid('trazo') })
  }
  const united: Piece = {
    id: selected[0].id,
    name: selected[0].name,
    x: 0,
    y: 0,
    rotation: 0,
    strokes: fuseTouchingCuts(strokes),
    image,
    source: null,
    detached: true,
  }
  const next = syncGroups({
    ...doc,
    pieces: [...doc.pieces.filter((piece) => !set.has(piece.id)), united],
  })
  return weldSelection(next, [united.id]).doc
}
