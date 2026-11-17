import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { hitNode, hitStroke, imageHandle, nodeWorld } from './hit.ts'
import { dimensionLayout, formatLength, hitMeasure, pointAtDistance, typedLength } from '../model/measure.ts'
import { ShapeView, StrokePaint } from './ShapeView.tsx'
import { useShortcuts } from './shortcuts.ts'
import { isBoxTool, shapeFromBox, type BoxTool } from '../model/figures.ts'
import {
  distToSegment,
  insertOnPolyline,
  intoLocal,
  isOpenEnd,
  largestCutOutline,
  localToWorld,
  neighborNodes,
  normalizeShape,
  pieceLocalBBox,
  shapeBBox,
  shapeEdges,
  shapeNodes,
  snapMagnet,
  straightenJoint,
  worldToLocal,
  type MagnetKind,
} from '../model/geometry.ts'
import { finishStroke } from '../model/pathops.ts'
import { groupMates } from '../model/ops.ts'
import { weldOpenStroke } from '../model/weld.ts'
import { useEditor } from '../model/store.ts'
import type { Piece, PieceImage, Point, Role, Shape } from '../model/types.ts'

type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'move'; start: Point; ids: string[] }
  | { kind: 'marquee'; a: Point; b: Point; additive: boolean; base: string[]; baseMeasures: string[] }
  | { kind: 'line'; a: Point; b: Point }
  | { kind: 'measure'; a: Point; b: Point; typed: string }
  | { kind: 'polyline'; points: Point[] }
  | { kind: 'box'; kindShape: BoxTool; a: Point; b: Point }
  | { kind: 'node'; pieceId: string; strokeId: string; index: number }
  | { kind: 'image-move'; pieceId: string; start: Point }
  | { kind: 'image-scale'; pieceId: string; aspect: number }

export function Canvas() {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const consume = useRef<((event: KeyboardEvent) => boolean) | null>(null)
  const [draft, setDraft] = useState<Drag | null>(null)
  const [hover, setHover] = useState<Point | null>(null)
  const [magnet, setMagnet] = useState<MagnetKind>('free')
  const viewport = useEditor((s) => s.viewport)
  const doc = useEditor((s) => s.doc)
  const selection = useEditor((s) => s.selection)
  const tool = useEditor((s) => s.tool)
  const view = useEditor((s) => s.view)
  const showImages = useEditor((s) => s.showImages)
  const grid = useEditor((s) => s.grid)
  const hRuler = useRef<HTMLCanvasElement>(null)
  const vRuler = useRef<HTMLCanvasElement>(null)

  useShortcuts(consume)
  const [space, setSpace] = useState(false)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const observer = new ResizeObserver(() => {
      const rect = svg.getBoundingClientRect()
      useEditor.getState().setViewport(rect.width, rect.height)
    })
    observer.observe(svg)
    const stage = svg.closest('.board') ?? svg
    const overBoard = (target: EventTarget | null) => target instanceof Node && stage.contains(target)
    const zoomAtClient = (clientX: number, clientY: number, factor: number) => {
      if (!Number.isFinite(factor) || Math.abs(factor - 1) < 0.0001) return
      const rect = svg.getBoundingClientRect()
      const point = svg.createSVGPoint()
      point.x = clientX
      point.y = clientY
      const matrix = svg.getScreenCTM()
      if (!matrix) return
      const mapped = point.matrixTransform(matrix.inverse())
      useEditor.getState().zoomAt(
        { x: mapped.x, y: mapped.y },
        { x: clientX - rect.left, y: clientY - rect.top },
        factor,
      )
    }
    // Safari manda el pellizco como gesture*; Chrome y Firefox como wheel con ctrl.
    let pinching = false
    const onGestureStart = (event: Event) => {
      if (!overBoard(event.target)) return
      event.preventDefault()
      pinching = true
      svg.dataset.pinchScale = '1'
    }
    const onGestureChange = (event: Event) => {
      if (!pinching) return
      event.preventDefault()
      const scale = (event as Event & { scale?: number }).scale
      const clientX = (event as Event & { clientX?: number }).clientX
      const clientY = (event as Event & { clientY?: number }).clientY
      if (!scale || scale <= 0) return
      const previous = Number(svg.dataset.pinchScale || '1')
      svg.dataset.pinchScale = String(scale)
      if (clientX == null || clientY == null) return
      zoomAtClient(clientX, clientY, scale / previous)
    }
    const onGestureEnd = (event: Event) => {
      if (!pinching) return
      event.preventDefault()
      pinching = false
      delete svg.dataset.pinchScale
    }
    const onWheel = (event: WheelEvent) => {
      const pinch = event.ctrlKey
      if (!pinch && !overBoard(event.target)) return
      if (!overBoard(event.target)) {
        if (pinch) event.preventDefault()
        return
      }
      event.preventDefault()
      if (pinching) return
      const dy = event.deltaY !== 0 ? event.deltaY : event.deltaX
      if (dy === 0) return
      // Misma curva que un lienzo: el pellizco llega con ctrl y un delta mucho más chico.
      const mode = event.deltaMode === 1 ? 0.05 : event.deltaMode === 2 ? 1 : 0.002
      const factor = 2 ** (-dy * mode * (pinch ? 10 : 1))
      zoomAtClient(event.clientX, event.clientY, factor)
    }
    const listen = (type: string, listener: EventListener) => {
      document.addEventListener(type, listener, { capture: true, passive: false })
    }
    const forget = (type: string, listener: EventListener) => {
      document.removeEventListener(type, listener, { capture: true })
    }
    listen('wheel', onWheel as EventListener)
    listen('gesturestart', onGestureStart)
    listen('gesturechange', onGestureChange)
    listen('gestureend', onGestureEnd)
    return () => {
      observer.disconnect()
      forget('wheel', onWheel as EventListener)
      forget('gesturestart', onGestureStart)
      forget('gesturechange', onGestureChange)
      forget('gestureend', onGestureEnd)
    }
  }, [])

  useEffect(() => {
    if (tool !== 'polyline' && dragRef.current?.kind === 'polyline') {
      dragRef.current = null
      setDraft(null)
    }
  }, [tool])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === ' ') setSpace(true)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ') setSpace(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  useEffect(() => {
    drawRuler(hRuler.current, view, 'h')
    drawRuler(vRuler.current, view, 'v')
  }, [view, doc, viewport])

  const worldAt = (event: { clientX: number; clientY: number }): Point => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const point = svg.createSVGPoint()
    point.x = event.clientX
    point.y = event.clientY
    const matrix = svg.getScreenCTM()
    if (!matrix) return { x: 0, y: 0 }
    const mapped = point.matrixTransform(matrix.inverse())
    return { x: mapped.x, y: mapped.y }
  }

  const magnetAt = (
    point: Point,
    exclude: string[] = [],
    skip?: { pieceId: string; strokeId: string; index: number },
  ): { point: Point; kind: MagnetKind } => {
    const state = useEditor.getState()
    const threshold = 8 / state.view.zoom
    const snapped = snapMagnet(point, state.doc.pieces, state.grid, threshold, state.snap, {
      exclude: new Set(exclude),
      skipStrokeId: skip?.strokeId,
      skipNode: skip,
    })
    if (!state.snap || snapped.kind === 'vertex') return snapped
    const snappedDist = Math.hypot(snapped.point.x - point.x, snapped.point.y - point.y)
    let best: Point | null = null
    let bestDist = snapped.kind === 'free' ? threshold : snappedDist
    for (const measure of state.doc.measures ?? []) {
      for (const candidate of [measure.a, measure.b]) {
        const dist = Math.hypot(candidate.x - point.x, candidate.y - point.y)
        if (dist <= bestDist) {
          best = candidate
          bestDist = dist
        }
      }
    }
    return best ? { point: best, kind: 'vertex' } : snapped
  }

  const commitShape = (shape: Shape) => {
    const state = useEditor.getState()
    const targetId = state.selection.pieceIds.length === 1 ? state.selection.pieceIds[0] : null
    const piece = state.doc.pieces.find((item) => item.id === targetId)
    const local = piece ? intoLocal(normalizeShape(shape), piece) : normalizeShape(shape)
    state.addShape(local)
  }

  const finishPolyline = (points: Point[]) => {
    dragRef.current = null
    setDraft(null)
    if (points.length < 2) return
    const cleaned = points.filter((point, index) => index === 0 || Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) > 0.4)
    const closed =
      cleaned.length > 2 &&
      Math.hypot(cleaned[0].x - cleaned[cleaned.length - 1].x, cleaned[0].y - cleaned[cleaned.length - 1].y) <
        8 / useEditor.getState().view.zoom
    const unique = closed ? cleaned.slice(0, -1) : cleaned
    if (unique.length >= 2) commitShape({ kind: 'polyline', points: unique, closed })
  }

  const retargetMeasure = (drag: { kind: 'measure'; a: Point; b: Point; typed: string }): Drag => {
    const distance = typedLength(drag.typed)
    if (distance == null) return drag
    return { ...drag, b: pointAtDistance(drag.a, drag.b, distance) }
  }

  const commitMeasure = (drag: { a: Point; b: Point }) => {
    dragRef.current = null
    setDraft(null)
    useEditor.getState().addMeasure(drag.a, drag.b)
  }

  useEffect(() => {
    consume.current = (event) => {
      const drag = dragRef.current
      if (!drag) return false
      if (event.key === 'Escape') {
        dragRef.current = null
        setDraft(null)
        useEditor.getState().cancelGesture()
        return true
      }
      if (drag.kind === 'measure') {
        if (event.key === 'Enter') {
          event.preventDefault()
          commitMeasure(drag)
          return true
        }
        if (event.key === 'Backspace') {
          event.preventDefault()
          const next = retargetMeasure({ ...drag, typed: drag.typed.slice(0, -1) })
          dragRef.current = next
          setDraft(next)
          return true
        }
        if (/^[0-9.,]$/.test(event.key)) {
          event.preventDefault()
          const next = retargetMeasure({ ...drag, typed: drag.typed + event.key })
          dragRef.current = next
          setDraft(next)
          return true
        }
        return true
      }
      if (drag.kind === 'polyline' && (event.key === 'Enter' || event.key === 'Backspace')) {
        event.preventDefault()
        if (event.key === 'Backspace') {
          const points = drag.points.slice(0, -1)
          const next = points.length ? { ...drag, points } : null
          dragRef.current = next
          setDraft(next)
          return true
        }
        finishPolyline(drag.points)
        return true
      }
      return false
    }
  })

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button === 1 || space || useEditor.getState().tool === 'hand') {
      const viewNow = useEditor.getState().view
      const drag: Drag = { kind: 'pan', sx: event.clientX, sy: event.clientY, vx: viewNow.x, vy: viewNow.y }
      dragRef.current = drag
      setDraft(drag)
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    if (event.button !== 0) return
    const state = useEditor.getState()
    const raw = worldAt(event)
    const point = magnetAt(raw).point
    state.setCursor(point)
    const tolerance = 7 / state.view.zoom

    if (state.tool === 'polyline') {
      const current = dragRef.current
      if (current?.kind === 'polyline') {
        const first = current.points[0]
        const nearStart = current.points.length > 2 && Math.hypot(first.x - point.x, first.y - point.y) < tolerance
        const points = nearStart ? [...current.points, first] : [...current.points, point]
        if (nearStart) finishPolyline(points)
        else {
          const drag: Drag = { kind: 'polyline', points }
          dragRef.current = drag
          setDraft(drag)
        }
      } else {
        const drag: Drag = { kind: 'polyline', points: [point] }
        dragRef.current = drag
        setDraft(drag)
      }
      return
    }

    if (state.tool === 'tab') {
      const hit = hitStroke(state.doc, raw, tolerance)
      if (!hit) {
        state.setStatus('Haz clic sobre una arista.')
        return
      }
      const piece = state.doc.pieces.find((item) => item.id === hit.pieceId)
      const stroke = piece?.strokes.find((item) => item.id === hit.strokeId)
      const edgeIndex = piece && stroke ? hitEdge(stroke.shape, worldToLocal(piece, raw), stroke.role, tolerance) : null
      state.addTabOn(hit.pieceId, hit.strokeId, edgeIndex)
      return
    }
    if (state.tool === 'measure') {
      const drag: Drag = { kind: 'measure', a: point, b: point, typed: '' }
      dragRef.current = drag
      setDraft(drag)
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    if (state.tool === 'line') {
      const drag: Drag = { kind: 'line', a: point, b: point }
      dragRef.current = drag
      setDraft(drag)
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    if (isBoxTool(state.tool)) {
      const drag: Drag = { kind: 'box', kindShape: state.tool, a: point, b: point }
      dragRef.current = drag
      setDraft(drag)
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }

    const hit = hitStroke(state.doc, raw, tolerance)
    if (state.tool === 'node') {
      const selected = state.doc.pieces.find((piece) => piece.id === state.selection.pieceIds[0])
      const strokeId = state.selection.strokeId
      if (selected && strokeId) {
        const index = hitNode(selected, strokeId, raw, tolerance)
        if (index != null) {
          state.beginGesture()
          state.select([selected.id], strokeId, index)
          const drag: Drag = { kind: 'node', pieceId: selected.id, strokeId, index }
          dragRef.current = drag
          setDraft(drag)
          event.currentTarget.setPointerCapture(event.pointerId)
          return
        }
      }
      if (hit) {
        const piece = state.doc.pieces.find((item) => item.id === hit.pieceId)
        const stroke = piece?.strokes.find((item) => item.id === hit.strokeId)
        const edgeIndex =
          piece && stroke ? hitEdge(stroke.shape, worldToLocal(piece, raw), stroke.role, tolerance) : null
        state.select([hit.pieceId], hit.strokeId, null, edgeIndex)
        if (edgeIndex != null) state.setStatus('Tramo seleccionado. Márcalo como corte o como doblez.')
      } else state.clearSelection()
      return
    }

    if (hit && state.showImages && state.tool === 'select') {
      const piece = state.doc.pieces.find((item) => item.id === hit.pieceId)
      const image = piece?.image
      const handle = image && !image.hidden ? imageHandle(piece, raw, tolerance) : null
      if (piece && image && handle && (handle === 'scale' || hit.dist > tolerance * 0.55)) {
        state.beginGesture()
        state.select([piece.id], null, null)
        const drag: Drag =
          handle === 'scale'
            ? { kind: 'image-scale', pieceId: piece.id, aspect: image.width / Math.max(1, image.height) }
            : { kind: 'image-move', pieceId: piece.id, start: worldToLocal(piece, raw) }
        dragRef.current = drag
        setDraft(drag)
        event.currentTarget.setPointerCapture(event.pointerId)
        return
      }
    }

    const measureHit = state.tool === 'select' ? hitMeasure(state.doc.measures ?? [], raw, tolerance, state.view.zoom) : null
    if (measureHit && (!hit || measureHit.dist <= hit.dist)) {
      const current = state.selection.measureIds ?? []
      const next = event.shiftKey
        ? current.includes(measureHit.id)
          ? current.filter((id) => id !== measureHit.id)
          : [...current, measureHit.id]
        : [measureHit.id]
      state.select(event.shiftKey ? state.selection.pieceIds : [], event.shiftKey ? state.selection.strokeId : null, null, null, next)
      return
    }

    if (hit) {
      const ids = groupMates(state.doc, [hit.pieceId])
      const next = event.shiftKey
        ? toggleIds(state.selection.pieceIds, ids)
        : ids
      state.select(next, next.length === 1 ? hit.strokeId : null, null)
      state.beginGesture()
      const drag: Drag = { kind: 'move', start: point, ids: next }
      dragRef.current = drag
      setDraft(drag)
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }

    const additive = event.shiftKey
    if (!additive) state.clearSelection()
    const drag: Drag = {
      kind: 'marquee',
      a: raw,
      b: raw,
      additive,
      base: additive ? state.selection.pieceIds : [],
      baseMeasures: additive ? state.selection.measureIds ?? [] : [],
    }
    dragRef.current = drag
    setDraft(drag)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const raw = worldAt(event)
    const drag = dragRef.current
    const moving = drag && 'ids' in drag ? drag.ids : []
    const skip = drag?.kind === 'node' ? { pieceId: drag.pieceId, strokeId: drag.strokeId, index: drag.index } : undefined
    const hit = magnetAt(raw, moving, skip)
    setHover(hit.point)
    setMagnet(hit.kind)
    useEditor.getState().setCursor(hit.point)
    if (!drag) return
    if (drag.kind === 'pan') {
      const zoom = useEditor.getState().view.zoom
      useEditor.getState().setView({
        zoom,
        x: drag.vx - (event.clientX - drag.sx) / zoom,
        y: drag.vy - (event.clientY - drag.sy) / zoom,
      })
      return
    }
    if (drag.kind === 'move') {
      const dx = hit.point.x - drag.start.x
      const dy = hit.point.y - drag.start.y
      if (Math.hypot(dx, dy) < 0.2) return
      useEditor.getState().movePiecesBy(drag.ids, dx, dy)
      return
    }
    if (drag.kind === 'node') {
      const state = useEditor.getState()
      const piece = state.doc.pieces.find((item) => item.id === drag.pieceId)
      if (!piece) return
      const stroke = piece.strokes.find((item) => item.id === drag.strokeId)
      let nextPoint = hit.point
      if (state.snap && stroke && hit.kind !== 'vertex' && hit.kind !== 'stroke') {
        const neighbors = neighborNodes(stroke.shape, drag.index)
        const prev = neighbors.prev ? localToWorld(piece, neighbors.prev) : null
        const next = neighbors.next ? localToWorld(piece, neighbors.next) : null
        nextPoint = straightenJoint(prev, next, nextPoint, 2.5 / state.view.zoom)
      }
      state.setNode(drag.pieceId, drag.strokeId, drag.index, worldToLocal(piece, nextPoint))
      return
    }
    if (drag.kind === 'image-move' || drag.kind === 'image-scale') {
      const base = useEditor.getState().gestureBase
      const piece = base?.pieces.find((item) => item.id === drag.pieceId)
      if (!piece?.image) return
      const local = worldToLocal(piece, raw)
      let image: PieceImage = piece.image
      if (drag.kind === 'image-move') {
        image = { ...piece.image, x: piece.image.x + local.x - drag.start.x, y: piece.image.y + local.y - drag.start.y }
      } else {
        const width = Math.max(8, local.x - piece.image.x)
        image = { ...piece.image, width, height: width / drag.aspect }
      }
      useEditor.getState().patchImage(piece.id, image)
      return
    }
    if (drag.kind === 'marquee') {
      const next = { ...drag, b: raw }
      dragRef.current = next
      setDraft(next)
      return
    }
    if (drag.kind === 'line' || drag.kind === 'box' || drag.kind === 'measure') {
      const next = drag.kind === 'measure' ? retargetMeasure({ ...drag, b: hit.point }) : { ...drag, b: hit.point }
      dragRef.current = next
      setDraft(next)
      if (next.kind === 'measure') {
        const length = Math.hypot(next.b.x - next.a.x, next.b.y - next.a.y)
        useEditor.getState().setStatus(next.typed ? `${next.typed} mm` : formatLength(length))
      }
    }
  }

  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag || drag.kind === 'polyline') return
    dragRef.current = null
    setDraft(null)
    const state = useEditor.getState()
    if (drag.kind === 'pan') return
    if (drag.kind === 'node') {
      if (state.gestureDirty && state.gestureBase) {
        let joined = 0
        const piece = state.doc.pieces.find((item) => item.id === drag.pieceId)
        const stroke = piece?.strokes.find((item) => item.id === drag.strokeId)
        const basePiece = state.gestureBase.pieces.find((item) => item.id === drag.pieceId)
        if (piece && stroke && basePiece && isOpenEnd(stroke.shape, drag.index)) {
          const origin = nodeWorld(basePiece, drag.strokeId, drag.index)
          const end = drag.index === 0 ? 'start' : 'end'
          if (origin) {
            const welded = weldOpenStroke(state.doc, drag.pieceId, drag.strokeId, { end, origin })
            if (welded.joined > 0) {
              useEditor.setState({ doc: welded.doc })
              joined = welded.joined
            }
          }
        }
        const latest = useEditor.getState().doc
        const finished = finishStroke(latest, drag.pieceId, drag.strokeId)
        if (joined > 0 || finished.split > 0 || finished.merged > 0 || finished.doc !== latest) {
          const status =
            finished.split > 0
              ? 'La línea partió la figura en dos.'
              : joined > 0 || finished.merged > 0
                ? 'Los trazos quedaron en uno solo.'
                : 'Esa arista quedó en una sola línea.'
          useEditor.setState({ doc: finished.doc, status })
        }
      }
      useEditor.getState().endGesture()
      return
    }
    if (drag.kind === 'move' || drag.kind === 'image-move' || drag.kind === 'image-scale') {
      state.endGesture()
      return
    }
    if (drag.kind === 'measure') {
      commitMeasure(drag)
      return
    }
    if (drag.kind === 'line') {
      if (Math.hypot(drag.b.x - drag.a.x, drag.b.y - drag.a.y) >= 1) commitShape({ kind: 'line', a: drag.a, b: drag.b })
      return
    }
    if (drag.kind === 'box') {
      const shape = shapeFromBox(drag.kindShape, drag.a, drag.b)
      if (shape) commitShape(shape)
      return
    }
    if (drag.kind === 'marquee') {
      const x = Math.min(drag.a.x, drag.b.x)
      const y = Math.min(drag.a.y, drag.b.y)
      const width = Math.abs(drag.b.x - drag.a.x)
      const height = Math.abs(drag.b.y - drag.a.y)
      const ids = state.doc.pieces
        .filter((piece) => intersects(piece, x, y, width, height))
        .map((piece) => piece.id)
      const pieceIds = drag.additive ? [...new Set([...drag.base, ...ids])] : ids
      const inside = (point: Point) => point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height
      const found = (state.doc.measures ?? []).filter((measure) => inside(measure.a) || inside(measure.b)).map((measure) => measure.id)
      const measureIds = drag.additive ? [...new Set([...drag.baseMeasures, ...found])] : found
      state.select(pieceIds, null, null, null, measureIds)
    }
    void event
  }

  const onDoubleClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    const state = useEditor.getState()
    const drag = dragRef.current
    if (drag?.kind === 'polyline') {
      finishPolyline(drag.points)
      return
    }
    if (state.tool !== 'node' || !state.selection.strokeId || state.selection.pieceIds.length !== 1) return
    const piece = state.doc.pieces.find((item) => item.id === state.selection.pieceIds[0])
    const stroke = piece?.strokes.find((item) => item.id === state.selection.strokeId)
    if (!piece || !stroke || stroke.shape.kind !== 'polyline') return
    const local = worldToLocal(piece, worldAt(event))
    const inserted = insertOnPolyline(stroke.shape, local)
    if (!inserted) return
    state.replaceShape(piece.id, stroke.id, inserted.shape)
    state.select([piece.id], stroke.id, inserted.index)
  }

  const selected = new Set(selection.pieceIds)
  const cursor = tool === 'hand' || space ? 'grab' : tool === 'select' ? 'default' : 'crosshair'

  return (
    <div className="stage">
      <div className="ruler-corner">mm</div>
      <canvas ref={hRuler} className="ruler ruler-h" />
      <canvas ref={vRuler} className="ruler ruler-v" />
      <svg
        ref={svgRef}
        className="sheet"
        style={{ cursor }}
        viewBox={`${view.x} ${view.y} ${Math.max(viewport.w, 1) / view.zoom} ${Math.max(viewport.h, 1) / view.zoom}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={(event) => event.preventDefault()}
      >
        <rect
          x={view.x}
          y={view.y}
          width={Math.max(viewport.w, 1) / view.zoom}
          height={Math.max(viewport.h, 1) / view.zoom}
          fill="transparent"
          pointerEvents="all"
        />
        <Grid view={view} width={viewport.w} height={viewport.h} grid={grid} />
        {doc.pieces.map((piece) => {
          const box = pieceLocalBBox(piece)
          const outline = largestCutOutline(piece)
          const active = selected.has(piece.id)
          return (
            <g key={piece.id} transform={`translate(${piece.x} ${piece.y}) rotate(${piece.rotation})`}>
              {showImages && piece.image && !piece.image.hidden && outline && (
                <>
                  <clipPath id={`clip-${piece.id}`}>
                    <ShapeView shape={outline} stroke="none" width={0} fill="#000" />
                  </clipPath>
                  <image
                    href={piece.image.href}
                    x={piece.image.x}
                    y={piece.image.y}
                    width={piece.image.width}
                    height={piece.image.height}
                    clipPath={`url(#clip-${piece.id})`}
                    opacity={0.92}
                  />
                </>
              )}
              {piece.strokes.map((item) => (
                <StrokePaint key={item.id} shape={item.shape} role={item.role} active={active && item.id === selection.strokeId} />
              ))}
              <FoldMarks piece={piece} zoom={view.zoom} />
              {active && selection.strokeId && selection.segmentIndex != null && (
                <SegmentMark piece={piece} strokeId={selection.strokeId} index={selection.segmentIndex} />
              )}
              {active && box && (
                <rect
                  x={box.x}
                  y={box.y}
                  width={box.width}
                  height={box.height}
                  fill="none"
                  stroke="#b8431f"
                  strokeDasharray="5 3"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {active && showImages && piece.image && !piece.image.hidden && (
                <rect
                  x={piece.image.x + piece.image.width - 4 / view.zoom}
                  y={piece.image.y + piece.image.height - 4 / view.zoom}
                  width={8 / view.zoom}
                  height={8 / view.zoom}
                  fill="#b8431f"
                />
              )}
              {tool === 'node' && active && selection.strokeId && piece.strokes.some((item) => item.id === selection.strokeId) && (
                <NodeHandles pieceId={piece.id} strokeId={selection.strokeId} nodeIndex={selection.nodeIndex} zoom={view.zoom} />
              )}
            </g>
          )
        })}
        {(doc.measures ?? []).map((measure) => (
          <MeasureMark
            key={measure.id}
            a={measure.a}
            b={measure.b}
            zoom={view.zoom}
            selected={(selection.measureIds ?? []).includes(measure.id)}
          />
        ))}
        {draft?.kind === 'measure' && <MeasureMark a={draft.a} b={draft.b} zoom={view.zoom} selected live />}
        <DraftShape draft={draft} cursor={hover} />
        {hover && magnet !== 'free' && tool !== 'select' && tool !== 'hand' && !space && (
          <circle
            cx={hover.x}
            cy={hover.y}
            r={(magnet === 'vertex' ? 4.5 : 2.4) / view.zoom}
            fill={magnet === 'vertex' ? 'none' : '#b8431f'}
            stroke="#b8431f"
            strokeWidth={1.4}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {draft?.kind === 'marquee' && (
          <rect
            x={Math.min(draft.a.x, draft.b.x)}
            y={Math.min(draft.a.y, draft.b.y)}
            width={Math.abs(draft.b.x - draft.a.x)}
            height={Math.abs(draft.b.y - draft.a.y)}
            fill="rgba(184, 67, 31, 0.08)"
            stroke="#b8431f"
            strokeDasharray="4 2"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
    </div>
  )
}

function hitEdge(shape: Shape, local: Point, role: Role, tolerance: number): number | null {
  const edges = shapeEdges(shape, role)
  if (!edges) return null
  let best = tolerance
  let index: number | null = null
  edges.forEach((edge, i) => {
    const dist = distToSegment(local, edge.a, edge.b)
    if (dist <= best) {
      best = dist
      index = i
    }
  })
  return index
}

function FoldMarks({ piece, zoom }: { piece: Piece; zoom: number }) {
  const marks: { key: string; x: number; y: number; len: number }[] = []
  for (const item of piece.strokes) {
    const edges = shapeEdges(item.shape, item.role)
    if (edges) {
      edges.forEach((edge, index) => {
        if (edge.role !== 'crease') return
        marks.push({
          key: `${item.id}-${index}`,
          x: (edge.a.x + edge.b.x) / 2,
          y: (edge.a.y + edge.b.y) / 2,
          len: Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y),
        })
      })
    } else if (item.role === 'crease') {
      const box = shapeBBox(item.shape)
      if (box) {
        marks.push({
          key: item.id,
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
          len: Math.max(box.width, box.height),
        })
      }
    }
  }
  const size = 7 / zoom
  return (
    <>
      {marks.map((mark) => (
        <g key={mark.key}>
          <rect
            x={mark.x - size / 2}
            y={mark.y - size / 2}
            width={size}
            height={size}
            transform={`rotate(45 ${mark.x} ${mark.y})`}
            fill="#1d4f91"
          />
          {zoom > 0.42 && mark.len * zoom > 36 && (
            <text x={mark.x + size} y={mark.y - size} fontSize={11 / zoom} fill="#1d4f91">
              Doblez
            </text>
          )}
        </g>
      ))}
    </>
  )
}

function SegmentMark({ piece, strokeId, index }: { piece: Piece; strokeId: string; index: number }) {
  const stroke = piece.strokes.find((item) => item.id === strokeId)
  const edge = stroke ? shapeEdges(stroke.shape, stroke.role)?.[index] : undefined
  if (!edge) return null
  return (
    <line
      x1={edge.a.x}
      y1={edge.a.y}
      x2={edge.b.x}
      y2={edge.b.y}
      stroke="#b8431f"
      strokeWidth={2.6}
      strokeDasharray={edge.role === 'crease' ? '4 2.2' : undefined}
      vectorEffect="non-scaling-stroke"
    />
  )
}

function NodeHandles({
  pieceId,
  strokeId,
  nodeIndex,
  zoom,
}: {
  pieceId: string
  strokeId: string
  nodeIndex: number | null
  zoom: number
}) {
  const piece = useEditor((s) => s.doc.pieces.find((item) => item.id === pieceId))
  const stroke = piece?.strokes.find((item) => item.id === strokeId)
  if (!stroke) return null
  const size = 8 / zoom
  return (
    <>
      {shapeNodes(stroke.shape).map((node, index) => (
        <rect
          key={index}
          x={node.x - size / 2}
          y={node.y - size / 2}
          width={size}
          height={size}
          fill={nodeIndex === index ? '#b8431f' : '#fffaf4'}
          stroke="#b8431f"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </>
  )
}

function MeasureMark({ a, b, zoom, selected, live = false }: { a: Point; b: Point; zoom: number; selected: boolean; live?: boolean }) {
  const layout = dimensionLayout(a, b, zoom)
  if (!layout) return null
  const color = selected || live ? '#b8431f' : '#8a6232'
  const label = formatLength(layout.length)
  const font = 11 / zoom
  const width = Math.max(font * 2.4, label.length * font * 0.62)
  const height = font * 1.4
  const tick = 4 / zoom
  const dx = layout.b2.x - layout.a2.x
  const dy = layout.b2.y - layout.a2.y
  const len = Math.hypot(dx, dy) || 1
  const px = (-dy / len) * tick
  const py = (dx / len) * tick
  return (
    <g>
      <line x1={layout.a.x} y1={layout.a.y} x2={layout.a2.x} y2={layout.a2.y} stroke={color} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <line x1={layout.b.x} y1={layout.b.y} x2={layout.b2.x} y2={layout.b2.y} stroke={color} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <line x1={layout.a2.x} y1={layout.a2.y} x2={layout.b2.x} y2={layout.b2.y} stroke={color} strokeWidth={1.2} strokeDasharray="4 2.5" vectorEffect="non-scaling-stroke" />
      <line x1={layout.a2.x - px} y1={layout.a2.y - py} x2={layout.a2.x + px} y2={layout.a2.y + py} stroke={color} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
      <line x1={layout.b2.x - px} y1={layout.b2.y - py} x2={layout.b2.x + px} y2={layout.b2.y + py} stroke={color} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
      <g transform={`translate(${layout.mid.x} ${layout.mid.y}) rotate(${layout.angle})`}>
        <rect x={-width / 2} y={-height - font * 0.2} width={width} height={height} rx={3 / zoom} fill="#fbfaf7" stroke={color} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <text x={0} y={-height / 2 - font * 0.2} textAnchor="middle" dominantBaseline="middle" fontSize={font} fill={color}>
          {label}
        </text>
      </g>
    </g>
  )
}

function DraftShape({ draft, cursor }: { draft: Drag | null; cursor: Point | null }) {
  if (!draft) return null
  if (draft.kind === 'line') return <ShapeView shape={{ kind: 'line', a: draft.a, b: draft.b }} stroke="#b8431f" width={1.2} />
  if (draft.kind === 'box') {
    const shape = shapeFromBox(draft.kindShape, draft.a, draft.b)
    return shape ? <ShapeView shape={shape} stroke="#b8431f" width={1.2} /> : null
  }
  if (draft.kind === 'polyline') {
    const points = cursor ? [...draft.points, cursor] : draft.points
    if (points.length < 2) return null
    return <ShapeView shape={{ kind: 'polyline', points, closed: false }} stroke="#b8431f" width={1.2} />
  }
  return null
}

const GRID_STEPS = [1, 5, 10, 50, 100, 500, 1000]
const MAT = 300

function gridStep(zoom: number, minimumPx: number): number {
  return GRID_STEPS.find((step) => step * zoom >= minimumPx) ?? GRID_STEPS[GRID_STEPS.length - 1]
}

function Grid({
  view,
  width,
  height,
}: {
  view: { x: number; y: number; zoom: number }
  width: number
  height: number
  grid: number
}) {
  const step = gridStep(view.zoom, 7)
  const spanX = width / view.zoom
  const spanY = height / view.zoom
  const x0 = Math.floor(view.x / step) * step
  const y0 = Math.floor(view.y / step) * step
  const majorEvery = step * 10
  const lines: { x1: number; y1: number; x2: number; y2: number; major: boolean }[] = []
  for (let x = x0; x <= view.x + spanX; x += step) {
    lines.push({ x1: x, y1: view.y, x2: x, y2: view.y + spanY, major: Math.abs(x % majorEvery) < step * 0.5 })
  }
  for (let y = y0; y <= view.y + spanY; y += step) {
    lines.push({ x1: view.x, y1: y, x2: view.x + spanX, y2: y, major: Math.abs(y % majorEvery) < step * 0.5 })
  }
  const matX0 = Math.floor(view.x / MAT) * MAT
  const matY0 = Math.floor(view.y / MAT) * MAT
  const matXs: number[] = []
  const matYs: number[] = []
  for (let x = matX0; x <= view.x + spanX; x += MAT) matXs.push(x)
  for (let y = matY0; y <= view.y + spanY; y += MAT) matYs.push(y)
  const mats: { x: number; y: number }[] = []
  for (let i = 0; i < matXs.length - 1; i++) {
    for (let j = 0; j < matYs.length - 1; j++) mats.push({ x: matXs[i], y: matYs[j] })
  }
  const font = 13 / view.zoom
  const showLabel = MAT * view.zoom >= 72
  const showFill = mats.length <= 48
  return (
    <g pointerEvents="none">
      {showFill &&
        mats.map((mat) => (
          <rect
            key={`${mat.x}-${mat.y}`}
            x={mat.x}
            y={mat.y}
            width={MAT}
            height={MAT}
            fill={((mat.x / MAT + mat.y / MAT) & 1) === 0 ? 'rgba(90, 122, 96, 0.045)' : 'rgba(90, 122, 96, 0.015)'}
          />
        ))}
      {lines.map((line, index) => (
        <line
          key={index}
          x1={line.x1}
          y1={line.y1}
          x2={line.x2}
          y2={line.y2}
          stroke={line.major ? '#ddd4c6' : '#eee8de'}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {matXs.map((x) => (
        <line key={`mx-${x}`} x1={x} y1={view.y} x2={x} y2={view.y + spanY} stroke="#6d8a74" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
      ))}
      {matYs.map((y) => (
        <line key={`my-${y}`} x1={view.x} y1={y} x2={view.x + spanX} y2={y} stroke="#6d8a74" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
      ))}
      {showLabel &&
        mats.map((mat) => {
          const x0 = Math.max(mat.x, view.x)
          const y0 = Math.max(mat.y, view.y)
          const x1 = Math.min(mat.x + MAT, view.x + spanX)
          const y1 = Math.min(mat.y + MAT, view.y + spanY)
          if ((x1 - x0) * view.zoom < 96 || (y1 - y0) * view.zoom < 22) return null
          return (
            <text key={`label-${mat.x}-${mat.y}`} x={x0 + 8} y={y0 + font} fill="#5f7a66" fontSize={font}>
              30 × 30 cm
            </text>
          )
        })}
    </g>
  )
}

function drawRuler(
  canvas: HTMLCanvasElement | null,
  view: { x: number; y: number; zoom: number },
  axis: 'h' | 'v',
) {
  if (!canvas) return
  const dpr = window.devicePixelRatio || 1
  const cssW = canvas.clientWidth
  const cssH = canvas.clientHeight
  if (cssW < 2 || cssH < 2) return
  canvas.width = Math.floor(cssW * dpr)
  canvas.height = Math.floor(cssH * dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = '#f6f2ea'
  ctx.fillRect(0, 0, cssW, cssH)
  ctx.strokeStyle = '#cfc6b8'
  ctx.beginPath()
  if (axis === 'h') {
    ctx.moveTo(0, cssH - 0.5)
    ctx.lineTo(cssW, cssH - 0.5)
  } else {
    ctx.moveTo(cssW - 0.5, 0)
    ctx.lineTo(cssW - 0.5, cssH)
  }
  ctx.stroke()
  const span = (axis === 'h' ? cssW : cssH) / view.zoom
  const step = gridStep(view.zoom, 36)
  const start = Math.floor((axis === 'h' ? view.x : view.y) / step) * step
  const origin = axis === 'h' ? view.x : view.y
  ctx.fillStyle = '#6f685e'
  ctx.font = '10px "Avenir Next", sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  for (let value = start; value < origin + span; value += step) {
    const pos = (value - origin) * view.zoom
    ctx.strokeStyle = '#b7ad9f'
    ctx.beginPath()
    if (axis === 'h') {
      ctx.moveTo(pos, 14)
      ctx.lineTo(pos, 22)
      ctx.stroke()
      ctx.fillText(String(Math.round(value)), pos + 3, 2)
    } else {
      ctx.moveTo(16, pos)
      ctx.lineTo(28, pos)
      ctx.stroke()
      ctx.save()
      ctx.translate(2, pos + 3)
      ctx.rotate(-Math.PI / 2)
      ctx.fillText(String(Math.round(value)), 0, 0)
      ctx.restore()
    }
  }
}

function toggleIds(current: string[], ids: string[]): string[] {
  const set = new Set(current)
  const allIn = ids.every((id) => set.has(id))
  for (const id of ids) {
    if (allIn) set.delete(id)
    else set.add(id)
  }
  return [...set]
}

function intersects(piece: Piece, x: number, y: number, width: number, height: number): boolean {
  const box = pieceLocalBBox(piece)
  if (!box) return false
  const corners = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ].map((point) => {
    const rad = (piece.rotation * Math.PI) / 180
    const c = Math.cos(rad)
    const s = Math.sin(rad)
    return { x: point.x * c - point.y * s + piece.x, y: point.x * s + point.y * c + piece.y }
  })
  const minX = Math.min(...corners.map((p) => p.x))
  const maxX = Math.max(...corners.map((p) => p.x))
  const minY = Math.min(...corners.map((p) => p.y))
  const maxY = Math.max(...corners.map((p) => p.y))
  return minX < x + width && maxX > x && minY < y + height && maxY > y
}
