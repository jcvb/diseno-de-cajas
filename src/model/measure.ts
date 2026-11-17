import { distToSegment } from './geometry.ts'
import type { Measure, Point } from './types.ts'

export function formatLength(mm: number): string {
  const rounded = Math.round(mm * 10) / 10
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return `${text} mm`
}

export function measureLength(measure: Pick<Measure, 'a' | 'b'>): number {
  return Math.hypot(measure.b.x - measure.a.x, measure.b.y - measure.a.y)
}

export function pointAtDistance(origin: Point, toward: Point, distance: number): Point {
  const dx = toward.x - origin.x
  const dy = toward.y - origin.y
  const len = Math.hypot(dx, dy)
  if (len < 0.001) return { x: origin.x + distance, y: origin.y }
  return { x: origin.x + (dx / len) * distance, y: origin.y + (dy / len) * distance }
}

export function typedLength(typed: string): number | null {
  const value = Number(typed.replace(',', '.'))
  if (!typed.trim() || !Number.isFinite(value) || value <= 0) return null
  return value
}

export type DimensionLayout = {
  a: Point
  b: Point
  a2: Point
  b2: Point
  mid: Point
  angle: number
  length: number
}

export function dimensionLayout(a: Point, b: Point, zoom: number): DimensionLayout | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy)
  if (length < 0.2) return null
  const offset = 16 / zoom
  const ox = (-dy / length) * offset
  const oy = (dx / length) * offset
  const a2 = { x: a.x + ox, y: a.y + oy }
  const b2 = { x: b.x + ox, y: b.y + oy }
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI
  if (angle > 90) angle -= 180
  else if (angle < -90) angle += 180
  return { a, b, a2, b2, mid: { x: (a2.x + b2.x) / 2, y: (a2.y + b2.y) / 2 }, angle, length }
}

export function hitMeasure(measures: Measure[], world: Point, tolerance: number, zoom: number): { id: string; dist: number } | null {
  let best: { id: string; dist: number } | null = null
  for (const measure of measures) {
    const layout = dimensionLayout(measure.a, measure.b, zoom)
    const distances = [distToSegment(world, measure.a, measure.b)]
    if (layout) {
      distances.push(distToSegment(world, layout.a2, layout.b2), distToSegment(world, measure.a, layout.a2), distToSegment(world, measure.b, layout.b2))
    }
    const dist = Math.min(...distances)
    if (dist <= tolerance && (!best || dist < best.dist)) best = { id: measure.id, dist }
  }
  return best
}
