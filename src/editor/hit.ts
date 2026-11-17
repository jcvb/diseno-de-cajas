import { distanceToShape, localToWorld, pointInShape, shapeNodes, worldToLocal } from '../model/geometry.ts'
import type { Doc, Piece, Point } from '../model/types.ts'

export type StrokeHit = { pieceId: string; strokeId: string; dist: number }

export function hitStroke(doc: Doc, world: Point, tolerance: number): StrokeHit | null {
  for (let i = doc.pieces.length - 1; i >= 0; i--) {
    const piece = doc.pieces[i]
    const local = worldToLocal(piece, world)
    let best: StrokeHit | null = null
    for (const item of piece.strokes) {
      const dist = distanceToShape(item.shape, local)
      if (dist <= tolerance && (!best || dist < best.dist)) {
        best = { pieceId: piece.id, strokeId: item.id, dist }
      }
    }
    if (best) return best
    for (const item of piece.strokes) {
      if (item.role === 'cut' && pointInShape(item.shape, local)) {
        return { pieceId: piece.id, strokeId: item.id, dist: tolerance }
      }
    }
  }
  return null
}

export function hitNode(
  piece: Piece,
  strokeId: string,
  world: Point,
  tolerance: number,
): number | null {
  const stroke = piece.strokes.find((s) => s.id === strokeId)
  if (!stroke) return null
  const local = worldToLocal(piece, world)
  const nodes = shapeNodes(stroke.shape)
  let best = tolerance
  let index: number | null = null
  nodes.forEach((node, i) => {
    const dist = Math.hypot(node.x - local.x, node.y - local.y)
    if (dist <= best) {
      best = dist
      index = i
    }
  })
  return index
}

export function imageHandle(piece: Piece, world: Point, tolerance: number): 'move' | 'scale' | null {
  if (!piece.image || piece.image.hidden) return null
  const local = worldToLocal(piece, world)
  const image = piece.image
  const handle = { x: image.x + image.width, y: image.y + image.height }
  if (Math.hypot(local.x - handle.x, local.y - handle.y) <= tolerance) return 'scale'
  const inside =
    local.x >= image.x && local.x <= image.x + image.width && local.y >= image.y && local.y <= image.y + image.height
  return inside ? 'move' : null
}

export function nodeWorld(piece: Piece, strokeId: string, index: number): Point | null {
  const stroke = piece.strokes.find((s) => s.id === strokeId)
  if (!stroke) return null
  const node = shapeNodes(stroke.shape)[index]
  return node ? localToWorld(piece, node) : null
}
