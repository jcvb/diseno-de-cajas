import { stroke, uid } from '../model/geometry.ts'
import type { Piece, Point, Role, Stroke } from '../model/types.ts'

type Matrix = [number, number, number, number, number, number]

const identity = (): Matrix => [1, 0, 0, 1, 0, 0]

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ]
}

function apply(m: Matrix, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }
}

function parseTransform(raw: string | null): Matrix {
  if (!raw) return identity()
  let matrix = identity()
  const re = /(matrix|translate|scale|rotate)\s*\(([^)]*)\)/gi
  for (const match of raw.matchAll(re)) {
    const kind = match[1].toLowerCase()
    const nums = match[2].trim().split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n))
    let next = identity()
    if (kind === 'translate') next = [1, 0, 0, 1, nums[0] ?? 0, nums[1] ?? 0]
    else if (kind === 'scale') next = [nums[0] ?? 1, 0, 0, nums[1] ?? nums[0] ?? 1, 0, 0]
    else if (kind === 'matrix' && nums.length >= 6) next = [nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]]
    else if (kind === 'rotate') {
      const ang = ((nums[0] ?? 0) * Math.PI) / 180
      const c = Math.cos(ang)
      const s = Math.sin(ang)
      next = [c, s, -s, c, 0, 0]
      if (nums.length >= 3) {
        const tx = nums[1]
        const ty = nums[2]
        next = multiply(multiply([1, 0, 0, 1, tx, ty], next), [1, 0, 0, 1, -tx, -ty])
      }
    }
    matrix = multiply(matrix, next)
  }
  return matrix
}

function numbersOf(value: string): number[] {
  return value
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n))
}

function pointsOf(value: string | null): Point[] {
  if (!value) return []
  const nums = numbersOf(value)
  const points: Point[] = []
  for (let i = 0; i + 1 < nums.length; i += 2) points.push({ x: nums[i], y: nums[i + 1] })
  return points
}

function roleOf(el: Element): Role {
  const dash = el.getAttribute('stroke-dasharray')
  const style = el.getAttribute('style') ?? ''
  if (dash && dash !== 'none') return 'crease'
  if (/stroke-dasharray\s*:\s*(?!none)/i.test(style)) return 'crease'
  const id = `${el.id} ${el.parentElement?.id ?? ''}`.toLowerCase()
  if (id.includes('hendido') || id.includes('crease')) return 'crease'
  return 'cut'
}

function svgArcPoints(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  phiDeg: number,
  large: number,
  sweep: number,
  x2: number,
  y2: number,
): Point[] {
  const phi = (phiDeg * Math.PI) / 180
  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)
  const dx = (x1 - x2) / 2
  const dy = (y1 - y2) / 2
  const x1p = cosPhi * dx + sinPhi * dy
  const y1p = -sinPhi * dx + cosPhi * dy
  let rxAbs = Math.abs(rx) || 0.01
  let ryAbs = Math.abs(ry) || 0.01
  const lambda = (x1p * x1p) / (rxAbs * rxAbs) + (y1p * y1p) / (ryAbs * ryAbs)
  if (lambda > 1) {
    const scale = Math.sqrt(lambda)
    rxAbs *= scale
    ryAbs *= scale
  }
  const sign = large !== sweep ? 1 : -1
  const rx2 = rxAbs * rxAbs
  const ry2 = ryAbs * ryAbs
  const num = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p
  const den = rx2 * y1p * y1p + ry2 * x1p * x1p
  const coef = sign * Math.sqrt(Math.max(0, num / (den || 1)))
  const cxp = coef * ((rxAbs * y1p) / ryAbs)
  const cyp = coef * (-(ryAbs * x1p) / rxAbs)
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1
    let ang = Math.acos(Math.max(-1, Math.min(1, dot / len)))
    if (ux * vy - uy * vx < 0) ang = -ang
    return ang
  }
  const theta1 = angle(1, 0, (x1p - cxp) / rxAbs, (y1p - cyp) / ryAbs)
  let dtheta = angle((x1p - cxp) / rxAbs, (y1p - cyp) / ryAbs, (-x1p - cxp) / rxAbs, (-y1p - cyp) / ryAbs)
  if (!sweep && dtheta > 0) dtheta -= Math.PI * 2
  if (sweep && dtheta < 0) dtheta += Math.PI * 2
  const steps = Math.max(6, Math.ceil(Math.abs(dtheta) / (Math.PI / 18)))
  const points: Point[] = []
  for (let i = 1; i <= steps; i++) {
    const t = theta1 + (dtheta * i) / steps
    points.push({
      x: cosPhi * rxAbs * Math.cos(t) - sinPhi * ryAbs * Math.sin(t) + cx,
      y: sinPhi * rxAbs * Math.cos(t) + cosPhi * ryAbs * Math.sin(t) + cy,
    })
  }
  return points
}

function pathPolylines(d: string): { points: Point[]; closed: boolean }[] {
  const token = /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/gi
  const commands: { op: string; nums: number[] }[] = []
  let current: { op: string; nums: number[] } | null = null
  for (const match of d.matchAll(token)) {
    if (match[1]) {
      current = { op: match[1], nums: [] }
      commands.push(current)
    } else if (current && match[2]) current.nums.push(Number(match[2]))
  }
  const result: { points: Point[]; closed: boolean }[] = []
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  let lastC: Point | null = null
  let lastQ: Point | null = null
  let open: Point[] | null = null

  const finish = (closed: boolean) => {
    if (open && open.length >= 2) result.push({ points: open, closed })
    open = null
  }
  const lineTo = (x: number, y: number) => {
    if (!open) open = [{ x: cx, y: cy }]
    open.push({ x, y })
    cx = x
    cy = y
  }
  const cubic = (p0: Point, p1: Point, p2: Point, p3: Point) => {
    const steps = 12
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const u = 1 - t
      lineTo(
        u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
        u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
      )
    }
  }
  const quad = (p0: Point, p1: Point, p2: Point) => {
    const steps = 10
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const u = 1 - t
      lineTo(u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y)
    }
  }

  for (const command of commands) {
    const op = command.op
    const upper = op.toUpperCase()
    const rel = op !== upper
    const nums = command.nums
    if (upper === 'M') {
      finish(false)
      for (let i = 0; i + 1 < nums.length; i += 2) {
        const x = (rel ? cx : 0) + nums[i]
        const y = (rel ? cy : 0) + nums[i + 1]
        if (i === 0) {
          open = [{ x, y }]
          sx = x
          sy = y
          cx = x
          cy = y
        } else lineTo(x, y)
      }
    } else if (upper === 'L') {
      for (let i = 0; i + 1 < nums.length; i += 2) lineTo((rel ? cx : 0) + nums[i], (rel ? cy : 0) + nums[i + 1])
    } else if (upper === 'H') {
      for (const n of nums) lineTo((rel ? cx : 0) + n, cy)
    } else if (upper === 'V') {
      for (const n of nums) lineTo(cx, (rel ? cy : 0) + n)
    } else if (upper === 'C') {
      for (let i = 0; i + 5 < nums.length; i += 6) {
        const p1 = { x: (rel ? cx : 0) + nums[i], y: (rel ? cy : 0) + nums[i + 1] }
        const p2 = { x: (rel ? cx : 0) + nums[i + 2], y: (rel ? cy : 0) + nums[i + 3] }
        const p3 = { x: (rel ? cx : 0) + nums[i + 4], y: (rel ? cy : 0) + nums[i + 5] }
        cubic({ x: cx, y: cy }, p1, p2, p3)
        lastC = p2
      }
    } else if (upper === 'S') {
      for (let i = 0; i + 3 < nums.length; i += 4) {
        const reflect: Point = lastC ? { x: 2 * cx - lastC.x, y: 2 * cy - lastC.y } : { x: cx, y: cy }
        const p2 = { x: (rel ? cx : 0) + nums[i], y: (rel ? cy : 0) + nums[i + 1] }
        const p3 = { x: (rel ? cx : 0) + nums[i + 2], y: (rel ? cy : 0) + nums[i + 3] }
        cubic({ x: cx, y: cy }, reflect, p2, p3)
        lastC = p2
      }
    } else if (upper === 'Q') {
      for (let i = 0; i + 3 < nums.length; i += 4) {
        const p1 = { x: (rel ? cx : 0) + nums[i], y: (rel ? cy : 0) + nums[i + 1] }
        const p2 = { x: (rel ? cx : 0) + nums[i + 2], y: (rel ? cy : 0) + nums[i + 3] }
        quad({ x: cx, y: cy }, p1, p2)
        lastQ = p1
      }
    } else if (upper === 'T') {
      for (let i = 0; i + 1 < nums.length; i += 2) {
        const reflect: Point = lastQ ? { x: 2 * cx - lastQ.x, y: 2 * cy - lastQ.y } : { x: cx, y: cy }
        const p2 = { x: (rel ? cx : 0) + nums[i], y: (rel ? cy : 0) + nums[i + 1] }
        quad({ x: cx, y: cy }, reflect, p2)
        lastQ = reflect
      }
    } else if (upper === 'A') {
      for (let i = 0; i + 6 < nums.length; i += 7) {
        const x = (rel ? cx : 0) + nums[i + 5]
        const y = (rel ? cy : 0) + nums[i + 6]
        const pts = svgArcPoints(cx, cy, nums[i], nums[i + 1], nums[i + 2], nums[i + 3], nums[i + 4], x, y)
        for (const p of pts) lineTo(p.x, p.y)
      }
    } else if (upper === 'Z') {
      if (open && (cx !== sx || cy !== sy)) open.push({ x: sx, y: sy })
      finish(true)
      cx = sx
      cy = sy
    }
    if (upper !== 'C' && upper !== 'S') lastC = null
    if (upper !== 'Q' && upper !== 'T') lastQ = null
  }
  finish(false)
  return result
}

function pushPolyline(strokes: Stroke[], points: Point[], closed: boolean, matrix: Matrix, role: Role): void {
  if (points.length < 2) return
  const mapped = points.map((p) => apply(matrix, p))
  const far = mapped.some((p, i) => i > 0 && (p.x !== mapped[0].x || p.y !== mapped[0].y))
  if (!far) return
  strokes.push(stroke(role, { kind: 'polyline', points: mapped, closed }))
}

function walk(el: Element, parent: Matrix, strokes: Stroke[]): void {
  const tag = el.tagName.toLowerCase().replace(/^.*:/, '')
  if (tag === 'defs' || tag === 'style' || tag === 'clippath' || tag === 'metadata') return
  const matrix = multiply(parent, parseTransform(el.getAttribute('transform')))
  const role = roleOf(el)
  const num = (name: string, fallback = 0) => Number(el.getAttribute(name) ?? fallback)
  if (tag === 'line') {
    pushPolyline(
      strokes,
      [
        { x: num('x1'), y: num('y1') },
        { x: num('x2'), y: num('y2') },
      ],
      false,
      matrix,
      role,
    )
  } else if (tag === 'rect') {
    const x = num('x')
    const y = num('y')
    const w = num('width')
    const h = num('height')
    pushPolyline(
      strokes,
      [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ],
      true,
      matrix,
      role,
    )
  } else if (tag === 'polyline' || tag === 'polygon') {
    pushPolyline(strokes, pointsOf(el.getAttribute('points')), tag === 'polygon', matrix, role)
  } else if (tag === 'circle' || tag === 'ellipse') {
    const rx = tag === 'circle' ? num('r') : num('rx')
    const ry = tag === 'circle' ? num('r') : num('ry')
    const cx = num('cx')
    const cy = num('cy')
    const points: Point[] = []
    for (let i = 0; i <= 36; i++) {
      const a = (i / 36) * Math.PI * 2
      points.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) })
    }
    pushPolyline(strokes, points, true, matrix, role)
  } else if (tag === 'path') {
    const d = el.getAttribute('d') ?? ''
    for (const poly of pathPolylines(d)) pushPolyline(strokes, poly.points, poly.closed, matrix, role)
  }
  for (const child of el.children) walk(child, matrix, strokes)
}

export function importSvg(text: string, name: string): Piece {
  const xml = new DOMParser().parseFromString(text, 'image/svg+xml')
  if (xml.querySelector('parsererror')) throw new Error('El SVG no se pudo leer.')
  const root = xml.querySelector('svg')
  if (!root) throw new Error('El archivo no contiene un SVG.')
  const strokes: Stroke[] = []
  walk(root, identity(), strokes)
  if (strokes.length === 0) throw new Error('El SVG no tiene trazos reconocibles.')
  return {
    id: uid('pieza'),
    name: name.replace(/\.svg$/i, '') || 'Importado',
    x: 0,
    y: 0,
    rotation: 0,
    strokes,
    image: null,
    source: null,
    detached: true,
  }
}
