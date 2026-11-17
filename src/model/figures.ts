import type { Point, Shape, Tool } from './types.ts'

export type BoxTool =
  | 'rect'
  | 'square'
  | 'roundRect'
  | 'ellipse'
  | 'circle'
  | 'semicircle'
  | 'arc'
  | 'triangle'
  | 'rightTriangle'
  | 'rhombus'
  | 'parallelogram'
  | 'trapezoid'
  | 'kite'
  | 'pentagon'
  | 'hexagon'
  | 'octagon'
  | 'star'
  | 'cross'

const boxTools: readonly BoxTool[] = [
  'rect',
  'square',
  'roundRect',
  'ellipse',
  'circle',
  'semicircle',
  'arc',
  'triangle',
  'rightTriangle',
  'rhombus',
  'parallelogram',
  'trapezoid',
  'kite',
  'pentagon',
  'hexagon',
  'octagon',
  'star',
  'cross',
]

export function isBoxTool(tool: Tool): tool is BoxTool {
  return (boxTools as readonly string[]).includes(tool)
}

export function shapeFromBox(kind: BoxTool, a: Point, b: Point): Shape | null {
  const box = kind === 'square' || kind === 'circle' ? equalBox(a, b) : axisBox(a, b)
  if (!box) return null
  const { x, y, width, height } = box
  const cx = x + width / 2
  const cy = y + height / 2
  if (kind === 'rect' || kind === 'square') return { kind: 'rect', x, y, width, height }
  if (kind === 'roundRect') {
    return { kind: 'roundRect', x, y, width, height, radius: Math.min(12, width / 4, height / 4) }
  }
  if (kind === 'ellipse' || kind === 'circle') return { kind: 'ellipse', cx, cy, rx: width / 2, ry: height / 2 }
  if (kind === 'semicircle') return closed(semicircle(x, y, width, height))
  if (kind === 'arc') {
    return { kind: 'arc', cx, cy, rx: width / 2, ry: height / 2, startAngle: 200, endAngle: 340 }
  }
  if (kind === 'triangle') {
    return closed([
      { x: cx, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ])
  }
  if (kind === 'rightTriangle') {
    return closed([
      { x, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ])
  }
  if (kind === 'rhombus') {
    return closed([
      { x: cx, y },
      { x: x + width, y: cy },
      { x: cx, y: y + height },
      { x, y: cy },
    ])
  }
  if (kind === 'parallelogram') {
    const shear = width * 0.22
    return closed([
      { x: x + shear, y },
      { x: x + width, y },
      { x: x + width - shear, y: y + height },
      { x, y: y + height },
    ])
  }
  if (kind === 'trapezoid') {
    const inset = width * 0.18
    return closed([
      { x: x + inset, y },
      { x: x + width - inset, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ])
  }
  if (kind === 'kite') {
    return closed([
      { x: cx, y },
      { x: x + width, y: y + height * 0.38 },
      { x: cx, y: y + height },
      { x, y: y + height * 0.38 },
    ])
  }
  if (kind === 'star') return closed(star(cx, cy, width / 2, height / 2))
  if (kind === 'cross') return closed(cross(x, y, width, height))
  const sides = kind === 'pentagon' ? 5 : kind === 'hexagon' ? 6 : 8
  return closed(regularPolygon(cx, cy, width / 2, height / 2, sides))
}

function axisBox(a: Point, b: Point): { x: number; y: number; width: number; height: number } | null {
  const width = Math.abs(b.x - a.x)
  const height = Math.abs(b.y - a.y)
  if (width < 1 || height < 1) return null
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width, height }
}

function equalBox(a: Point, b: Point): { x: number; y: number; width: number; height: number } | null {
  const side = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))
  if (side < 1) return null
  return {
    x: b.x >= a.x ? a.x : a.x - side,
    y: b.y >= a.y ? a.y : a.y - side,
    width: side,
    height: side,
  }
}

function closed(points: Point[]): Shape {
  return { kind: 'polyline', points, closed: true }
}

function regularPolygon(cx: number, cy: number, rx: number, ry: number, sides: number): Point[] {
  const start = -Math.PI / 2
  return Array.from({ length: sides }, (_, index) => {
    const angle = start + (index * 2 * Math.PI) / sides
    return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) }
  })
}

function semicircle(x: number, y: number, width: number, height: number): Point[] {
  const steps = 16
  const cx = x + width / 2
  const base = y + height
  const points: Point[] = []
  for (let index = 0; index <= steps; index++) {
    const angle = Math.PI - (index * Math.PI) / steps
    points.push({ x: cx + (width / 2) * Math.cos(angle), y: base - height * Math.sin(angle) })
  }
  return points
}

function star(cx: number, cy: number, rx: number, ry: number): Point[] {
  const points: Point[] = []
  const start = -Math.PI / 2
  for (let index = 0; index < 10; index++) {
    const outer = index % 2 === 0
    const angle = start + (index * Math.PI) / 5
    points.push({
      x: cx + (outer ? rx : rx * 0.4) * Math.cos(angle),
      y: cy + (outer ? ry : ry * 0.4) * Math.sin(angle),
    })
  }
  return points
}

function cross(x: number, y: number, width: number, height: number): Point[] {
  const arm = Math.min(width, height) * 0.32
  const hx = arm / 2
  const hy = arm / 2
  const cx = x + width / 2
  const cy = y + height / 2
  return [
    { x: cx - hx, y },
    { x: cx + hx, y },
    { x: cx + hx, y: cy - hy },
    { x: x + width, y: cy - hy },
    { x: x + width, y: cy + hy },
    { x: cx + hx, y: cy + hy },
    { x: cx + hx, y: y + height },
    { x: cx - hx, y: y + height },
    { x: cx - hx, y: cy + hy },
    { x, y: cy + hy },
    { x, y: cy - hy },
    { x: cx - hx, y: cy - hy },
  ]
}
