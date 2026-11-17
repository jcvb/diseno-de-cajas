import {
  clamp,
  normalizePiece,
  polygonWithEdgeFlaps,
  stroke,
  uid,
} from '../model/geometry.ts'
import type { Piece, Point, Stroke } from '../model/types.ts'
import type { Generator } from './types.ts'

export type NaveParams = {
  alto: number
  ancho: number
  fondo: number
  cajonAncho: number
  cajonAlto: number
  cajonFondo: number
  calibre: number
}

export const naveDefaults: NaveParams = {
  alto: 1000,
  ancho: 300,
  fondo: 220,
  cajonAncho: 228,
  cajonAlto: 90,
  cajonFondo: 170,
  calibre: 3,
}

export function sanitizeNave(params: NaveParams): NaveParams {
  const alto = clamp(params.alto, 400, 2500)
  const ancho = clamp(params.ancho, 140, 800)
  const fondo = clamp(params.fondo, 100, 600)
  const calibre = clamp(params.calibre, 1, 8)
  return {
    alto,
    ancho,
    fondo,
    calibre,
    cajonAncho: clamp(params.cajonAncho, 80, ancho - 36),
    cajonAlto: clamp(params.cajonAlto, 40, 220),
    cajonFondo: clamp(params.cajonFondo, 60, fondo - 16),
  }
}

function piece(name: string, strokes: Stroke[], params: NaveParams): Piece {
  return normalizePiece({
    id: uid('pieza'),
    name,
    x: 0,
    y: 0,
    rotation: 0,
    strokes,
    image: null,
    source: { generatorId: 'nave', params: { ...params } },
    detached: false,
  })
}

function panel(width: number, height: number, flap: number, holes: Stroke[]): Stroke[] {
  const totalW = width + flap * 2
  return [
    stroke('cut', { kind: 'rect', x: 0, y: 0, width: totalW, height }),
    stroke('crease', { kind: 'line', a: { x: flap, y: 0 }, b: { x: flap, y: height } }),
    stroke('crease', { kind: 'line', a: { x: flap + width, y: 0 }, b: { x: flap + width, y: height } }),
    ...holes,
  ]
}

function slot(x: number, y: number, width: number, height: number): Stroke {
  return stroke('cut', { kind: 'rect', x, y, width, height })
}

function nose(base: number, altitude: number, flap: number): Stroke[] {
  const triangle: Point[] = [
    { x: base / 2, y: 0 },
    { x: base, y: altitude },
    { x: 0, y: altitude },
  ]
  const { outline, creases } = polygonWithEdgeFlaps(triangle, flap)
  return [
    stroke('cut', { kind: 'polyline', points: outline, closed: true }),
    ...creases.map(([a, b]) => stroke('crease', { kind: 'line', a, b })),
  ]
}

function wing(span: number, root: number, tip: number, sweep: number, tabW: number, tabH: number): Point[] {
  const tabTop = (root - tabH) / 2
  const tabBot = tabTop + tabH
  return [
    { x: -tabW, y: tabTop },
    { x: 0, y: tabTop },
    { x: 0, y: 0 },
    { x: span, y: sweep },
    { x: span, y: sweep + tip },
    { x: 0, y: root },
    { x: 0, y: tabBot },
    { x: -tabW, y: tabBot },
  ]
}

function mirrorX(points: Point[]): Point[] {
  return points.map((p) => ({ x: -p.x, y: p.y }))
}

function drawer(width: number, depth: number, wall: number, flap: number, lip: number): Stroke[] {
  const baseX = wall
  const baseY = wall
  const left = baseX - flap
  const right = baseX + width + flap
  const outerLeft = baseX - wall
  const outerRight = baseX + width + wall
  const baseBottom = baseY + depth
  const frontBottom = baseBottom + wall
  const lipBottom = frontBottom + lip
  const outline: Point[] = [
    { x: left, y: 0 },
    { x: right, y: 0 },
    { x: right, y: baseY },
    { x: outerRight, y: baseY },
    { x: outerRight, y: baseBottom },
    { x: right, y: baseBottom },
    { x: right, y: frontBottom },
    { x: baseX + width, y: frontBottom },
    { x: baseX + width, y: lipBottom },
    { x: baseX, y: lipBottom },
    { x: baseX, y: frontBottom },
    { x: left, y: frontBottom },
    { x: left, y: baseBottom },
    { x: outerLeft, y: baseBottom },
    { x: outerLeft, y: baseY },
    { x: left, y: baseY },
  ]
  const crease = (a: Point, b: Point) => stroke('crease', { kind: 'line', a, b })
  return [
    stroke('cut', { kind: 'polyline', points: outline, closed: true }),
    crease({ x: baseX, y: baseY }, { x: baseX + width, y: baseY }),
    crease({ x: baseX, y: baseBottom }, { x: baseX + width, y: baseBottom }),
    crease({ x: baseX, y: baseY }, { x: baseX, y: baseBottom }),
    crease({ x: baseX + width, y: baseY }, { x: baseX + width, y: baseBottom }),
    crease({ x: baseX, y: 0 }, { x: baseX, y: baseY }),
    crease({ x: baseX + width, y: 0 }, { x: baseX + width, y: baseY }),
    crease({ x: baseX, y: baseBottom }, { x: baseX, y: frontBottom }),
    crease({ x: baseX + width, y: baseBottom }, { x: baseX + width, y: frontBottom }),
    crease({ x: baseX, y: frontBottom }, { x: baseX + width, y: frontBottom }),
  ]
}

function foot(length: number, height: number, slotW: number): Stroke[] {
  const slotH = height / 2
  const slotX = (length - slotW) / 2
  const outline: Point[] = [
    { x: 0, y: 0 },
    { x: slotX, y: 0 },
    { x: slotX, y: slotH },
    { x: slotX + slotW, y: slotH },
    { x: slotX + slotW, y: 0 },
    { x: length, y: 0 },
    { x: length, y: height },
    { x: 0, y: height },
  ]
  return [stroke('cut', { kind: 'polyline', points: outline, closed: true })]
}

function spine(width: number, height: number, tabW: number, tabH: number, slotW: number, slotH: number): Stroke[] {
  const tabX = (width - tabW) / 2
  const bottom = tabH + height
  const slotX = (width - slotW) / 2
  const outline: Point[] = [
    { x: 0, y: tabH },
    { x: tabX, y: tabH },
    { x: tabX, y: 0 },
    { x: tabX + tabW, y: 0 },
    { x: tabX + tabW, y: tabH },
    { x: width, y: tabH },
    { x: width, y: bottom },
    { x: slotX + slotW, y: bottom },
    { x: slotX + slotW, y: bottom - slotH },
    { x: slotX, y: bottom - slotH },
    { x: slotX, y: bottom },
    { x: 0, y: bottom },
  ]
  return [stroke('cut', { kind: 'polyline', points: outline, closed: true })]
}

export function generateNave(raw: NaveParams): Piece[] {
  const params = sanitizeNave(raw)
  const { alto, ancho, fondo, cajonAncho, cajonAlto, cajonFondo, calibre } = params
  const flap = Math.max(14, calibre * 5)
  const winW = ancho * 0.58
  const winH = Math.min(130, alto * 0.13)
  const winX = flap + (ancho - winW) / 2
  const winY = alto * 0.15
  const mouthW = cajonAncho + calibre * 2
  const mouthH = cajonAlto * 0.7
  const mouthX = flap + (ancho - mouthW) / 2
  const mouthY = alto - mouthH - Math.max(40, alto * 0.055)
  const frontHoles = [
    stroke('cut', {
      kind: 'roundRect',
      x: winX,
      y: winY,
      width: winW,
      height: winH,
      radius: Math.min(18, winH / 2),
    }),
    stroke('cut', { kind: 'rect', x: mouthX, y: mouthY, width: mouthW, height: mouthH }),
  ]
  const backSlot = slot(flap + (ancho - calibre) / 2, alto - 70, calibre, 36)
  const wingRoot = Math.max(100, alto * 0.13)
  const wingTabH = wingRoot * 0.5
  const finRoot = wingRoot * 0.62
  const finTabH = finRoot * 0.5
  const sideSlotX = (fondo - calibre) / 2
  const sideHoles = [
    slot(sideSlotX, alto * 0.38, calibre, wingTabH),
    slot(sideSlotX, alto * 0.7, calibre, finTabH),
  ]
  const rise = Math.min(220, alto * 0.2)
  const frontAlt = Math.sqrt(rise * rise + (fondo / 2) ** 2)
  const sideAlt = Math.sqrt(rise * rise + (ancho / 2) ** 2)
  const wingSpan = ancho * 1.15
  const leftWing = wing(wingSpan, wingRoot, wingRoot * 0.42, wingRoot * 0.28, 22, wingTabH)
  const finSpan = wingSpan * 0.48
  const leftFin = wing(finSpan, finRoot, finRoot * 0.55, finRoot * 0.15, 18, finTabH)

  return [
    piece('Frente', panel(ancho, alto, flap, frontHoles), params),
    piece('Espalda', panel(ancho, alto, flap, [backSlot]), params),
    piece('Lateral izquierdo', [stroke('cut', { kind: 'rect', x: 0, y: 0, width: fondo, height: alto }), ...sideHoles], params),
    piece('Lateral derecho', [stroke('cut', { kind: 'rect', x: 0, y: 0, width: fondo, height: alto }), ...sideHoles.map((s) => ({ ...s, id: uid('trazo') }))], params),
    piece('Nariz frente', nose(ancho, frontAlt, flap), params),
    piece('Nariz espalda', nose(ancho, frontAlt, flap), params),
    piece('Nariz izquierda', nose(fondo, sideAlt, flap), params),
    piece('Nariz derecha', nose(fondo, sideAlt, flap), params),
    piece('Ala izquierda', [stroke('cut', { kind: 'polyline', points: leftWing, closed: true })], params),
    piece('Ala derecha', [stroke('cut', { kind: 'polyline', points: mirrorX(leftWing), closed: true })], params),
    piece('Aleta izquierda', [stroke('cut', { kind: 'polyline', points: leftFin, closed: true })], params),
    piece('Aleta derecha', [stroke('cut', { kind: 'polyline', points: mirrorX(leftFin), closed: true })], params),
    piece('Cajón', drawer(cajonAncho, cajonFondo, cajonAlto, flap, 16), params),
    piece('Base horizontal', foot(ancho + 90, 80, calibre), params),
    piece('Soporte vertical', spine(Math.min(fondo * 0.8, fondo - 8), 200, 36, 20, calibre, 40), params),
  ]
}

export const naveGenerator: Generator<NaveParams> = {
  id: 'nave',
  name: 'Nave con cajón',
  defaults: naveDefaults,
  fields: [
    { key: 'alto', label: 'Alto', min: 400, max: 2500, step: 1 },
    { key: 'ancho', label: 'Ancho', min: 140, max: 800, step: 1 },
    { key: 'fondo', label: 'Fondo', min: 100, max: 600, step: 1 },
    { key: 'cajonAncho', label: 'Cajón ancho', min: 80, max: 700, step: 1 },
    { key: 'cajonAlto', label: 'Cajón alto', min: 40, max: 220, step: 1 },
    { key: 'cajonFondo', label: 'Cajón fondo', min: 60, max: 500, step: 1 },
    { key: 'calibre', label: 'Calibre', min: 1, max: 8, step: 0.5 },
  ],
  generate: generateNave,
}
