import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping'
import {
  isClosed,
  localToWorld,
  mergeCollinearPoints,
  pieceWorldBBox,
  shapeEdges,
  shapeToPolylines,
  stroke,
  worldToLocal,
} from './geometry.ts'
import { syncGroups } from './ops.ts'
import type { BBox, Doc, Piece, Point, Role, Shape, Stroke } from './types.ts'
import { weldSelection } from './weld.ts'

export type PathOp = 'union' | 'intersect' | 'subtract' | 'exclude' | 'divide' | 'align'

type ClosedItem = { pieceId: string; strokeId: string; role: Role; world: Point[] }
type Straight = { pieceId: string; strokeId: string; role: Role; a: Point; b: Point }

function near(a: Point, b: Point, tolerance = 0.45): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= tolerance
}

function ringArea(points: Point[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const next = points[(i + 1) % points.length]
    sum += points[i].x * next.y - next.x * points[i].y
  }
  return sum / 2
}

function pointInRing(p: Point, ring: Point[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i].y
    const yj = ring[j].y
    const intersect = yi > p.y !== yj > p.y && p.x < ((ring[j].x - ring[i].x) * (p.y - yi)) / (yj - yi || 1e-9) + ring[i].x
    if (intersect) inside = !inside
  }
  return inside
}

function onSegment(p: Point, a: Point, b: Point, tolerance: number): boolean {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = dx * dx + dy * dy
  if (len < 1e-9) return near(p, a, tolerance)
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len
  if (t < -0.02 || t > 1.02) return false
  const q = { x: a.x + t * dx, y: a.y + t * dy }
  return near(p, q, tolerance)
}

function closedWorld(piece: Piece, item: Stroke): Point[] | null {
  if (!isClosed(item.shape)) return null
  const poly = shapeToPolylines(item.shape)[0]
  if (!poly || poly.points.length < 4) return null
  const points = poly.points.map((p) => localToWorld(piece, p))
  if (near(points[0], points[points.length - 1], 0.05)) points.pop()
  return points.length >= 3 ? points : null
}

function openWorld(piece: Piece, item: Stroke): Point[] | null {
  if (isClosed(item.shape)) return null
  if (item.shape.kind === 'line') return [localToWorld(piece, item.shape.a), localToWorld(piece, item.shape.b)]
  if (item.shape.kind === 'polyline' && item.shape.points.length >= 2) {
    return mergeCollinearPoints(item.shape.points.map((p) => localToWorld(piece, p)), false)
  }
  const poly = shapeToPolylines(item.shape)[0]
  if (!poly || poly.points.length < 2) return null
  return poly.points.map((p) => localToWorld(piece, p))
}

function segIntersect(a: Point, b: Point, c: Point, d: Point): { point: Point; t: number; u: number } | null {
  const rx = b.x - a.x
  const ry = b.y - a.y
  const sx = d.x - c.x
  const sy = d.y - c.y
  const den = rx * sy - ry * sx
  if (Math.abs(den) < 1e-8) return null
  const qpx = c.x - a.x
  const qpy = c.y - a.y
  const t = (qpx * sy - qpy * sx) / den
  const u = (qpx * ry - qpy * rx) / den
  if (t < -1e-4 || t > 1 + 1e-4 || u < -1e-4 || u > 1 + 1e-4) return null
  return { point: { x: a.x + t * rx, y: a.y + t * ry }, t, u }
}

type Hit = { edge: number; u: number; t: number; point: Point }

function hitsOnRing(ring: Point[], a: Point, b: Point): Hit[] {
  const hits: Hit[] = []
  for (let i = 0; i < ring.length; i++) {
    const found = segIntersect(a, b, ring[i], ring[(i + 1) % ring.length])
    if (found) hits.push({ edge: i, u: found.u, t: found.t, point: found.point })
  }
  return hits
}

function insertHits(ring: Point[], hits: Hit[]): { ring: Point[]; markers: { t: number; point: Point }[] } {
  const extra = new Map<number, Hit[]>()
  const markers: { t: number; point: Point }[] = []
  const seen = (point: Point) => markers.some((mark) => near(mark.point, point, 0.35))
  for (const hit of hits) {
    const start = ring[hit.edge]
    const end = ring[(hit.edge + 1) % ring.length]
    if (near(hit.point, start, 0.35)) {
      if (!seen(start)) markers.push({ t: hit.t, point: start })
      continue
    }
    if (near(hit.point, end, 0.35)) {
      if (!seen(end)) markers.push({ t: hit.t, point: end })
      continue
    }
    const list = extra.get(hit.edge) ?? []
    list.push(hit)
    extra.set(hit.edge, list)
  }
  const out: Point[] = []
  for (let i = 0; i < ring.length; i++) {
    out.push(ring[i])
    const list = (extra.get(i) ?? []).sort((left, right) => left.u - right.u)
    for (const hit of list) {
      if (seen(hit.point)) continue
      out.push(hit.point)
      markers.push({ t: hit.t, point: hit.point })
    }
  }
  return { ring: out, markers }
}

function splitRing(ring: Point[], ia: number, ib: number): [Point[], Point[]] {
  const lo = Math.min(ia, ib)
  const hi = Math.max(ia, ib)
  return [ring.slice(lo, hi + 1), [...ring.slice(hi), ...ring.slice(0, lo + 1)]]
}

function indexOfPoint(ring: Point[], point: Point): number {
  return ring.findIndex((item) => near(item, point, 0.4))
}

export function splitRingBySegment(ring: Point[], a: Point, b: Point): Point[][] | null {
  const hits = hitsOnRing(ring, a, b)
  if (hits.length < 2) return null
  const inserted = insertHits(ring, hits)
  const ordered = inserted.markers.sort((left, right) => left.t - right.t)
  const unique: { t: number; point: Point }[] = []
  for (const mark of ordered) {
    if (unique.some((item) => near(item.point, mark.point, 0.4))) continue
    unique.push(mark)
  }
  if (unique.length < 2) return null
  const pairs: [Point, Point][] = []
  for (let i = 0; i < unique.length - 1; i++) {
    const mid = {
      x: (unique[i].point.x + unique[i + 1].point.x) / 2,
      y: (unique[i].point.y + unique[i + 1].point.y) / 2,
    }
    const chord = Math.hypot(unique[i + 1].point.x - unique[i].point.x, unique[i + 1].point.y - unique[i].point.y)
    if (chord >= 1 && pointInRing(mid, ring)) pairs.push([unique[i].point, unique[i + 1].point])
  }
  if (pairs.length === 0) return null
  let parts = [inserted.ring]
  for (const [start, end] of pairs) {
    const host = parts.findIndex((part) => indexOfPoint(part, start) >= 0 && indexOfPoint(part, end) >= 0)
    if (host < 0) continue
    const current = parts[host]
    const ia = indexOfPoint(current, start)
    const ib = indexOfPoint(current, end)
    if (ia < 0 || ib < 0 || ia === ib) continue
    const [first, second] = splitRing(current, ia, ib)
    if (first.length < 3 || second.length < 3) continue
    if (Math.abs(ringArea(first)) < 1 || Math.abs(ringArea(second)) < 1) continue
    parts.splice(host, 1, mergeCollinearPoints(first, true), mergeCollinearPoints(second, true))
  }
  return parts.length > 1 ? parts : null
}

function edgeRole(a: Point, b: Point, original: { a: Point; b: Point; role: Role }[], chordRole: Role): Role {
  for (const edge of original) {
    if (onSegment(a, edge.a, edge.b, 0.45) && onSegment(b, edge.a, edge.b, 0.45)) return edge.role
  }
  return chordRole
}

function ringToShape(world: Point[], piece: Piece, role: Role, original: { a: Point; b: Point; role: Role }[], chordRole: Role): Shape {
  const points = mergeCollinearPoints(world.map((p) => worldToLocal(piece, p)), true)
  const segments = points.map((point, index) => {
    const next = points[(index + 1) % points.length]
    return edgeRole(localToWorld(piece, point), localToWorld(piece, next), original, chordRole)
  })
  const mixed = segments.some((item) => item !== role)
  return { kind: 'polyline', points, closed: true, ...(mixed ? { segments } : {}) }
}

function outsideOfPath(path: Point[], ring: Point[]): Point[][] {
  const chunks: Point[][] = []
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    const hits = hitsOnRing(ring, a, b).sort((left, right) => left.t - right.t)
    const marks = [0]
    for (const hit of hits) {
      const t = Math.min(1, Math.max(0, hit.t))
      if (marks.some((item) => Math.abs(item - t) < 0.002)) continue
      marks.push(t)
    }
    marks.push(1)
    for (let k = 0; k < marks.length - 1; k++) {
      const t0 = marks[k]
      const t1 = marks[k + 1]
      if (t1 - t0 < 0.002) continue
      const mid = { x: a.x + ((t0 + t1) / 2) * (b.x - a.x), y: a.y + ((t0 + t1) / 2) * (b.y - a.y) }
      if (pointInRing(mid, ring)) continue
      const p0 = { x: a.x + t0 * (b.x - a.x), y: a.y + t0 * (b.y - a.y) }
      const p1 = { x: a.x + t1 * (b.x - a.x), y: a.y + t1 * (b.y - a.y) }
      if (Math.hypot(p1.x - p0.x, p1.y - p0.y) < 0.8) continue
      const last = chunks[chunks.length - 1]
      if (last && near(last[last.length - 1], p0, 0.4)) last.push(p1)
      else chunks.push([p0, p1])
    }
  }
  return chunks
}

function pathToShape(world: Point[], piece: Piece): Shape | null {
  const points = mergeCollinearPoints(world.map((p) => worldToLocal(piece, p)), false)
  if (points.length < 2) return null
  if (points.length === 2) return { kind: 'line', a: points[0], b: points[1] }
  return { kind: 'polyline', points, closed: false }
}

export function splitCrossings(doc: Doc, pieceId: string, strokeId: string): { doc: Doc; count: number } {
  const host = doc.pieces.find((piece) => piece.id === pieceId)
  const cutter = host?.strokes.find((item) => item.id === strokeId)
  if (!host || !cutter) return { doc, count: 0 }
  const path = openWorld(host, cutter)
  if (!path || path.length < 2) return { doc, count: 0 }
  const replacements: { pieceId: string; strokeId: string; shapes: Shape[]; role: Role }[] = []
  const cutRings: Point[][] = []
  for (const piece of doc.pieces) {
    for (const item of piece.strokes) {
      if (item.id === strokeId) continue
      const ring = closedWorld(piece, item)
      if (!ring) continue
      let parts = [ring]
      let did = false
      for (let i = 1; i < path.length; i++) {
        const next: Point[][] = []
        for (const part of parts) {
          const split = splitRingBySegment(part, path[i - 1], path[i])
          if (!split) next.push(part)
          else {
            did = true
            next.push(...split)
          }
        }
        parts = next
      }
      if (!did) continue
      const original = (shapeEdges(item.shape, item.role) ?? []).map((edge) => ({
        a: localToWorld(piece, edge.a),
        b: localToWorld(piece, edge.b),
        role: edge.role,
      }))
      replacements.push({
        pieceId: piece.id,
        strokeId: item.id,
        role: item.role,
        shapes: parts.map((part) => ringToShape(part, piece, item.role, original, cutter.role)),
      })
      cutRings.push(ring)
    }
  }
  if (replacements.length === 0) return { doc, count: 0 }
  let stubs: Point[][] = [path]
  for (const ring of cutRings) stubs = stubs.flatMap((stub) => outsideOfPath(stub, ring))
  const stubShapes = stubs.map((stub) => pathToShape(stub, host)).filter((shape): shape is Shape => shape != null)
  const pieces = doc.pieces
    .map((piece) => {
      let touched = false
      const strokes = piece.strokes.flatMap((item) => {
        const replacement = replacements.find((entry) => entry.pieceId === piece.id && entry.strokeId === item.id)
        if (replacement) {
          touched = true
          return replacement.shapes.map((shape) => stroke(replacement.role, shape))
        }
        if (piece.id === host.id && item.id === strokeId) {
          touched = true
          return stubShapes.map((shape) => stroke(cutter.role, shape))
        }
        return [item]
      })
      return touched ? { ...piece, strokes, detached: true } : piece
    })
    .filter((piece) => piece.strokes.length > 0 || piece.image)
  return { doc: syncGroups({ ...doc, pieces }), count: replacements.length }
}

function collectStraight(doc: Doc, pieceIds?: string[], preferred?: string): Straight[] {
  const limit = pieceIds ? new Set(pieceIds) : null
  const lines: Straight[] = []
  for (const piece of doc.pieces) {
    if (limit && !limit.has(piece.id) && !piece.strokes.some((item) => item.id === preferred)) continue
    for (const item of piece.strokes) {
      const path = openWorld(piece, item)
      if (!path || path.length !== 2) continue
      lines.push({ pieceId: piece.id, strokeId: item.id, role: item.role, a: path[0], b: path[1] })
    }
  }
  return lines
}

function projection(point: Point, origin: Point, direction: Point): number {
  return (point.x - origin.x) * direction.x + (point.y - origin.y) * direction.y
}

function overlapPair(left: Straight, right: Straight): { a: Point; b: Point } | null {
  if (left.role !== right.role || left.strokeId === right.strokeId) return null
  const dx = left.b.x - left.a.x
  const dy = left.b.y - left.a.y
  const len = Math.hypot(dx, dy) || 1
  const direction = { x: dx / len, y: dy / len }
  const distance = (point: Point) => Math.abs((point.x - left.a.x) * -direction.y + (point.y - left.a.y) * direction.x)
  if (distance(right.a) > 0.8 || distance(right.b) > 0.8) return null
  const rdx = right.b.x - right.a.x
  const rdy = right.b.y - right.a.y
  const rlen = Math.hypot(rdx, rdy) || 1
  const sin = Math.abs(dx * rdy - dy * rdx) / (len * rlen)
  if (sin > 0.06) return null
  const ts = [left.a, left.b, right.a, right.b].map((point) => projection(point, left.a, direction))
  const span = [Math.min(ts[0], ts[1]), Math.max(ts[0], ts[1]), Math.min(ts[2], ts[3]), Math.max(ts[2], ts[3])]
  const gap = Math.max(span[0], span[2]) - Math.min(span[1], span[3])
  if (gap > 0.8) return null
  const min = Math.min(...ts)
  const max = Math.max(...ts)
  if (max - min < 1) return null
  return {
    a: { x: left.a.x + direction.x * min, y: left.a.y + direction.y * min },
    b: { x: left.a.x + direction.x * max, y: left.a.y + direction.y * max },
  }
}

export function mergeCollinearOpens(doc: Doc, pieceIds?: string[], preferred?: string): { doc: Doc; merged: number } {
  let current = doc
  let merged = 0
  for (let pass = 0; pass < 40; pass++) {
    const lines = collectStraight(current, pieceIds, preferred)
    let pair: { keep: Straight; drop: Straight; a: Point; b: Point } | null = null
    for (let i = 0; i < lines.length && !pair; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        if (preferred && lines[i].strokeId !== preferred && lines[j].strokeId !== preferred) continue
        const span = overlapPair(lines[i], lines[j])
        if (!span) continue
        const keep = lines[i].strokeId === preferred ? lines[i] : lines[j].strokeId === preferred ? lines[j] : lines[i]
        const drop = keep === lines[i] ? lines[j] : lines[i]
        pair = { keep, drop, a: span.a, b: span.b }
      }
    }
    if (!pair) break
    const found = pair
    const host = current.pieces.find((piece) => piece.id === found.keep.pieceId)
    if (!host) break
    const shape: Shape = { kind: 'line', a: worldToLocal(host, found.a), b: worldToLocal(host, found.b) }
    const dropId = found.drop.strokeId
    const keepId = found.keep.strokeId
    const pieces = current.pieces
      .map((piece) => {
        const strokes = piece.strokes.flatMap((item) => {
          if (item.id === dropId) return []
          if (item.id === keepId && piece.id === host.id) return [{ ...item, role: found.keep.role, shape }]
          return [item]
        })
        const touched = strokes.length !== piece.strokes.length || piece.id === host.id
        return touched ? { ...piece, strokes, detached: true } : piece
      })
      .filter((piece) => piece.strokes.length > 0 || piece.image)
    current = syncGroups({ ...current, pieces })
    merged++
  }
  return { doc: current, merged }
}

export function simplifyStroke(doc: Doc, pieceId: string, strokeId: string): Doc {
  const piece = doc.pieces.find((item) => item.id === pieceId)
  const strokeItem = piece?.strokes.find((item) => item.id === strokeId)
  if (!piece || !strokeItem || strokeItem.shape.kind !== 'polyline') return doc
  const points = mergeCollinearPoints(strokeItem.shape.points, strokeItem.shape.closed)
  if (points.length === strokeItem.shape.points.length) return doc
  const shape: Shape =
    !strokeItem.shape.closed && points.length === 2
      ? { kind: 'line', a: points[0], b: points[1] }
      : { kind: 'polyline', points, closed: strokeItem.shape.closed }
  return {
    ...doc,
    pieces: doc.pieces.map((item) =>
      item.id === pieceId
        ? {
            ...item,
            detached: true,
            strokes: item.strokes.map((entry) => (entry.id === strokeId ? { ...entry, shape } : entry)),
          }
        : item,
    ),
  }
}

export function finishStroke(doc: Doc, pieceId: string, strokeId: string): { doc: Doc; split: number; merged: number } {
  let current = simplifyStroke(doc, pieceId, strokeId)
  const merged = mergeCollinearOpens(current, undefined, strokeId)
  current = merged.doc
  const split = splitCrossings(current, pieceId, strokeId)
  return { doc: split.doc, split: split.count, merged: merged.merged }
}

function collectClosed(doc: Doc, pieceIds: string[]): ClosedItem[] {
  const items: ClosedItem[] = []
  for (const id of pieceIds) {
    const piece = doc.pieces.find((item) => item.id === id)
    if (!piece) continue
    for (const strokeItem of piece.strokes) {
      const world = closedWorld(piece, strokeItem)
      if (world) items.push({ pieceId: id, strokeId: strokeItem.id, role: strokeItem.role, world })
    }
  }
  return items
}

function fullyInside(inner: Point[], outer: Point[]): boolean {
  return inner.every((point) => pointInRing(point, outer))
}

function ringsForOp(doc: Doc, pieceIds: string[]): ClosedItem[] {
  const all = collectClosed(doc, pieceIds)
  const chosen: ClosedItem[] = []
  for (const id of pieceIds) {
    const group = all.filter((item) => item.pieceId === id)
    if (group.length === 0) continue
    const largest = group.reduce((best, item) => (Math.abs(ringArea(item.world)) > Math.abs(ringArea(best.world)) ? item : best))
    chosen.push(largest)
    for (const item of group) {
      if (item.strokeId === largest.strokeId) continue
      if (fullyInside(item.world, largest.world)) continue
      chosen.push(item)
    }
  }
  return chosen
}

function toPolygon(ring: Point[]): Polygon {
  const pairs = ring.map((point) => [Math.round(point.x * 1000) / 1000, Math.round(point.y * 1000) / 1000] as [number, number])
  const first = pairs[0]
  const last = pairs[pairs.length - 1]
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) pairs.push([first[0], first[1]])
  return [pairs]
}

function fromMulti(multi: MultiPolygon, keep: Point[] = []): Point[][] {
  const rings: Point[][] = []
  for (const poly of multi) {
    for (const ring of poly) {
      let points = ring.map(([x, y]) => ({ x, y }))
      if (points.length > 1 && near(points[0], points[points.length - 1], 0.02)) points.pop()
      if (keep.length > 0) points = dedupeRing(restoreVertices(snapToVertices(points, keep), keep))
      const clean = mergeCollinearPoints(points, true, keep)
      if (clean.length >= 3 && Math.abs(ringArea(clean)) > 0.5) rings.push(clean)
    }
  }
  return rings
}

function dedupeRing(points: Point[]): Point[] {
  const out: Point[] = []
  for (const point of points) {
    const last = out[out.length - 1]
    if (last && near(last, point, 0.05)) continue
    out.push(point)
  }
  if (out.length > 1 && near(out[0], out[out.length - 1], 0.05)) out.pop()
  return out
}

function snapToVertices(ring: Point[], vertices: Point[]): Point[] {
  return ring.map((point) => {
    let best = point
    let bestDist = 0.35
    for (const vertex of vertices) {
      const dist = Math.hypot(point.x - vertex.x, point.y - vertex.y)
      if (dist < bestDist) {
        best = vertex
        bestDist = dist
      }
    }
    return { x: best.x, y: best.y }
  })
}

function restoreVertices(ring: Point[], vertices: Point[]): Point[] {
  const extras = new Map<number, { t: number; point: Point }[]>()
  for (const vertex of vertices) {
    if (ring.some((point) => near(point, vertex, 0.35))) continue
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len2 = dx * dx + dy * dy
      if (len2 < 1e-9) continue
      const t = ((vertex.x - a.x) * dx + (vertex.y - a.y) * dy) / len2
      if (t <= 0.002 || t >= 0.998) continue
      const q = { x: a.x + t * dx, y: a.y + t * dy }
      if (!near(vertex, q, 0.4)) continue
      const list = extras.get(i) ?? []
      if (list.some((item) => near(item.point, vertex, 0.35))) break
      list.push({ t, point: { x: vertex.x, y: vertex.y } })
      extras.set(i, list)
      break
    }
  }
  if (extras.size === 0) return ring
  const out: Point[] = []
  for (let i = 0; i < ring.length; i++) {
    out.push(ring[i])
    for (const item of (extras.get(i) ?? []).sort((left, right) => left.t - right.t)) out.push(item.point)
  }
  return out
}

function combine(op: Exclude<PathOp, 'align' | 'divide'>, rings: Point[][]): Point[][] {
  const [first, ...rest] = rings
  if (!first) return []
  const subject = toPolygon(first)
  const clips = rest.map(toPolygon)
  if (clips.length === 0) return [first]
  if (op === 'union') return fromMulti(polygonClipping.union(subject, ...clips), rings.flat())
  if (op === 'intersect') return fromMulti(polygonClipping.intersection(subject, ...clips))
  if (op === 'subtract') return fromMulti(polygonClipping.difference(subject, ...clips))
  return fromMulti(polygonClipping.xor(subject, ...clips))
}

function divideRegions(rings: Point[][]): Point[][] {
  let regions = [rings[0]]
  for (let i = 1; i < rings.length; i++) {
    const clip = rings[i]
    const next: Point[][] = []
    let remainder = [clip]
    for (const region of regions) {
      next.push(...fromMulti(polygonClipping.difference(toPolygon(region), toPolygon(clip))))
      next.push(...fromMulti(polygonClipping.intersection(toPolygon(region), toPolygon(clip))))
      remainder = remainder.flatMap((part) => fromMulti(polygonClipping.difference(toPolygon(part), toPolygon(region))))
    }
    regions = [...next, ...remainder].filter((ring) => Math.abs(ringArea(ring)) > 0.5)
  }
  return regions
}

function writeRings(doc: Doc, items: ClosedItem[], rings: Point[][], preserveVertices = false): Doc {
  const host = doc.pieces.find((piece) => piece.id === items[0].pieceId)
  if (!host) return doc
  const consumed = new Set(items.map((item) => item.strokeId))
  const keep = preserveVertices ? items.flatMap((item) => item.world).map((point) => worldToLocal(host, point)) : []
  const created = rings.map((ring) =>
    stroke(items[0].role, {
      kind: 'polyline' as const,
      points: mergeCollinearPoints(ring.map((point) => worldToLocal(host, point)), true, keep),
      closed: true,
    }),
  )
  const pieces = doc.pieces
    .map((piece) => {
      const strokes = piece.strokes.filter((item) => !consumed.has(item.id))
      if (piece.id === host.id) strokes.push(...created)
      if (strokes.length === piece.strokes.length && piece.id !== host.id) return piece
      return { ...piece, strokes, detached: true }
    })
    .filter((piece) => piece.strokes.length > 0 || piece.image)
  return syncGroups({ ...doc, pieces })
}

function alignSelection(doc: Doc, pieceIds: string[]): { doc: Doc; changed: boolean; message: string } {
  const ids = new Set(pieceIds)
  type Cloud = { pieceId: string; strokeId: string; role: Role; closed: boolean; points: Point[] }
  const clouds: Cloud[] = []
  const originals = new Map<string, Point[]>()
  for (const piece of doc.pieces) {
    if (!ids.has(piece.id)) continue
    for (const item of piece.strokes) {
      const closed = closedWorld(piece, item)
      const open = closed ? null : openWorld(piece, item)
      const points = closed ?? open
      if (!points || points.length < 2) continue
      originals.set(item.id, points.map((p) => ({ ...p })))
      clouds.push({ pieceId: piece.id, strokeId: item.id, role: item.role, closed: !!closed, points: points.map((p) => ({ ...p })) })
    }
  }
  if (clouds.length === 0) return { doc, changed: false, message: 'No hay trazos para alinear.' }
  const flat = clouds.flatMap((cloud, cloudIndex) =>
    cloud.points.map((point, index) => {
      const prev = cloud.points[(index - 1 + cloud.points.length) % cloud.points.length]
      const next = cloud.points[(index + 1) % cloud.points.length]
      const weight = Math.max(Math.hypot(point.x - prev.x, point.y - prev.y), Math.hypot(next.x - point.x, next.y - point.y))
      return { cloudIndex, index, point, weight }
    }),
  )
  const snapped = flat.map((item) => ({ x: item.point.x, y: item.point.y }))
  for (let i = 0; i < flat.length; i++) {
    let nextX: number | null = null
    let nextY: number | null = null
    let bestX = 1.25
    let bestY = 1.25
    for (let j = 0; j < flat.length; j++) {
      if (i === j || flat[j].weight + 0.01 < flat[i].weight) continue
      const dx = Math.abs(flat[i].point.x - flat[j].point.x)
      const dy = Math.abs(flat[i].point.y - flat[j].point.y)
      if (dx <= bestX) {
        bestX = dx
        nextX = flat[j].point.x
      }
      if (dy <= bestY) {
        bestY = dy
        nextY = flat[j].point.y
      }
    }
    if (nextX != null) snapped[i].x = nextX
    if (nextY != null) snapped[i].y = nextY
  }
  flat.forEach((item, index) => {
    clouds[item.cloudIndex].points[item.index] = snapped[index]
  })
  for (let i = 0; i < clouds.length; i++) {
    const count = clouds[i].closed ? clouds[i].points.length : clouds[i].points.length - 1
    for (let e = 0; e < count; e++) {
      const a = clouds[i].points[e]
      const b = clouds[i].points[(e + 1) % clouds[i].points.length]
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      if (len < 1) continue
      let target: { a: Point; b: Point; len: number } | null = null
      for (let j = 0; j < clouds.length; j++) {
        const otherCount = clouds[j].closed ? clouds[j].points.length : clouds[j].points.length - 1
        for (let k = 0; k < otherCount; k++) {
          if (i === j && e === k) continue
          const c = clouds[j].points[k]
          const d = clouds[j].points[(k + 1) % clouds[j].points.length]
          const otherLen = Math.hypot(d.x - c.x, d.y - c.y)
          if (otherLen <= len) continue
          const sin = Math.abs((b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x)) / (len * otherLen)
          if (sin > 0.08) continue
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
          const dist = Math.abs((mid.x - c.x) * -(d.y - c.y) + (mid.y - c.y) * (d.x - c.x)) / otherLen
          if (dist <= 1.25 && (!target || otherLen > target.len)) target = { a: c, b: d, len: otherLen }
        }
      }
      if (!target) continue
      const dx = target.b.x - target.a.x
      const dy = target.b.y - target.a.y
      const denom = dx * dx + dy * dy || 1
      const project = (point: Point) => {
        const t = ((point.x - target.a.x) * dx + (point.y - target.a.y) * dy) / denom
        return { x: target.a.x + t * dx, y: target.a.y + t * dy }
      }
      clouds[i].points[e] = project(a)
      clouds[i].points[(e + 1) % clouds[i].points.length] = project(b)
    }
  }
  let changed = false
  const pieces = doc.pieces.map((piece) => {
    if (!ids.has(piece.id)) return piece
    let pieceChanged = false
    const strokes = piece.strokes.map((item) => {
      const cloud = clouds.find((entry) => entry.strokeId === item.id)
      const source = originals.get(item.id)
      if (!cloud || !source) return item
      const moved = cloud.points.some((point, index) => !near(point, source[index] ?? point, 0.05))
      const simplified = mergeCollinearPoints(cloud.points, cloud.closed)
      if (!moved && simplified.length === cloud.points.length) return item
      pieceChanged = true
      const local = simplified.map((point) => worldToLocal(piece, point))
      const shape: Shape =
        !cloud.closed && local.length === 2
          ? { kind: 'line', a: local[0], b: local[1] }
          : { kind: 'polyline', points: local, closed: cloud.closed }
      return { ...item, shape }
    })
    if (!pieceChanged) return piece
    changed = true
    return { ...piece, strokes, detached: true }
  })
  let next = changed ? { ...doc, pieces } : doc
  const merged = mergeCollinearOpens(next, pieceIds)
  next = merged.doc
  const welded = weldSelection(next, pieceIds)
  next = welded.doc
  if (!changed && merged.merged === 0 && welded.joined === 0) {
    return { doc, changed: false, message: 'Las aristas ya compartían la misma línea.' }
  }
  return { doc: next, changed: true, message: 'Aristas y vértices quedaron sobre la misma línea.' }
}

export function applyPathOp(doc: Doc, pieceIds: string[], op: PathOp): { doc: Doc; changed: boolean; message: string } {
  if (pieceIds.length === 0) return { doc, changed: false, message: 'Selecciona una figura.' }
  if (op === 'align') return alignSelection(doc, pieceIds)
  let current = doc
  if (op === 'union' || op === 'divide') {
    const welded = weldSelection(current, pieceIds)
    current = welded.doc
    current = mergeCollinearOpens(current, pieceIds).doc
  }
  let splitCount = 0
  if (op === 'divide') {
    const opens = current.pieces
      .filter((piece) => pieceIds.includes(piece.id))
      .flatMap((piece) => piece.strokes.filter((item) => openWorld(piece, item)).map((item) => ({ pieceId: piece.id, strokeId: item.id })))
    for (const item of opens) {
      const result = splitCrossings(current, item.pieceId, item.strokeId)
      if (result.count > 0) {
        current = result.doc
        splitCount += result.count
      }
    }
    if (splitCount > 0) return { doc: current, changed: true, message: 'La línea partió la figura en dos.' }
  }
  const closeds = ringsForOp(current, pieceIds)
  if (closeds.length < 2) {
    if (splitCount > 0 || current !== doc) {
      return { doc: current, changed: true, message: splitCount > 0 ? 'La línea partió la figura en dos.' : 'Los trazos quedaron en uno solo.' }
    }
    return { doc, changed: false, message: 'Selecciona dos figuras, o una línea que cruce una figura.' }
  }
  let rings: Point[][] = []
  try {
    rings = op === 'divide' ? divideRegions(closeds.map((item) => item.world)) : combine(op, closeds.map((item) => item.world))
  } catch {
    return { doc: current, changed: current !== doc, message: 'Esas figuras no se pudieron combinar.' }
  }
  if (rings.length === 0) {
    return { doc: current, changed: current !== doc, message: 'La operación no dejó área. Revisa si las figuras se cruzan.' }
  }
  const messages: Record<PathOp, string> = {
    union: 'Los trazos quedaron en un solo contorno.',
    intersect: 'Quedó solo la zona donde se cruzan.',
    subtract: 'Se restaron las demás figuras a la primera.',
    exclude: 'Quedó el área que no comparten.',
    divide: 'Las figuras se dividieron donde se cruzan.',
    align: 'Aristas y vértices quedaron sobre la misma línea.',
  }
  return { doc: writeRings(current, closeds, rings, op === 'union'), changed: true, message: messages[op] }
}

function overlaps(a: BBox, b: BBox): boolean {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
}

export function nearbyMeasures(pieces: Piece[], box: BBox, margin = 60): { widths: number[]; heights: number[] } {
  const widths: number[] = []
  const heights: number[] = []
  const area = {
    x: box.x - margin,
    y: box.y - margin,
    width: box.width + margin * 2,
    height: box.height + margin * 2,
  }
  for (const piece of pieces) {
    const bounds = pieceWorldBBox(piece)
    if (!bounds || !overlaps(bounds, area)) continue
    widths.push(bounds.width)
    heights.push(bounds.height)
    for (const item of piece.strokes) {
      const edges = shapeEdges(item.shape, item.role)
      if (!edges) continue
      for (const edge of edges) {
        const a = localToWorld(piece, edge.a)
        const b = localToWorld(piece, edge.b)
        const len = Math.hypot(b.x - a.x, b.y - a.y)
        if (len < 2) continue
        if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) widths.push(len)
        else heights.push(len)
      }
    }
  }
  return { widths, heights }
}

export function snapMeasure(value: number, options: number[], tolerance: number): number {
  let best = value
  let bestDist = tolerance
  for (const option of options) {
    const dist = Math.abs(option - value)
    if (dist <= bestDist && dist > 0.01) {
      best = option
      bestDist = dist
    }
  }
  return best
}

export function snapBoxPoint(anchor: Point, moving: Point, pieces: Piece[], tolerance: number): Point {
  const box = {
    x: Math.min(anchor.x, moving.x),
    y: Math.min(anchor.y, moving.y),
    width: Math.abs(moving.x - anchor.x),
    height: Math.abs(moving.y - anchor.y),
  }
  const measures = nearbyMeasures(pieces, box)
  const width = snapMeasure(box.width, measures.widths, tolerance)
  const height = snapMeasure(box.height, measures.heights, tolerance)
  return {
    x: anchor.x + (moving.x >= anchor.x ? width : -width),
    y: anchor.y + (moving.y >= anchor.y ? height : -height),
  }
}

export function boxMatchesNeighbor(anchor: Point, moving: Point, pieces: Piece[]): boolean {
  const width = Math.abs(moving.x - anchor.x)
  const height = Math.abs(moving.y - anchor.y)
  const measures = nearbyMeasures(pieces, {
    x: Math.min(anchor.x, moving.x),
    y: Math.min(anchor.y, moving.y),
    width,
    height,
  })
  return measures.widths.some((value) => Math.abs(value - width) < 0.05) || measures.heights.some((value) => Math.abs(value - height) < 0.05)
}

function scalePiece(piece: Piece, sx: number, sy: number): Piece {
  const box = pieceWorldBBox(piece)
  if (!box) return piece
  const map = (point: Point): Point => {
    const world = localToWorld(piece, point)
    return worldToLocal(piece, {
      x: box.x + (world.x - box.x) * sx,
      y: box.y + (world.y - box.y) * sy,
    })
  }
  const strokes = piece.strokes.map((item) => ({ ...item, shape: mapShape(item.shape, map) }))
  let image = piece.image
  if (image) {
    const origin = map({ x: image.x, y: image.y })
    const far = map({ x: image.x + image.width, y: image.y + image.height })
    image = {
      ...image,
      x: Math.min(origin.x, far.x),
      y: Math.min(origin.y, far.y),
      width: Math.abs(far.x - origin.x),
      height: Math.abs(far.y - origin.y),
    }
  }
  return { ...piece, strokes, image, detached: true }
}

function mapShape(shape: Shape, map: (point: Point) => Point): Shape {
  if (shape.kind === 'line') return { ...shape, a: map(shape.a), b: map(shape.b) }
  if (shape.kind === 'polyline') return { ...shape, points: shape.points.map(map) }
  if (shape.kind === 'rect' || shape.kind === 'roundRect') {
    const a = map({ x: shape.x, y: shape.y })
    const b = map({ x: shape.x + shape.width, y: shape.y + shape.height })
    const next = {
      ...shape,
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y),
    }
    return next
  }
  const center = map({ x: shape.cx, y: shape.cy })
  const rx = map({ x: shape.cx + shape.rx, y: shape.cy })
  const ry = map({ x: shape.cx, y: shape.cy + shape.ry })
  return {
    ...shape,
    cx: center.x,
    cy: center.y,
    rx: Math.max(0.5, Math.hypot(rx.x - center.x, rx.y - center.y)),
    ry: Math.max(0.5, Math.hypot(ry.x - center.x, ry.y - center.y)),
  }
}

export function matchMeasures(doc: Doc, pieceIds: string[], mode: 'width' | 'height' | 'both'): { doc: Doc; changed: boolean; message: string } {
  if (pieceIds.length === 0) return { doc, changed: false, message: 'Selecciona una figura.' }
  const selected = pieceIds.map((id) => doc.pieces.find((piece) => piece.id === id)).filter((piece): piece is Piece => !!piece)
  if (selected.length === 0) return { doc, changed: false, message: 'Selecciona una figura.' }
  let reference = pieceWorldBBox(selected[0])
  let targets = selected.slice(1)
  if (selected.length === 1) {
    const own = reference
    let best: { piece: Piece; gap: number } | null = null
    for (const piece of doc.pieces) {
      if (piece.id === selected[0].id) continue
      const box = pieceWorldBBox(piece)
      if (!box || !own) continue
      const gap = Math.hypot(box.x + box.width / 2 - (own.x + own.width / 2), box.y + box.height / 2 - (own.y + own.height / 2))
      if (!best || gap < best.gap) best = { piece, gap }
    }
    if (!best) return { doc, changed: false, message: 'No hay otra figura de la que copiar la medida.' }
    reference = pieceWorldBBox(best.piece)
    targets = [selected[0]]
  }
  if (!reference || reference.width < 0.5 || reference.height < 0.5) {
    return { doc, changed: false, message: 'Esa figura no tiene medidas.' }
  }
  let changed = false
  const pieces = doc.pieces.map((piece) => {
    if (!targets.some((target) => target.id === piece.id)) return piece
    const box = pieceWorldBBox(piece)
    if (!box || box.width < 0.5 || box.height < 0.5) return piece
    const sx = mode === 'height' ? 1 : reference.width / box.width
    const sy = mode === 'width' ? 1 : reference.height / box.height
    if (Math.abs(sx - 1) < 0.001 && Math.abs(sy - 1) < 0.001) return piece
    changed = true
    return scalePiece(piece, sx, sy)
  })
  if (!changed) return { doc, changed: false, message: 'Esas figuras ya miden lo mismo.' }
  const label = mode === 'width' ? 'el ancho' : mode === 'height' ? 'el alto' : 'el tamaño'
  return { doc: { ...doc, pieces }, changed: true, message: `Se igualó ${label} con la figura de al lado.` }
}
