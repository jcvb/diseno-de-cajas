import type {
  ArcShape,
  BBox,
  EllipseShape,
  Piece,
  Point,
  PolylineShape,
  RectShape,
  Role,
  RoundRectShape,
  Shape,
  Stroke,
} from './types.ts'

export function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return String(Math.round(n * 1000) / 1000)
}

export function stroke(role: Role, shape: Shape, id = uid('trazo')): Stroke {
  return { id, role, shape }
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function rotatePoint(p: Point, deg: number): Point {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c }
}

export function localToWorld(piece: Pick<Piece, 'x' | 'y' | 'rotation'>, p: Point): Point {
  const r = rotatePoint(p, piece.rotation)
  return { x: r.x + piece.x, y: r.y + piece.y }
}

export function worldToLocal(piece: Pick<Piece, 'x' | 'y' | 'rotation'>, p: Point): Point {
  return rotatePoint({ x: p.x - piece.x, y: p.y - piece.y }, -piece.rotation)
}

export function isClosed(shape: Shape): boolean {
  if (shape.kind === 'polyline') return shape.closed
  if (shape.kind === 'line' || shape.kind === 'arc') return false
  return true
}

export function normalizeShape<T extends Shape>(shape: T): T {
  if (shape.kind === 'rect' || shape.kind === 'roundRect') {
    const x = Math.min(shape.x, shape.x + shape.width)
    const y = Math.min(shape.y, shape.y + shape.height)
    return { ...shape, x, y, width: Math.abs(shape.width), height: Math.abs(shape.height) }
  }
  if (shape.kind === 'ellipse' || shape.kind === 'arc') {
    return { ...shape, rx: Math.abs(shape.rx), ry: Math.abs(shape.ry) }
  }
  return shape
}

export function translateShape(shape: Shape, dx: number, dy: number): Shape {
  const move = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy })
  switch (shape.kind) {
    case 'line':
      return { ...shape, a: move(shape.a), b: move(shape.b) }
    case 'polyline':
      return { ...shape, points: shape.points.map(move) }
    case 'rect':
    case 'roundRect':
      return { ...shape, x: shape.x + dx, y: shape.y + dy }
    case 'ellipse':
    case 'arc':
      return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy }
  }
}

export function bboxOfPoints(points: Point[]): BBox | null {
  if (points.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  if (!Number.isFinite(minX)) return null
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function unionBBox(a: BBox | null, b: BBox | null): BBox | null {
  if (!a) return b
  if (!b) return a
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.width, b.x + b.width)
  const bottom = Math.max(a.y + a.height, b.y + b.height)
  return { x, y, width: right - x, height: bottom - y }
}

export function arcPoint(cx: number, cy: number, rx: number, ry: number, deg: number): Point {
  const a = (deg * Math.PI) / 180
  return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) }
}

function ellipsePoints(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  from: number,
  to: number,
): Point[] {
  let span = to - from
  if (Math.abs(span) < 0.001) span = span < 0 ? -360 : 360
  const steps = Math.max(8, Math.ceil(Math.abs(span) / 8))
  const pts: Point[] = []
  for (let i = 0; i <= steps; i++) {
    pts.push(arcPoint(cx, cy, rx, ry, from + (span * i) / steps))
  }
  return pts
}

function roundRectPoints(shape: RoundRectShape): Point[] {
  const n = normalizeShape(shape)
  const r = clamp(n.radius, 0, Math.min(n.width, n.height) / 2)
  const x = n.x
  const y = n.y
  const w = n.width
  const h = n.height
  if (r < 0.05) {
    return [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
      { x, y },
    ]
  }
  const corners: { cx: number; cy: number; a0: number; a1: number }[] = [
    { cx: x + w - r, cy: y + r, a0: -90, a1: 0 },
    { cx: x + w - r, cy: y + h - r, a0: 0, a1: 90 },
    { cx: x + r, cy: y + h - r, a0: 90, a1: 180 },
    { cx: x + r, cy: y + r, a0: 180, a1: 270 },
  ]
  const pts: Point[] = []
  for (const corner of corners) {
    const arc = ellipsePoints(corner.cx, corner.cy, r, r, corner.a0, corner.a1)
    if (pts.length > 0) arc.shift()
    pts.push(...arc)
  }
  pts.push(pts[0])
  return pts
}

export function shapeToPolylines(shape: Shape): { points: Point[]; closed: boolean }[] {
  switch (shape.kind) {
    case 'line':
      return [{ points: [shape.a, shape.b], closed: false }]
    case 'polyline': {
      if (shape.points.length < 2) return []
      const points = shape.points.slice()
      if (shape.closed) {
        const first = points[0]
        const last = points[points.length - 1]
        if (first.x !== last.x || first.y !== last.y) points.push(first)
      }
      return [{ points, closed: shape.closed }]
    }
    case 'rect': {
      const n = normalizeShape(shape)
      const x2 = n.x + n.width
      const y2 = n.y + n.height
      return [{
        points: [
          { x: n.x, y: n.y },
          { x: x2, y: n.y },
          { x: x2, y: y2 },
          { x: n.x, y: y2 },
          { x: n.x, y: n.y },
        ],
        closed: true,
      }]
    }
    case 'roundRect':
      return [{ points: roundRectPoints(shape), closed: true }]
    case 'ellipse':
      return [{ points: ellipsePoints(shape.cx, shape.cy, shape.rx, shape.ry, 0, 360), closed: true }]
    case 'arc':
      return [{
        points: ellipsePoints(shape.cx, shape.cy, shape.rx, shape.ry, shape.startAngle, shape.endAngle),
        closed: false,
      }]
  }
}

export function shapeBBox(shape: Shape): BBox | null {
  if (shape.kind === 'rect' || shape.kind === 'roundRect') {
    const n = normalizeShape(shape)
    return { x: n.x, y: n.y, width: n.width, height: n.height }
  }
  if (shape.kind === 'ellipse') {
    return {
      x: shape.cx - shape.rx,
      y: shape.cy - shape.ry,
      width: shape.rx * 2,
      height: shape.ry * 2,
    }
  }
  const polys = shapeToPolylines(shape)
  return polys.reduce<BBox | null>((box, poly) => unionBBox(box, bboxOfPoints(poly.points)), null)
}

export function pieceLocalBBox(piece: Piece): BBox | null {
  let box = piece.strokes.reduce<BBox | null>((acc, s) => unionBBox(acc, shapeBBox(s.shape)), null)
  if (piece.image) {
    box = unionBBox(box, {
      x: piece.image.x,
      y: piece.image.y,
      width: piece.image.width,
      height: piece.image.height,
    })
  }
  return box
}

export function pieceWorldBBox(piece: Piece): BBox | null {
  const local = pieceLocalBBox(piece)
  if (!local) return null
  const corners = [
    { x: local.x, y: local.y },
    { x: local.x + local.width, y: local.y },
    { x: local.x + local.width, y: local.y + local.height },
    { x: local.x, y: local.y + local.height },
  ].map((p) => localToWorld(piece, p))
  return bboxOfPoints(corners)
}

export function docBBox(pieces: Piece[]): BBox | null {
  return pieces.reduce<BBox | null>((box, piece) => unionBBox(box, pieceWorldBBox(piece)), null)
}

export function isOpenEnd(shape: Shape, index: number): boolean {
  if (shape.kind === 'line') return index === 0 || index === 1
  if (shape.kind === 'polyline' && !shape.closed) return index === 0 || index === shape.points.length - 1
  return false
}

export function polylineWithoutNode(shape: PolylineShape, index: number): PolylineShape | null {
  const min = shape.closed ? 3 : 2
  if (shape.points.length <= min || index < 0 || index >= shape.points.length) return null
  const points = shape.points.filter((_, i) => i !== index)
  if (!shape.segments) return { ...shape, points }
  const segments = shape.segments.slice()
  if (index === 0) segments.shift()
  else segments.splice(index - 1, 1)
  return { ...shape, points, segments }
}

export type ShapeEdge = { a: Point; b: Point; role: Role }

export function shapeEdges(shape: Shape, fallback: Role): ShapeEdge[] | null {
  if (shape.kind === 'line') return [{ a: shape.a, b: shape.b, role: fallback }]
  if (shape.kind === 'polyline') {
    const count = shape.points.length
    if (count < 2) return []
    const last = shape.closed ? count : count - 1
    return Array.from({ length: last }, (_, i) => ({
      a: shape.points[i],
      b: shape.points[(i + 1) % count],
      role: shape.segments?.[i] ?? fallback,
    }))
  }
  if (shape.kind === 'rect') {
    const n = normalizeShape(shape)
    const corners = [
      { x: n.x, y: n.y },
      { x: n.x + n.width, y: n.y },
      { x: n.x + n.width, y: n.y + n.height },
      { x: n.x, y: n.y + n.height },
    ]
    return corners.map((a, i) => ({
      a,
      b: corners[(i + 1) % 4],
      role: shape.edges?.[i] ?? fallback,
    }))
  }
  return null
}

export function withEdgeRole(shape: Shape, index: number, role: Role, fallback: Role): Shape {
  if (shape.kind === 'polyline') {
    const count = shape.closed ? shape.points.length : Math.max(0, shape.points.length - 1)
    if (index < 0 || index >= count) return shape
    const segments = Array.from({ length: count }, (_, i) => shape.segments?.[i] ?? fallback)
    segments[index] = role
    return { ...shape, segments }
  }
  if (shape.kind === 'rect') {
    if (index < 0 || index > 3) return shape
    const edges = [0, 1, 2, 3].map((i) => shape.edges?.[i] ?? fallback)
    edges[index] = role
    return { ...shape, edges }
  }
  return shape
}

export function clearEdgeRoles(shape: Shape): Shape {
  if (shape.kind === 'polyline' && shape.segments) {
    return { kind: 'polyline', points: shape.points, closed: shape.closed }
  }
  if (shape.kind === 'rect' && shape.edges) {
    return { kind: 'rect', x: shape.x, y: shape.y, width: shape.width, height: shape.height }
  }
  return shape
}

export function hasEdgeRoles(shape: Shape): boolean {
  if (shape.kind === 'polyline') return (shape.segments?.length ?? 0) > 0
  if (shape.kind === 'rect') return (shape.edges?.length ?? 0) > 0
  return false
}

export function shapeNodes(shape: Shape): Point[] {
  switch (shape.kind) {
    case 'line':
      return [shape.a, shape.b]
    case 'polyline':
      return shape.points
    case 'rect':
    case 'roundRect': {
      const n = normalizeShape(shape)
      const corners = [
        { x: n.x, y: n.y },
        { x: n.x + n.width, y: n.y },
        { x: n.x + n.width, y: n.y + n.height },
        { x: n.x, y: n.y + n.height },
      ]
      if (shape.kind === 'roundRect') corners.push({ x: n.x + clamp(shape.radius, 0, n.width / 2), y: n.y })
      return corners
    }
    case 'ellipse':
      return [
        { x: shape.cx, y: shape.cy },
        { x: shape.cx + shape.rx, y: shape.cy },
        { x: shape.cx, y: shape.cy + shape.ry },
      ]
    case 'arc':
      return [
        { x: shape.cx, y: shape.cy },
        arcPoint(shape.cx, shape.cy, shape.rx, shape.ry, shape.startAngle),
        arcPoint(shape.cx, shape.cy, shape.rx, shape.ry, shape.endAngle),
      ]
  }
}

function setRectCorner(shape: RectShape | RoundRectShape, index: number, point: Point): Shape {
  const n = normalizeShape(shape)
  if (shape.kind === 'roundRect' && index === 4) {
    const radius = clamp(point.x - n.x, 0, Math.min(n.width, n.height) / 2)
    return { ...shape, x: n.x, y: n.y, width: n.width, height: n.height, radius }
  }
  const corners = [
    { x: n.x, y: n.y },
    { x: n.x + n.width, y: n.y },
    { x: n.x + n.width, y: n.y + n.height },
    { x: n.x, y: n.y + n.height },
  ]
  const opposite = corners[(index + 2) % 4]
  const x = Math.min(point.x, opposite.x)
  const y = Math.min(point.y, opposite.y)
  const width = Math.abs(point.x - opposite.x)
  const height = Math.abs(point.y - opposite.y)
  return { ...shape, x, y, width, height }
}

function angleAt(shape: EllipseShape | ArcShape, point: Point): number {
  const a = Math.atan2((point.y - shape.cy) / (shape.ry || 1), (point.x - shape.cx) / (shape.rx || 1))
  let deg = (a * 180) / Math.PI
  if (deg < 0) deg += 360
  return deg
}

export function shapeWithNode(shape: Shape, index: number, point: Point): Shape {
  switch (shape.kind) {
    case 'line':
      return index === 0 ? { ...shape, a: point } : { ...shape, b: point }
    case 'polyline': {
      const points = shape.points.slice()
      if (!points[index]) return shape
      points[index] = point
      return { ...shape, points }
    }
    case 'rect':
    case 'roundRect':
      return setRectCorner(shape, index, point)
    case 'ellipse': {
      if (index === 0) return { ...shape, cx: point.x, cy: point.y }
      if (index === 1) return { ...shape, rx: Math.max(0.5, Math.abs(point.x - shape.cx)) }
      return { ...shape, ry: Math.max(0.5, Math.abs(point.y - shape.cy)) }
    }
    case 'arc': {
      if (index === 0) return { ...shape, cx: point.x, cy: point.y }
      if (index === 1) return { ...shape, startAngle: angleAt(shape, point) }
      return { ...shape, endAngle: angleAt(shape, point) }
    }
  }
}

export function shapeArea(shape: Shape): number {
  const poly = shapeToPolylines(shape)[0]
  if (!poly || poly.points.length < 3) return 0
  let sum = 0
  const pts = poly.points
  for (let i = 0; i < pts.length - 1; i++) {
    sum += pts[i].x * pts[i + 1].y - pts[i + 1].x * pts[i].y
  }
  return sum / 2
}

export function largestCutOutline(piece: Piece): Shape | null {
  let best: Shape | null = null
  let area = -1
  for (const s of piece.strokes) {
    if (s.role !== 'cut' || !isClosed(s.shape)) continue
    const a = Math.abs(shapeArea(s.shape))
    if (a > area) {
      area = a
      best = s.shape
    }
  }
  return best
}

export function projectToLine(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = dx * dx + dy * dy
  if (len < 1e-9) return { x: a.x, y: a.y }
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len
  return { x: a.x + t * dx, y: a.y + t * dy }
}

export function distToLine(p: Point, a: Point, b: Point): number {
  const q = projectToLine(p, a, b)
  return Math.hypot(p.x - q.x, p.y - q.y)
}

export function mergeCollinearPoints(points: Point[], closed: boolean, keep: Point[] = []): Point[] {
  let current = points.map((p) => ({ x: p.x, y: p.y }))
  const minimum = closed ? 3 : 2
  const kept = (point: Point) => keep.some((item) => Math.hypot(item.x - point.x, item.y - point.y) <= 0.35)
  let changed = true
  while (changed && current.length > minimum) {
    changed = false
    const next: Point[] = []
    const count = current.length
    for (let i = 0; i < count; i++) {
      if (!closed && (i === 0 || i === count - 1)) {
        next.push(current[i])
        continue
      }
      const prev = current[(i - 1 + count) % count]
      const point = current[i]
      const following = current[(i + 1) % count]
      if (isCollinearJoint(prev, point, following) && !kept(point)) {
        changed = true
        continue
      }
      next.push(point)
    }
    if (next.length < minimum) return current
    current = next
  }
  return current
}

function isCollinearJoint(a: Point, b: Point, c: Point): boolean {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const bcx = c.x - b.x
  const bcy = c.y - b.y
  const lab = Math.hypot(abx, aby)
  const lbc = Math.hypot(bcx, bcy)
  if (lab < 0.25 || lbc < 0.25) return true
  const sin = Math.abs(abx * bcy - aby * bcx) / (lab * lbc)
  const dot = abx * bcx + aby * bcy
  return sin < 0.035 && dot > 0
}

export function straightenJoint(prev: Point | null, next: Point | null, point: Point, tolerance: number): Point {
  if (!prev || !next) return point
  const abx = point.x - prev.x
  const aby = point.y - prev.y
  const bcx = next.x - point.x
  const bcy = next.y - point.y
  const lab = Math.hypot(abx, aby)
  const lbc = Math.hypot(bcx, bcy)
  if (lab < 0.5 || lbc < 0.5) return point
  const sin = Math.abs(abx * bcy - aby * bcx) / (lab * lbc)
  if (sin > 0.2) return point
  if (distToLine(point, prev, next) > tolerance) return point
  return projectToLine(point, prev, next)
}

export function snapToParallelEdge(anchor: Point | null, point: Point, edges: { a: Point; b: Point }[], tolerance: number): Point {
  if (!anchor) return point
  const dx = point.x - anchor.x
  const dy = point.y - anchor.y
  const len = Math.hypot(dx, dy)
  if (len < 1) return point
  let best = point
  let bestDist = tolerance
  for (const edge of edges) {
    const ex = edge.b.x - edge.a.x
    const ey = edge.b.y - edge.a.y
    const edgeLen = Math.hypot(ex, ey)
    if (edgeLen < 1) continue
    const sin = Math.abs(dx * ey - dy * ex) / (len * edgeLen)
    if (sin > 0.09) continue
    const dist = distToLine(point, edge.a, edge.b)
    if (dist < bestDist) {
      bestDist = dist
      best = projectToLine(point, edge.a, edge.b)
    }
  }
  return best
}

export function neighborNodes(shape: Shape, index: number): { prev: Point | null; next: Point | null } {
  const nodes = shapeNodes(shape)
  if (index < 0 || index >= nodes.length) return { prev: null, next: null }
  if (shape.kind === 'line') {
    return index === 0 ? { prev: null, next: nodes[1] ?? null } : { prev: nodes[0] ?? null, next: null }
  }
  if (shape.kind === 'polyline') {
    const count = nodes.length
    if (count < 2) return { prev: null, next: null }
    const prev = index === 0 ? (shape.closed ? nodes[count - 1] : null) : nodes[index - 1]
    const next = index === count - 1 ? (shape.closed ? nodes[0] : null) : nodes[index + 1]
    return { prev: prev ?? null, next: next ?? null }
  }
  if ((shape.kind === 'rect' || shape.kind === 'roundRect') && index < 4) {
    return { prev: nodes[(index + 3) % 4] ?? null, next: nodes[(index + 1) % 4] ?? null }
  }
  return { prev: null, next: null }
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = dx * dx + dy * dy
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len, 0, 1)
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

export function distanceToShape(shape: Shape, p: Point): number {
  let best = Infinity
  for (const poly of shapeToPolylines(shape)) {
    for (let i = 1; i < poly.points.length; i++) {
      best = Math.min(best, distToSegment(p, poly.points[i - 1], poly.points[i]))
    }
  }
  return best
}

export function pointInShape(shape: Shape, p: Point): boolean {
  if (!isClosed(shape)) return false
  const poly = shapeToPolylines(shape)[0]
  if (!poly) return false
  const pts = poly.points
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x
    const yi = pts[i].y
    const xj = pts[j].x
    const yj = pts[j].y
    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi || 1e-9) + xi
    if (intersect) inside = !inside
  }
  return inside
}

export function snapToGrid(p: Point, grid: number): Point {
  if (grid <= 0) return p
  return { x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid }
}

export type MagnetKind = 'vertex' | 'stroke' | 'guide' | 'free'

export function snapMagnet(
  point: Point,
  pieces: Piece[],
  grid: number,
  threshold: number,
  enable: boolean,
  options?: { exclude?: Set<string>; skipStrokeId?: string; skipNode?: { pieceId: string; strokeId: string; index: number } },
): { point: Point; kind: MagnetKind } {
  if (!enable) return { point, kind: 'free' }
  const exclude = options?.exclude ?? new Set<string>()
  const vertices = magnetVertices(pieces, exclude, options?.skipNode)
  let vertex: Point | null = null
  let vertexDist = threshold
  for (const candidate of vertices) {
    const dist = Math.hypot(candidate.x - point.x, candidate.y - point.y)
    if (dist <= vertexDist) {
      vertex = candidate
      vertexDist = dist
    }
  }
  if (vertex) return { point: vertex, kind: 'vertex' }

  let onStroke: Point | null = null
  let strokeDist = threshold
  for (const edge of collectSnapSegments(pieces, exclude, options?.skipStrokeId)) {
    const closest = closestOnSegment(point, edge.a, edge.b)
    const dist = Math.hypot(closest.x - point.x, closest.y - point.y)
    if (dist <= strokeDist) {
      onStroke = closest
      strokeDist = dist
    }
  }
  if (onStroke) return { point: tidy(onStroke), kind: 'stroke' }

  if (grid > 0) {
    const guide = snapToGrid(point, grid)
    const x = Math.abs(guide.x - point.x) <= threshold ? guide.x : point.x
    const y = Math.abs(guide.y - point.y) <= threshold ? guide.y : point.y
    if (x !== point.x || y !== point.y) return { point: tidy({ x, y }), kind: 'guide' }
  }
  return { point, kind: 'free' }
}

function magnetVertices(
  pieces: Piece[],
  exclude: Set<string>,
  skipNode?: { pieceId: string; strokeId: string; index: number },
): Point[] {
  const points: Point[] = []
  for (const piece of pieces) {
    if (exclude.has(piece.id)) continue
    for (const item of piece.strokes) {
      shapeNodes(item.shape).forEach((node, index) => {
        if (skipNode && skipNode.pieceId === piece.id && skipNode.strokeId === item.id && skipNode.index === index) return
        points.push(localToWorld(piece, node))
      })
    }
  }
  return points
}

function collectSnapSegments(pieces: Piece[], exclude: Set<string>, skipStrokeId?: string): { a: Point; b: Point }[] {
  const segments: { a: Point; b: Point }[] = []
  for (const piece of pieces) {
    if (exclude.has(piece.id)) continue
    for (const item of piece.strokes) {
      if (item.id === skipStrokeId) continue
      for (const poly of shapeToPolylines(item.shape)) {
        for (let i = 1; i < poly.points.length; i++) {
          const a = poly.points[i - 1]
          const b = poly.points[i]
          if (!a || !b) continue
          segments.push({ a: localToWorld(piece, a), b: localToWorld(piece, b) })
        }
      }
    }
  }
  return segments
}

function tidy(point: Point): Point {
  return { x: Math.round(point.x * 1000) / 1000, y: Math.round(point.y * 1000) / 1000 }
}

function closestOnSegment(point: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = dx * dx + dy * dy
  if (len === 0) return a
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / len, 0, 1)
  return { x: a.x + t * dx, y: a.y + t * dy }
}

export function snapWorldPoint(
  p: Point,
  grid: number,
  targets: Point[],
  threshold: number,
  enable: boolean,
): Point {
  if (!enable) return p
  let best: Point | null = null
  let bestDist = threshold
  for (const target of targets) {
    const d = Math.hypot(target.x - p.x, target.y - p.y)
    if (d <= bestDist) {
      best = target
      bestDist = d
    }
  }
  if (best) return best
  let x = p.x
  let y = p.y
  let bestX = threshold
  let bestY = threshold
  let snappedX = false
  let snappedY = false
  for (const target of targets) {
    const dx = Math.abs(target.x - p.x)
    const dy = Math.abs(target.y - p.y)
    if (dx <= bestX) {
      bestX = dx
      x = target.x
      snappedX = true
    }
    if (dy <= bestY) {
      bestY = dy
      y = target.y
      snappedY = true
    }
  }
  const g = snapToGrid(p, grid)
  if (!snappedX && Math.abs(g.x - p.x) <= threshold) {
    x = g.x
    snappedX = true
  }
  if (!snappedY && Math.abs(g.y - p.y) <= threshold) {
    y = g.y
    snappedY = true
  }
  if (snappedX || snappedY) return { x, y }
  return p
}

export function collectVertexPoints(
  pieces: Piece[],
  skip?: { pieceId: string; strokeId: string; index: number },
): Point[] {
  const points: Point[] = []
  for (const piece of pieces) {
    for (const item of piece.strokes) {
      shapeNodes(item.shape).forEach((node, index) => {
        if (skip && skip.pieceId === piece.id && skip.strokeId === item.id && skip.index === index) return
        points.push(localToWorld(piece, node))
      })
    }
  }
  return points
}

export function collectWorldEdges(pieces: Piece[], skipStrokeId?: string): { a: Point; b: Point }[] {
  const edges: { a: Point; b: Point }[] = []
  for (const piece of pieces) {
    for (const item of piece.strokes) {
      if (item.id === skipStrokeId) continue
      const local = shapeEdges(item.shape, item.role)
      if (!local) continue
      for (const edge of local) {
        edges.push({ a: localToWorld(piece, edge.a), b: localToWorld(piece, edge.b) })
      }
    }
  }
  return edges
}

export function collectSnapPoints(pieces: Piece[], exclude: Set<string>): Point[] {
  const points: Point[] = []
  for (const piece of pieces) {
    if (exclude.has(piece.id)) continue
    for (const s of piece.strokes) {
      const nodes = shapeNodes(s.shape).map((p) => localToWorld(piece, p))
      points.push(...nodes)
      const count = s.shape.kind === 'polyline' && s.shape.closed ? nodes.length : nodes.length - 1
      for (let i = 0; i < count; i++) {
        const a = nodes[i]
        const b = nodes[(i + 1) % nodes.length]
        if (!a || !b) continue
        points.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
      }
    }
  }
  return points
}

export function outwardNormal(a: Point, b: Point, interior: Point): Point {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  let nx = -dy / len
  let ny = dx / len
  const vx = interior.x - (a.x + b.x) / 2
  const vy = interior.y - (a.y + b.y) / 2
  if (nx * vx + ny * vy > 0) {
    nx = -nx
    ny = -ny
  }
  return { x: nx, y: ny }
}

export function polygonWithEdgeFlaps(points: Point[], flap: number): { outline: Point[]; creases: [Point, Point][] } {
  const interior = {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  }
  const outline: Point[] = []
  const creases: [Point, Point][] = []
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const n = outwardNormal(a, b, interior)
    outline.push(a, { x: a.x + n.x * flap, y: a.y + n.y * flap }, { x: b.x + n.x * flap, y: b.y + n.y * flap })
    creases.push([a, b])
  }
  return { outline, creases }
}

export function arcSvgPath(shape: ArcShape): string {
  const start = arcPoint(shape.cx, shape.cy, shape.rx, shape.ry, shape.startAngle)
  const end = arcPoint(shape.cx, shape.cy, shape.rx, shape.ry, shape.endAngle)
  let delta = shape.endAngle - shape.startAngle
  delta = ((delta % 360) + 360) % 360
  if (delta < 0.01 || delta > 359.99) {
    const mid = arcPoint(shape.cx, shape.cy, shape.rx, shape.ry, shape.startAngle + 180)
    return `M ${fmt(start.x)} ${fmt(start.y)} A ${fmt(shape.rx)} ${fmt(shape.ry)} 0 1 1 ${fmt(mid.x)} ${fmt(mid.y)} A ${fmt(shape.rx)} ${fmt(shape.ry)} 0 1 1 ${fmt(start.x)} ${fmt(start.y)}`
  }
  const large = delta > 180 ? 1 : 0
  return `M ${fmt(start.x)} ${fmt(start.y)} A ${fmt(shape.rx)} ${fmt(shape.ry)} 0 ${large} 1 ${fmt(end.x)} ${fmt(end.y)}`
}

export function insertOnPolyline(shape: PolylineShape, point: Point): { shape: PolylineShape; index: number } | null {
  if (shape.points.length < 2) return null
  let best = Infinity
  let bestIndex = 1
  let bestPoint = point
  const last = shape.closed ? shape.points.length : shape.points.length - 1
  for (let i = 0; i < last; i++) {
    const a = shape.points[i]
    const b = shape.points[(i + 1) % shape.points.length]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = dx * dx + dy * dy
    const t = len === 0 ? 0 : clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / len, 0, 1)
    const proj = { x: a.x + t * dx, y: a.y + t * dy }
    const d = Math.hypot(point.x - proj.x, point.y - proj.y)
    if (d < best) {
      best = d
      bestIndex = i + 1
      bestPoint = proj
    }
  }
  const points = shape.points.slice()
  points.splice(bestIndex, 0, bestPoint)
  const segments = shape.segments ? shape.segments.slice() : undefined
  if (segments) {
    const edge = Math.max(0, bestIndex - 1)
    segments.splice(edge, 0, segments[edge] ?? 'cut')
  }
  return { shape: { ...shape, points, ...(segments ? { segments } : {}) }, index: bestIndex }
}

export function intoLocal(shape: Shape, piece: Pick<Piece, 'x' | 'y' | 'rotation'>): Shape {
  if (piece.rotation === 0) return translateShape(shape, -piece.x, -piece.y)
  const poly = shapeToPolylines(shape)[0]
  if (!poly) return shape
  const points = poly.points.map((p) => worldToLocal(piece, p))
  if (isClosed(shape) && points.length > 1) points.pop()
  const segments = shape.kind === 'polyline' ? shape.segments : undefined
  return { kind: 'polyline', points, closed: isClosed(shape), ...(segments ? { segments } : {}) }
}

export function bakePiece(piece: Piece): Piece {
  const strokes: Stroke[] = []
  for (const s of piece.strokes) {
    const edges = shapeEdges(s.shape, s.role)
    for (const poly of shapeToPolylines(s.shape)) {
      const points = poly.points.map((p) => localToWorld(piece, p))
      if (poly.closed && points.length > 1) points.pop()
      const expect = poly.closed ? points.length : Math.max(0, points.length - 1)
      const segments = edges && edges.length === expect ? edges.map((edge) => edge.role) : undefined
      const mixed = !!segments && segments.some((role) => role !== s.role)
      strokes.push(
        stroke(s.role, { kind: 'polyline', points, closed: poly.closed, ...(mixed ? { segments } : {}) }, s.id),
      )
    }
  }
  let image = piece.image
  if (image) {
    const corners = [
      { x: image.x, y: image.y },
      { x: image.x + image.width, y: image.y },
      { x: image.x + image.width, y: image.y + image.height },
      { x: image.x, y: image.y + image.height },
    ].map((p) => localToWorld(piece, p))
    const box = bboxOfPoints(corners)
    if (box) image = { ...image, x: box.x, y: box.y, width: box.width, height: box.height }
  }
  return { ...piece, x: 0, y: 0, rotation: 0, strokes, image }
}

export function mirrorPiece(piece: Piece, axis: 'h' | 'v', center: Point): Piece {
  const baked = bakePiece(piece)
  const map = (p: Point): Point =>
    axis === 'h' ? { x: 2 * center.x - p.x, y: p.y } : { x: p.x, y: 2 * center.y - p.y }
  const strokes = baked.strokes.map((s) => {
    if (s.shape.kind !== 'polyline') return s
    return { ...s, shape: { ...s.shape, points: s.shape.points.map(map) } }
  })
  let image = baked.image
  if (image) {
    const moved = map({ x: image.x, y: image.y })
    const far = map({ x: image.x + image.width, y: image.y + image.height })
    image = {
      ...image,
      x: Math.min(moved.x, far.x),
      y: Math.min(moved.y, far.y),
      width: Math.abs(far.x - moved.x),
      height: Math.abs(far.y - moved.y),
    }
  }
  return { ...baked, strokes, image, detached: true }
}

export function rotatePiece90(piece: Piece): Piece {
  const box = pieceWorldBBox(piece)
  const next = (piece.rotation + 90) % 360
  if (!box) return { ...piece, rotation: next }
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const localCenter = worldToLocal(piece, { x: cx, y: cy })
  const turned = rotatePoint(localCenter, next)
  return { ...piece, rotation: next, x: cx - turned.x, y: cy - turned.y }
}

export function normalizePiece(piece: Piece): Piece {
  const box = piece.strokes.reduce<BBox | null>((acc, s) => unionBBox(acc, shapeBBox(s.shape)), null)
  if (!box) return piece
  return {
    ...piece,
    strokes: piece.strokes.map((s) => ({ ...s, shape: translateShape(s.shape, -box.x, -box.y) })),
    image: piece.image
      ? { ...piece.image, x: piece.image.x - box.x, y: piece.image.y - box.y }
      : null,
  }
}

export function shapeSvg(shape: Shape): string {
  switch (shape.kind) {
    case 'line':
      return `<line x1="${fmt(shape.a.x)}" y1="${fmt(shape.a.y)}" x2="${fmt(shape.b.x)}" y2="${fmt(shape.b.y)}" />`
    case 'polyline': {
      const pts = shape.points.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(' ')
      const tag = shape.closed ? 'polygon' : 'polyline'
      return `<${tag} points="${pts}" />`
    }
    case 'rect': {
      const n = normalizeShape(shape)
      return `<rect x="${fmt(n.x)}" y="${fmt(n.y)}" width="${fmt(n.width)}" height="${fmt(n.height)}" />`
    }
    case 'roundRect': {
      const n = normalizeShape(shape)
      const r = clamp(n.radius, 0, Math.min(n.width, n.height) / 2)
      return `<rect x="${fmt(n.x)}" y="${fmt(n.y)}" width="${fmt(n.width)}" height="${fmt(n.height)}" rx="${fmt(r)}" ry="${fmt(r)}" />`
    }
    case 'ellipse':
      return `<ellipse cx="${fmt(shape.cx)}" cy="${fmt(shape.cy)}" rx="${fmt(shape.rx)}" ry="${fmt(shape.ry)}" />`
    case 'arc':
      return `<path d="${arcSvgPath(shape)}" />`
  }
}
