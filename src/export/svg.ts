import { docBBox, fmt, shapeEdges, shapeSvg } from '../model/geometry.ts'
import type { Doc, Role, Shape } from '../model/types.ts'

function pushShape(cut: string[], crease: string[], shape: Shape, role: Role) {
  const edges = shapeEdges(shape, role)
  const mixed = !!edges && edges.some((edge) => edge.role !== edges[0].role)
  if (!edges || !mixed) {
    const paint = edges && edges.length > 0 ? edges[0].role : role
    const markup = shapeSvg(shape)
    if (paint === 'cut') cut.push(markup)
    else crease.push(markup)
    return
  }
  for (const edge of edges) {
    const markup = `<line x1="${fmt(edge.a.x)}" y1="${fmt(edge.a.y)}" x2="${fmt(edge.b.x)}" y2="${fmt(edge.b.y)}" />`
    if (edge.role === 'cut') cut.push(markup)
    else crease.push(markup)
  }
}

export function exportCutSvg(doc: Doc): string {
  const box = docBBox(doc.pieces) ?? { x: 0, y: 0, width: 100, height: 100 }
  const pad = 5
  const x = box.x - pad
  const y = box.y - pad
  const w = Math.max(box.width + pad * 2, 1)
  const h = Math.max(box.height + pad * 2, 1)
  const cuts: string[] = []
  const creases: string[] = []
  for (const piece of doc.pieces) {
    const transform = `translate(${fmt(piece.x)} ${fmt(piece.y)}) rotate(${fmt(piece.rotation)})`
    const cut: string[] = []
    const crease: string[] = []
    for (const item of piece.strokes) pushShape(cut, crease, item.shape, item.role)
    if (cut.length) cuts.push(`<g id="${piece.id}" transform="${transform}">${cut.join('')}</g>`)
    if (crease.length) creases.push(`<g id="${piece.id}-hendido" transform="${transform}">${crease.join('')}</g>`)
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(w)}mm" height="${fmt(h)}mm" viewBox="${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)}">
  <g id="corte" fill="none" stroke="#000000" stroke-width="0.25">
    ${cuts.join('\n    ')}
  </g>
  <g id="hendido" fill="none" stroke="#0033aa" stroke-width="0.2" stroke-dasharray="2 1.4">
    ${creases.join('\n    ')}
  </g>
</svg>`
}
