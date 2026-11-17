export type Role = 'cut' | 'crease'

export type Point = { x: number; y: number }

export type LineShape = { kind: 'line'; a: Point; b: Point }

export type PolylineShape = {
  kind: 'polyline'
  points: Point[]
  closed: boolean
  /** Una función por tramo. Si falta, todo el trazo usa Stroke.role. */
  segments?: Role[]
}

export type RectShape = {
  kind: 'rect'
  x: number
  y: number
  width: number
  height: number
  /** Arriba, derecha, abajo, izquierda. Si falta, todo el rectángulo usa Stroke.role. */
  edges?: Role[]
}

export type RoundRectShape = {
  kind: 'roundRect'
  x: number
  y: number
  width: number
  height: number
  radius: number
}

export type EllipseShape = {
  kind: 'ellipse'
  cx: number
  cy: number
  rx: number
  ry: number
}

export type ArcShape = {
  kind: 'arc'
  cx: number
  cy: number
  rx: number
  ry: number
  startAngle: number
  endAngle: number
}

export type Shape =
  | LineShape
  | PolylineShape
  | RectShape
  | RoundRectShape
  | EllipseShape
  | ArcShape

export type Stroke = {
  id: string
  role: Role
  shape: Shape
}

export type PieceImage = {
  href: string
  name: string
  x: number
  y: number
  width: number
  height: number
  hidden: boolean
}

export type PieceSource = {
  generatorId: string
  params: Record<string, number>
}

export type Piece = {
  id: string
  name: string
  x: number
  y: number
  rotation: number
  strokes: Stroke[]
  image: PieceImage | null
  source: PieceSource | null
  detached: boolean
}

export type Group = {
  id: string
  name: string
  pieceIds: string[]
}

export type Measure = {
  id: string
  a: Point
  b: Point
}

export type Doc = {
  pieces: Piece[]
  groups: Group[]
  measures?: Measure[]
}

export type Tool =
  | 'select'
  | 'node'
  | 'hand'
  | 'line'
  | 'polyline'
  | 'rect'
  | 'roundRect'
  | 'ellipse'
  | 'arc'
  | 'square'
  | 'triangle'
  | 'rightTriangle'
  | 'rhombus'
  | 'parallelogram'
  | 'trapezoid'
  | 'kite'
  | 'pentagon'
  | 'hexagon'
  | 'octagon'
  | 'circle'
  | 'semicircle'
  | 'star'
  | 'cross'
  | 'measure'
  | 'tab'

export type Selection = {
  pieceIds: string[]
  strokeId: string | null
  nodeIndex: number | null
  segmentIndex: number | null
  measureIds?: string[]
}

export type BBox = { x: number; y: number; width: number; height: number }

export type AlignMode = 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY'

export const MM_TO_PT = 72 / 25.4

export function emptyDoc(): Doc {
  return { pieces: [], groups: [], measures: [] }
}

export function emptySelection(): Selection {
  return { pieceIds: [], strokeId: null, nodeIndex: null, segmentIndex: null, measureIds: [] }
}
