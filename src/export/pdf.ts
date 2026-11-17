import {
  PDFDocument,
  appendBezierCurve,
  clip,
  closePath,
  endPath,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  type PDFOperator,
} from 'pdf-lib'
import { MM_TO_PT, type Piece, type Role } from '../model/types.ts'
import { largestCutOutline, normalizeShape, pieceLocalBBox, shapeEdges, shapeToPolylines } from '../model/geometry.ts'
import type { BBox, Doc, Point, Shape } from '../model/types.ts'

const KAPPA = 0.5522847498307936

function dataUrlToBytes(href: string): Uint8Array {
  const base64 = href.split(',')[1] ?? ''
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function piecesWithImage(doc: Doc): Piece[] {
  return doc.pieces.filter((piece) => piece.image)
}

export async function exportPrintPdf(doc: Doc): Promise<Uint8Array | null> {
  const pieces = piecesWithImage(doc)
  if (pieces.length === 0) return null
  const pdf = await PDFDocument.create()
  for (const piece of pieces) {
    const image = piece.image
    if (!image) continue
    const box = pieceLocalBBox({ ...piece, image: null }) ?? {
      x: image.x,
      y: image.y,
      width: image.width,
      height: image.height,
    }
    await addPiecePage(pdf, piece, box)
  }
  return pdf.save()
}

async function addPiecePage(pdf: PDFDocument, piece: Piece, box: BBox): Promise<void> {
  const image = piece.image
  if (!image) return
  const margin = 8
  const pageW = (box.width + margin * 2) * MM_TO_PT
  const pageH = (box.height + margin * 2) * MM_TO_PT
  const page = pdf.addPage([pageW, pageH])
  const embedded = await pdf.embedPng(dataUrlToBytes(image.href))
  const x = (image.x - box.x + margin) * MM_TO_PT
  const y = pageH - (image.y - box.y + margin + image.height) * MM_TO_PT
  const toPdf = (p: Point): Point => ({
    x: (p.x - box.x + margin) * MM_TO_PT,
    y: pageH - (p.y - box.y + margin) * MM_TO_PT,
  })
  const outline = largestCutOutline(piece)
  const path = outline ? outlinePath(outline, toPdf) : []
  const clipped = path.length > 0
  if (clipped) page.pushOperators(pushGraphicsState(), ...path, closePath(), clip(), endPath())
  page.drawImage(embedded, {
    x,
    y,
    width: image.width * MM_TO_PT,
    height: image.height * MM_TO_PT,
  })
  if (clipped) page.pushOperators(popGraphicsState())
  for (const item of piece.strokes) {
    for (const line of strokeLines(item.shape, item.role)) {
      const crease = line.role === 'crease'
      page.drawLine({
        start: toPdf(line.a),
        end: toPdf(line.b),
        thickness: 0.6,
        color: crease ? CREASE : CUT,
        dashArray: crease ? [2 * MM_TO_PT, 1.4 * MM_TO_PT] : [],
      })
    }
  }
}

const CUT = rgb(28 / 255, 25 / 255, 21 / 255)
const CREASE = rgb(29 / 255, 79 / 255, 145 / 255)

function strokeLines(shape: Shape, role: Role): { a: Point; b: Point; role: Role }[] {
  const edges = shapeEdges(shape, role)
  if (edges) return edges
  return shapeToPolylines(shape).flatMap((poly) =>
    poly.points.slice(1).map((point, index) => ({
      a: poly.points[index],
      b: point,
      role,
    })),
  )
}

function outlinePath(shape: Shape, map: (point: Point) => Point): PDFOperator[] {
  if (shape.kind === 'rect') return rectPath(normalizeShape(shape), map)
  if (shape.kind === 'roundRect') {
    const n = normalizeShape(shape)
    const radius = Math.min(Math.max(0, n.radius), n.width / 2, n.height / 2)
    if (radius < 0.05) return rectPath(n, map)
    return roundRectPath(n, radius, map)
  }
  if (shape.kind === 'ellipse') {
    const n = normalizeShape(shape)
    const ops: PDFOperator[] = []
    for (let start = 0; start < 360; start += 90) curveQuarter(ops, n.cx, n.cy, n.rx, n.ry, start, map, start === 0)
    return ops
  }
  const poly = shapeToPolylines(shape)[0]
  if (!poly || poly.points.length < 3) return []
  const points = poly.points.slice()
  const first = points[0]
  const last = points[points.length - 1]
  if (first.x === last.x && first.y === last.y) points.pop()
  if (points.length < 3) return []
  const start = map(points[0])
  return [moveTo(start.x, start.y), ...points.slice(1).map((point) => lineTo(map(point).x, map(point).y))]
}

function rectPath(shape: { x: number; y: number; width: number; height: number }, map: (point: Point) => Point): PDFOperator[] {
  const a = map({ x: shape.x, y: shape.y })
  const b = map({ x: shape.x + shape.width, y: shape.y + shape.height })
  return [rectangle(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))]
}

function roundRectPath(
  shape: { x: number; y: number; width: number; height: number },
  radius: number,
  map: (point: Point) => Point,
): PDFOperator[] {
  const x = shape.x
  const y = shape.y
  const right = x + shape.width
  const bottom = y + shape.height
  const corners = [
    { cx: right - radius, cy: y + radius, a0: -90 },
    { cx: right - radius, cy: bottom - radius, a0: 0 },
    { cx: x + radius, cy: bottom - radius, a0: 90 },
    { cx: x + radius, cy: y + radius, a0: 180 },
  ]
  const ops: PDFOperator[] = []
  corners.forEach((corner, index) => {
    const start = ellipsePoint(corner.cx, corner.cy, radius, radius, corner.a0)
    if (index === 0) {
      const p = map(start)
      ops.push(moveTo(p.x, p.y))
    } else {
      const p = map(start)
      ops.push(lineTo(p.x, p.y))
    }
    curveQuarter(ops, corner.cx, corner.cy, radius, radius, corner.a0, map, false)
  })
  return ops
}

function curveQuarter(
  ops: PDFOperator[],
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  start: number,
  map: (point: Point) => Point,
  move: boolean,
) {
  const p0 = ellipsePoint(cx, cy, rx, ry, start)
  const p3 = ellipsePoint(cx, cy, rx, ry, start + 90)
  const t0 = ellipseTangent(rx, ry, start)
  const t1 = ellipseTangent(rx, ry, start + 90)
  const c1 = map({ x: p0.x + KAPPA * t0.x, y: p0.y + KAPPA * t0.y })
  const c2 = map({ x: p3.x - KAPPA * t1.x, y: p3.y - KAPPA * t1.y })
  const end = map(p3)
  if (move) {
    const origin = map(p0)
    ops.push(moveTo(origin.x, origin.y))
  }
  ops.push(appendBezierCurve(c1.x, c1.y, c2.x, c2.y, end.x, end.y))
}

function ellipsePoint(cx: number, cy: number, rx: number, ry: number, deg: number): Point {
  const angle = (deg * Math.PI) / 180
  return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) }
}

function ellipseTangent(rx: number, ry: number, deg: number): Point {
  const angle = (deg * Math.PI) / 180
  return { x: -rx * Math.sin(angle), y: ry * Math.cos(angle) }
}
