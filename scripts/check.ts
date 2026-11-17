import { exportPrintPdf, piecesWithImage } from '../src/export/pdf.ts'
import { exportCutSvg } from '../src/export/svg.ts'
import { generateNave, naveDefaults } from '../src/generators/nave.ts'
import { docBBox, mergeCollinearPoints, mirrorPiece, pieceWorldBBox, rotatePiece90, snapMagnet, stroke } from '../src/model/geometry.ts'
import { shapeFromBox } from '../src/model/figures.ts'
import { applyPathOp, mergeCollinearOpens, snapMeasure, splitRingBySegment } from '../src/model/pathops.ts'
import { unitePieces, weldOpenStroke } from '../src/model/weld.ts'
import { addTab, mergeGenerated, packPieces } from '../src/model/ops.ts'
import { parseProject } from '../src/io/project.ts'
import type { Piece } from '../src/model/types.ts'
import { emptyDoc } from '../src/model/types.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const pieces = packPieces(generateNave(naveDefaults))
const names = pieces.map((piece) => piece.name)
for (const name of [
  'Frente',
  'Espalda',
  'Lateral izquierdo',
  'Lateral derecho',
  'Nariz frente',
  'Nariz espalda',
  'Nariz izquierda',
  'Nariz derecha',
  'Ala izquierda',
  'Ala derecha',
  'Aleta izquierda',
  'Aleta derecha',
  'Cajón',
  'Base horizontal',
  'Soporte vertical',
]) {
  assert(names.includes(name), `Falta la pieza ${name}`)
}

for (const piece of pieces) {
  const box = pieceWorldBBox(piece)
  assert(box && box.width > 1 && box.height > 1, `${piece.name} no tiene tamaño`)
  for (const stroke of piece.strokes) {
    const text = JSON.stringify(stroke.shape)
    assert(!text.includes('null') && !text.includes('NaN'), `${piece.name} tiene geometría inválida`)
  }
}

const front = pieces.find((piece) => piece.name === 'Frente')
assert(front, 'sin frente')
assert(front.strokes.some((stroke) => stroke.shape.kind === 'roundRect'), 'el frente no tiene ventana')
assert(
  front.strokes.filter((stroke) => stroke.role === 'cut' && stroke.shape.kind === 'rect').length >= 2,
  'el frente no tiene boca de cajón',
)
const drawer = pieces.find((piece) => piece.name === 'Cajón')
assert(drawer && drawer.strokes.some((stroke) => stroke.role === 'crease'), 'el cajón no tiene hendidos')
assert(pieces.every((piece) => piece.image === null), 'las piezas nacen sin imagen')

const doc = mergeGenerated(emptyDoc(), pieces)
const again = mergeGenerated(doc, packPieces(generateNave(naveDefaults)))
assert(again.pieces.length === pieces.length, 'regenerar duplicó piezas')
assert(again.pieces[0].id === doc.pieces[0].id, 'regenerar no conservó la pieza')

const svg = exportCutSvg(doc)
assert(svg.includes('id="corte"') && svg.includes('id="hendido"'), 'el SVG no separa corte y hendido')
assert(!svg.includes('<image'), 'el SVG de corte incluye una imagen')

const mirrored = mirrorPiece(pieces[8], 'h', { x: 100, y: 100 })
assert(pieceWorldBBox(mirrored), 'el reflejo no tiene caja')
const turned = rotatePiece90(pieces[0])
assert(turned.rotation === 90, 'no rotó')

const withImage: Piece = {
  ...pieces.find((piece) => piece.name === 'Cajón')!,
  image: {
    href: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    name: 'prueba.png',
    x: 10,
    y: 10,
    width: 40,
    height: 20,
    hidden: false,
  },
}
const printable = { pieces: [withImage, pieces[0]], groups: [] }
assert(piecesWithImage(printable).length === 1, 'el PDF debe ignorar la pieza sin imagen')
const pdf = await exportPrintPdf(printable)
assert(pdf && pdf.length > 100, 'el PDF salió vacío')
const saved = parseProject(JSON.stringify({ version: 1, doc: printable }))
assert(saved.pieces[0].image?.name === 'prueba.png', 'el proyecto no guardó la imagen')
assert(docBBox(pieces), 'el documento no tiene extensión')

function bare(id: string, strokes: Piece['strokes']): Piece {
  return { id, name: id, x: 0, y: 0, rotation: 0, strokes, image: null, source: null, detached: false }
}

const left = stroke('cut', { kind: 'line', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }, 'left')
const right = stroke('cut', { kind: 'line', a: { x: 10, y: 0 }, b: { x: 20, y: 4 } }, 'right')
const joined = weldOpenStroke({ pieces: [bare('p', [left, right])], groups: [] }, 'p', 'left', {
  end: 'end',
  origin: { x: 0, y: 0 },
})
assert(joined.joined === 1, 'el imán no unió las líneas')
assert(joined.doc.pieces[0].strokes.length === 1, 'siguieron siendo dos trazos')
const joinedShape = joined.doc.pieces[0].strokes[0].shape
assert(joinedShape.kind === 'polyline' && joinedShape.points.length === 3, 'la unión no es una polilínea')

const stayed = weldOpenStroke({ pieces: [bare('p', [left, right])], groups: [] }, 'p', 'left', {
  end: 'end',
  origin: { x: 10, y: 0 },
})
assert(stayed.joined === 0, 'unió líneas que ya se tocaban')

const fold = stroke('crease', { kind: 'line', a: { x: 10, y: 0 }, b: { x: 10, y: 8 } }, 'fold')
const mixedRole = weldOpenStroke({ pieces: [bare('p', [left, fold])], groups: [] }, 'p', 'left', {
  end: 'end',
  origin: { x: 0, y: 0 },
})
assert(mixedRole.joined === 0, 'unió un corte con un doblez')

const united = unitePieces(
  {
    pieces: [
      bare('a', [stroke('cut', { kind: 'rect', x: 0, y: 0, width: 10, height: 10 }, 'ra')]),
      bare('b', [stroke('cut', { kind: 'rect', x: 10, y: 0, width: 10, height: 10 }, 'rb')]),
    ],
    groups: [],
  },
  ['a', 'b'],
)
assert(united.pieces.length === 1, 'unir piezas dejó las dos')
assert(united.pieces[0].strokes.some((item) => item.role === 'crease'), 'el borde compartido no pasó a doblez')
const outline = united.pieces[0].strokes.find((item) => item.role === 'cut')
assert(outline?.shape.kind === 'polyline' && outline.shape.closed && outline.shape.points.length === 6, 'el contorno unido no tiene 6 lados')

const mixed = exportCutSvg({
  pieces: [bare('m', [stroke('cut', { kind: 'rect', x: 0, y: 0, width: 30, height: 20, edges: ['cut', 'crease', 'cut', 'cut'] }, 'mr')])],
  groups: [],
})
assert(mixed.includes('id="hendido"') && !mixed.includes('<rect'), 'un tramo doblez se exportó como corte')

const straight = mergeCollinearPoints(
  [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 30, y: 0 },
  ],
  false,
)
assert(straight.length === 2, 'una arista recta no se volvió una sola línea')

const overlapped = mergeCollinearOpens(
  {
    pieces: [
      bare('p', [
        stroke('cut', { kind: 'line', a: { x: 0, y: 0 }, b: { x: 50, y: 0 } }, 's1'),
        stroke('cut', { kind: 'line', a: { x: 40, y: 0 }, b: { x: 90, y: 0 } }, 's2'),
      ]),
    ],
    groups: [],
  },
  ['p'],
)
assert(overlapped.merged === 1 && overlapped.doc.pieces[0].strokes.length === 1, 'dos líneas en la misma dirección no se unieron')

const halves = splitRingBySegment(
  [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
    { x: 0, y: 50 },
  ],
  { x: -10, y: 25 },
  { x: 110, y: 25 },
)
assert(halves?.length === 2, 'una línea que cruza no partió la figura')

const rhombus = shapeFromBox('rhombus', { x: 0, y: 0 }, { x: 40, y: 20 })
assert(rhombus?.kind === 'polyline' && rhombus.closed && rhombus.points.length === 4, 'el rombo no tiene 4 vértices')
const triangle = shapeFromBox('triangle', { x: 0, y: 0 }, { x: 60, y: 40 })
assert(triangle?.kind === 'polyline' && triangle.points.length === 3, 'el triángulo no tiene 3 vértices')
const rightTriangle = shapeFromBox('rightTriangle', { x: 0, y: 0 }, { x: 30, y: 40 })
assert(rightTriangle?.kind === 'polyline' && rightTriangle.points.length === 3, 'el triángulo recto no tiene 3 vértices')
const square = shapeFromBox('square', { x: 0, y: 0 }, { x: 20, y: 50 })
assert(square?.kind === 'rect' && square.width === 50 && square.height === 50, 'el cuadrado no conserva lados iguales')
const star = shapeFromBox('star', { x: 0, y: 0 }, { x: 40, y: 40 })
assert(star?.kind === 'polyline' && star.points.length === 10, 'la estrella no tiene 5 puntas')
const cross = shapeFromBox('cross', { x: 0, y: 0 }, { x: 40, y: 40 })
assert(cross?.kind === 'polyline' && cross.closed && cross.points.length === 12, 'la cruz no cerró el contorno')
assert(Math.abs(snapMeasure(98, [100, 40], 6) - 100) < 0.01, 'no igualó el ancho cercano')

const boxA = bare('a', [stroke('cut', { kind: 'rect', x: 0, y: 0, width: 100, height: 80 }, 'ca')])
const boxB = bare('b', [stroke('cut', { kind: 'rect', x: 60, y: 20, width: 80, height: 80 }, 'cb')])
const union = applyPathOp({ pieces: [boxA, boxB], groups: [] }, ['a', 'b'], 'union')
assert(union.changed && union.doc.pieces.length === 1, 'unir trazos no dejó un solo contorno')
const squarePiece = bare('sq', [stroke('cut', shapeFromBox('square', { x: 0, y: 0 }, { x: 100, y: 100 })!, 'sq')])
const paraShape = shapeFromBox('parallelogram', { x: 80, y: 0 }, { x: 180, y: 100 })
const paraPiece = bare('pa', [stroke('cut', paraShape!, 'pa')])
const joinedFigures = applyPathOp({ pieces: [squarePiece, paraPiece], groups: [] }, ['sq', 'pa'], 'union')
const joinedOutline = joinedFigures.doc.pieces[0]?.strokes[0]?.shape
const joinedPoints = joinedOutline?.kind === 'polyline' ? joinedOutline.points : []
const hasVertex = (x: number, y: number) => joinedPoints.some((point) => Math.hypot(point.x - x, point.y - y) < 0.4)
assert(hasVertex(100, 100) && hasVertex(80, 100) && hasVertex(0, 100) && hasVertex(158, 100), 'unir cuadrado y romboide eliminó vértices')

function tabDepth(size: number): number {
  const piece = bare('sq', [stroke('cut', { kind: 'rect', x: 0, y: 0, width: size, height: size }, 'r')])
  const result = addTab({ pieces: [piece], groups: [] }, 'sq', 'r', 1)
  const shape = result?.doc.pieces[0]?.strokes.at(-1)?.shape
  const points = shape?.kind === 'polyline' ? shape.points : []
  return Math.max(...points.map((point) => point.x)) - size
}
assert(Math.abs(tabDepth(200) - 5) < 0.05 && Math.abs(tabDepth(40) - 5) < 0.05, 'la pestaña no mide 5 mm')
const inter = applyPathOp({ pieces: [boxA, boxB], groups: [] }, ['a', 'b'], 'intersect')
assert(inter.changed && inter.doc.pieces[0].strokes.length === 1, 'intersecar no dejó la zona común')
const divided = applyPathOp({ pieces: [boxA, boxB], groups: [] }, ['a', 'b'], 'divide')
assert(divided.changed && divided.doc.pieces[0].strokes.length >= 3, 'dividir no separó las zonas')

const panel = bare('panel', [stroke('cut', { kind: 'rect', x: 0, y: 0, width: 100, height: 60 }, 'panel')])
const knife = bare('knife', [stroke('cut', { kind: 'line', a: { x: -10, y: 30 }, b: { x: 120, y: 30 } }, 'knife')])
const cut = applyPathOp({ pieces: [panel, knife], groups: [] }, ['panel', 'knife'], 'divide')
assert(cut.changed, 'la línea que cruza no cortó la figura')
const closedParts = cut.doc.pieces.flatMap((piece) => piece.strokes).filter((item) => item.shape.kind === 'polyline' && item.shape.closed)
assert(closedParts.length === 2, 'la figura no quedó en dos partes')

const guidePiece = bare('guia', [stroke('cut', { kind: 'rect', x: 0, y: 0, width: 100, height: 40 }, 'guia')])
const fromVertex = snapMagnet({ x: 3, y: 4 }, [guidePiece], 10, 8, true)
assert(fromVertex.kind === 'vertex' && fromVertex.point.x === 0 && fromVertex.point.y === 0, 'no empezó en el vértice')
const alongStroke = snapMagnet({ x: 50, y: 6 }, [guidePiece], 10, 8, true)
assert(alongStroke.kind === 'stroke' && Math.abs(alongStroke.point.y) < 0.01 && Math.abs(alongStroke.point.x - 50) < 0.01, 'no se pegó al trazo')
const onGuide = snapMagnet({ x: 132, y: 87 }, [guidePiece], 10, 8, true)
assert(onGuide.kind === 'guide' && onGuide.point.x === 130 && onGuide.point.y === 90, 'no se pegó a la guía')
const toOtherVertex = snapMagnet({ x: 97, y: 43 }, [guidePiece], 10, 8, true)
assert(toOtherVertex.kind === 'vertex' && toOtherVertex.point.x === 100 && toOtherVertex.point.y === 40, 'el final no cayó en el otro vértice')

console.log(`ok: ${pieces.length} piezas, svg ${svg.length} bytes, pdf ${pdf?.length} bytes`)
