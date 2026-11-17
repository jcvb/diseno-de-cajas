import { arcSvgPath, normalizeShape, shapeEdges } from '../model/geometry.ts'
import type { Role, Shape } from '../model/types.ts'

type Props = {
  shape: Shape
  stroke: string
  width: number
  dashed?: boolean
  fill?: string
}

export function ShapeView({ shape, stroke, width, dashed = false, fill }: Props) {
  const common = {
    fill: fill ?? 'none',
    stroke: fill ? 'none' : stroke,
    strokeWidth: width,
    strokeDasharray: dashed ? '4 2.2' : undefined,
    vectorEffect: 'non-scaling-stroke' as const,
  }
  switch (shape.kind) {
    case 'line':
      return <line {...common} x1={shape.a.x} y1={shape.a.y} x2={shape.b.x} y2={shape.b.y} />
    case 'polyline': {
      const points = shape.points.map((p) => `${p.x},${p.y}`).join(' ')
      return shape.closed ? <polygon {...common} points={points} /> : <polyline {...common} points={points} />
    }
    case 'rect': {
      const n = normalizeShape(shape)
      return <rect {...common} x={n.x} y={n.y} width={n.width} height={n.height} />
    }
    case 'roundRect': {
      const n = normalizeShape(shape)
      const r = Math.min(n.radius, n.width / 2, n.height / 2)
      return <rect {...common} x={n.x} y={n.y} width={n.width} height={n.height} rx={r} ry={r} />
    }
    case 'ellipse':
      return <ellipse {...common} cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} />
    case 'arc':
      return <path {...common} d={arcSvgPath(shape)} />
  }
}

export function StrokePaint({ shape, role, active }: { shape: Shape; role: Role; active: boolean }) {
  const edges = shapeEdges(shape, role)
  const mixed = !!edges && edges.some((edge) => edge.role !== edges[0].role)
  if (!edges || !mixed) {
    const paint = edges && edges.length > 0 ? edges[0].role : role
    return (
      <ShapeView
        shape={shape}
        stroke={active ? '#b8431f' : paint === 'cut' ? '#1c1915' : '#1d4f91'}
        width={active ? 1.8 : 1.15}
        dashed={paint === 'crease'}
      />
    )
  }
  return (
    <>
      {edges.map((edge, index) => (
        <line
          key={index}
          x1={edge.a.x}
          y1={edge.a.y}
          x2={edge.b.x}
          y2={edge.b.y}
          fill="none"
          stroke={edge.role === 'cut' ? '#1c1915' : '#1d4f91'}
          strokeWidth={1.15}
          strokeDasharray={edge.role === 'crease' ? '4 2.2' : undefined}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </>
  )
}
