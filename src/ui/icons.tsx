import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Key } from './Key.tsx'

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  )
}

function poly(sides: number, radius = 8): string {
  return (
    Array.from({ length: sides }, (_, index) => {
      const angle = -Math.PI / 2 + (index * 2 * Math.PI) / sides
      const x = 12 + radius * Math.cos(angle)
      const y = 12 + radius * Math.sin(angle)
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`
    }).join(' ') + 'Z'
  )
}

function star(): string {
  return (
    Array.from({ length: 10 }, (_, index) => {
      const radius = index % 2 === 0 ? 8.2 : 3.5
      const angle = -Math.PI / 2 + (index * Math.PI) / 5
      const x = 12 + radius * Math.cos(angle)
      const y = 12 + radius * Math.sin(angle)
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`
    }).join(' ') + 'Z'
  )
}

export const icons = {
  select: (
    <Glyph>
      <path d="M5 4 L5 18.5 L9.2 14.4 L12.3 20.2 L15 18.9 L11.8 13.2 L17.4 12.6 Z" fill="currentColor" stroke="none" />
    </Glyph>
  ),
  node: (
    <Glyph>
      <path d="M5 16 L12 7 L19 15" />
      <rect x="3.2" y="14.2" width="3.6" height="3.6" fill="currentColor" stroke="none" />
      <rect x="10.2" y="5.2" width="3.6" height="3.6" fill="currentColor" stroke="none" />
      <rect x="17.2" y="13.2" width="3.6" height="3.6" fill="currentColor" stroke="none" />
    </Glyph>
  ),
  hand: (
    <Glyph>
      <path d="M8 11 V7.2 a1.6 1.6 0 0 1 3.2 0 V11 M11.2 10.2 V5.6 a1.6 1.6 0 0 1 3.2 0 V12 M14.4 11 V7.4 a1.6 1.6 0 0 1 3.2 0 V14.2 c0 3.4-2.1 5.8-6.4 5.8-3.6 0-5.8-2-5.8-5.2 V10.2 a1.6 1.6 0 0 1 3.2 0" />
    </Glyph>
  ),
  line: (
    <Glyph>
      <path d="M5 19 L19 5" />
    </Glyph>
  ),
  polyline: (
    <Glyph>
      <path d="M4 16 L9 8 L14 14 L20 6" />
      <circle cx="4" cy="16" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="9" cy="8" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="14" cy="14" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="20" cy="6" r="1.3" fill="currentColor" stroke="none" />
    </Glyph>
  ),
  measure: (
    <Glyph>
      <path d="M4 10 H20 V16 H4 Z" />
      <path d="M8 10 V13 M12 10 V14.2 M16 10 V13" />
    </Glyph>
  ),
  tab: (
    <Glyph>
      <path d="M3 8 H12 V19 H3 Z" />
      <path d="M12 10 L18 12 V16 L12 18" strokeDasharray="1.6 1.2" />
    </Glyph>
  ),
  rect: (
    <Glyph>
      <rect x="4" y="6" width="16" height="12" />
    </Glyph>
  ),
  square: (
    <Glyph>
      <rect x="5" y="5" width="14" height="14" />
    </Glyph>
  ),
  roundRect: (
    <Glyph>
      <rect x="4" y="6" width="16" height="12" rx="3" />
    </Glyph>
  ),
  triangle: (
    <Glyph>
      <path d="M12 4.5 L20 19 H4 Z" />
    </Glyph>
  ),
  rightTriangle: (
    <Glyph>
      <path d="M6 5 V19 H20 Z" />
    </Glyph>
  ),
  rhombus: (
    <Glyph>
      <path d="M12 3.5 L20.5 12 L12 20.5 L3.5 12 Z" />
    </Glyph>
  ),
  parallelogram: (
    <Glyph>
      <path d="M8 6 H20 L16 18 H4 Z" />
    </Glyph>
  ),
  trapezoid: (
    <Glyph>
      <path d="M7 6 H17 L21 18 H3 Z" />
    </Glyph>
  ),
  kite: (
    <Glyph>
      <path d="M12 3 L20 10 L12 21 L4 10 Z" />
    </Glyph>
  ),
  pentagon: (
    <Glyph>
      <path d={poly(5)} />
    </Glyph>
  ),
  hexagon: (
    <Glyph>
      <path d={poly(6, 8)} />
    </Glyph>
  ),
  octagon: (
    <Glyph>
      <path d={poly(8, 8)} />
    </Glyph>
  ),
  ellipse: (
    <Glyph>
      <ellipse cx="12" cy="12" rx="8" ry="5.5" />
    </Glyph>
  ),
  circle: (
    <Glyph>
      <circle cx="12" cy="12" r="7.5" />
    </Glyph>
  ),
  semicircle: (
    <Glyph>
      <path d="M4.5 15 A7.5 7.5 0 0 1 19.5 15 Z" />
    </Glyph>
  ),
  arc: (
    <Glyph>
      <path d="M5 16 A8 8 0 0 1 19 10" />
    </Glyph>
  ),
  star: (
    <Glyph>
      <path d={star()} />
    </Glyph>
  ),
  cross: (
    <Glyph>
      <path d="M9 4 H15 V9 H20 V15 H15 V20 H9 V15 H4 V9 H9 Z" />
    </Glyph>
  ),
  cut: (
    <Glyph>
      <path d="M4 12 H20" strokeWidth="2.4" />
    </Glyph>
  ),
  crease: (
    <Glyph>
      <path d="M4 12 H20" strokeDasharray="3.2 2.2" strokeWidth="2.2" />
    </Glyph>
  ),
  magnet: (
    <Glyph>
      <path d="M8 13 V8.5 a4 4 0 0 1 8 0 V13" />
      <path d="M8 13 V18 M16 13 V18" strokeWidth="2.4" />
    </Glyph>
  ),
  image: (
    <Glyph>
      <rect x="3.5" y="5" width="17" height="14" rx="1.5" />
      <circle cx="8.5" cy="9.5" r="1.4" fill="currentColor" stroke="none" />
      <path d="M4 16.5 L9 12 L12.5 15 L15.5 12.5 L20 16.5" />
    </Glyph>
  ),
  undo: (
    <Glyph>
      <path d="M8 8 H15 A5 5 0 1 1 15 18 H11" />
      <path d="M8 8 L11.5 4.8 M8 8 L11.5 11.2" />
    </Glyph>
  ),
  redo: (
    <Glyph>
      <path d="M16 8 H9 A5 5 0 1 0 9 18 H13" />
      <path d="M16 8 L12.5 4.8 M16 8 L12.5 11.2" />
    </Glyph>
  ),
  fit: (
    <Glyph>
      <path d="M9 4 H4 V9 M15 4 H20 V9 M20 15 V20 H15 M9 20 H4 V15" />
    </Glyph>
  ),
  open: (
    <Glyph>
      <path d="M3 8 H9 L11 10 H21 V19 H3 Z" />
    </Glyph>
  ),
  save: (
    <Glyph>
      <path d="M5 3 H16 L21 8 V21 H5 Z" />
      <path d="M8 3 V8 H15" />
      <path d="M8 14 H16 V21 H8 Z" />
    </Glyph>
  ),
  import: (
    <Glyph>
      <path d="M12 4 V14" />
      <path d="M8 11 L12 15 L16 11" />
      <path d="M5 19 H19" />
    </Glyph>
  ),
  svg: (
    <Glyph>
      <path d="M6 4 H14 L18 8 V20 H6 Z" />
      <path d="M14 4 V8 H18" />
      <path d="M9 13 H15 M9 16 H13" />
    </Glyph>
  ),
  pdf: (
    <Glyph>
      <path d="M6 3 H14 L19 8 V21 H6 Z" />
      <path d="M14 3 V8 H19" />
      <path d="M8.5 16.5 V12.5 H11 a1.6 1.6 0 0 1 0 3.2 H8.5" />
    </Glyph>
  ),
  union: (
    <Glyph>
      <circle cx="9" cy="12" r="5.5" />
      <circle cx="15" cy="12" r="5.5" />
    </Glyph>
  ),
  intersect: (
    <Glyph>
      <path d="M10.2 7.2 A5.5 5.5 0 0 1 10.2 16.8 A5.5 5.5 0 0 1 10.2 7.2 Z" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="5.5" />
      <circle cx="15" cy="12" r="5.5" />
    </Glyph>
  ),
  subtract: (
    <Glyph>
      <path d="M9 6.5 A5.5 5.5 0 0 0 9 17.5 A5.5 5.5 0 0 1 9 6.5 Z" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="5.5" />
      <circle cx="15" cy="12" r="5.5" />
    </Glyph>
  ),
  exclude: (
    <Glyph>
      <circle cx="9" cy="12" r="5.5" strokeDasharray="2.2 1.6" />
      <circle cx="15" cy="12" r="5.5" />
    </Glyph>
  ),
  divide: (
    <Glyph>
      <circle cx="12" cy="12" r="7" />
      <path d="M5 16 L19 8" />
    </Glyph>
  ),
  alignEdges: (
    <Glyph>
      <path d="M4 8 H14 M7 16 H20" />
      <path d="M14 5 V11 M14 8 H18" />
    </Glyph>
  ),
  width: (
    <Glyph>
      <path d="M4 12 H20" />
      <path d="M8 8 L4 12 L8 16 M16 8 L20 12 L16 16" />
    </Glyph>
  ),
  height: (
    <Glyph>
      <path d="M12 4 V20" />
      <path d="M8 8 L12 4 L16 8 M8 16 L12 20 L16 16" />
    </Glyph>
  ),
  both: (
    <Glyph>
      <path d="M8 16 V8 H16" />
      <path d="M8 12 L8 8 L12 8 M12 16 L16 16 L16 12" />
    </Glyph>
  ),
  alignLeft: (
    <Glyph>
      <path d="M5 4 V20 M9 8 H18 M9 12 H14 M9 16 H18" />
    </Glyph>
  ),
  alignCenter: (
    <Glyph>
      <path d="M12 4 V20 M6 8 H18 M8 12 H16 M6 16 H18" />
    </Glyph>
  ),
  alignRight: (
    <Glyph>
      <path d="M19 4 V20 M6 8 H15 M10 12 H15 M6 16 H15" />
    </Glyph>
  ),
  alignTop: (
    <Glyph>
      <path d="M4 5 H20 M8 9 V18 M12 9 V14 M16 9 V18" />
    </Glyph>
  ),
  alignMiddle: (
    <Glyph>
      <path d="M4 12 H20 M8 6 V18 M12 8 V16 M16 6 V18" />
    </Glyph>
  ),
  alignBottom: (
    <Glyph>
      <path d="M4 19 H20 M8 6 V15 M12 10 V15 M16 6 V15" />
    </Glyph>
  ),
  distributeH: (
    <Glyph>
      <path d="M4 5 V19 M12 7 V17 M20 5 V19" />
    </Glyph>
  ),
  distributeV: (
    <Glyph>
      <path d="M5 4 H19 M7 12 H17 M5 20 H19" />
    </Glyph>
  ),
  mirrorH: (
    <Glyph>
      <path d="M12 4 V20" strokeDasharray="2 1.6" />
      <path d="M10 8 L5 12 L10 16 Z M14 8 L19 12 L14 16 Z" />
    </Glyph>
  ),
  mirrorV: (
    <Glyph>
      <path d="M4 12 H20" strokeDasharray="2 1.6" />
      <path d="M8 10 L12 5 L16 10 Z M8 14 L12 19 L16 14 Z" />
    </Glyph>
  ),
  rotate: (
    <Glyph>
      <path d="M19 12 A7 7 0 1 1 15 6" />
      <path d="M15 3 V7 H19" />
    </Glyph>
  ),
  group: (
    <Glyph>
      <rect x="3.5" y="3.5" width="17" height="17" strokeDasharray="2.4 1.8" />
      <rect x="7" y="7" width="4.5" height="4.5" />
      <rect x="12.5" y="12.5" width="4.5" height="4.5" />
    </Glyph>
  ),
  ungroup: (
    <Glyph>
      <path d="M3.5 8 V3.5 H8 M16 3.5 H20.5 V8 M20.5 16 V20.5 H16 M8 20.5 H3.5 V16" />
      <rect x="7" y="7" width="4.5" height="4.5" />
      <rect x="12.5" y="12.5" width="4.5" height="4.5" />
    </Glyph>
  ),
  unite: (
    <Glyph>
      <path d="M4 8 H12 V4 H20 V16 H12 V20 H4 Z" />
    </Glyph>
  ),
  weld: (
    <Glyph>
      <path d="M3 16 H10 L14 8 H21" />
      <circle cx="10" cy="16" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="14" cy="8" r="1.4" fill="currentColor" stroke="none" />
    </Glyph>
  ),
  duplicate: (
    <Glyph>
      <rect x="7" y="7" width="12" height="12" />
      <path d="M5 15 V5 H15" />
    </Glyph>
  ),
  trash: (
    <Glyph>
      <path d="M5 7 H19 M9 7 V5 H15 V7 M7.5 7 L8.5 19 H15.5 L16.5 7" />
    </Glyph>
  ),
}

const helpText: Record<string, string> = {
  Mover: 'Selecciona y mueve piezas. Arrastra en vacío para marcar varias.',
  Nodos: 'Mueve los vértices de un trazo. Clic en un tramo para marcarlo como corte o doblez.',
  Mano: 'Arrastra el lienzo para desplazarte sin mover las piezas.',
  Línea: 'Dibuja un trazo recto. Puede empezar y terminar en un vértice.',
  Polilínea: 'Encadena varios segmentos. Enter lo termina; clic en el inicio lo cierra.',
  Medir: 'Mide la distancia entre dos puntos y la deja como referencia. Escribe el largo y pulsa Enter para fijarlo. Supr borra la cota.',
  Pestaña: 'Crea una pestaña en trapecio sobre toda la arista. El lado de afuera es más corto y el borde compartido pasa a doblez.',
  Rectángulo: 'Dibuja un rectángulo arrastrando de una esquina a la otra.',
  Cuadrado: 'Dibuja un cuadrado: los cuatro lados quedan iguales.',
  Redondeado: 'Dibuja un rectángulo con las esquinas redondeadas.',
  Triángulo: 'Dibuja un triángulo con la punta hacia arriba.',
  'Triángulo recto': 'Dibuja un triángulo con el ángulo recto abajo a la izquierda.',
  Rombo: 'Dibuja un rombo de cuatro lados iguales.',
  Romboide: 'Dibuja un paralelogramo inclinado.',
  Trapecio: 'Dibuja un trapecio con las dos bases paralelas.',
  Deltoide: 'Dibuja una cometa de cuatro lados.',
  Pentágono: 'Dibuja un pentágono regular.',
  Hexágono: 'Dibuja un hexágono regular.',
  Octágono: 'Dibuja un octágono regular.',
  Elipse: 'Dibuja un óvalo.',
  Círculo: 'Dibuja un círculo de radio igual en ambos ejes.',
  Semicírculo: 'Dibuja medio círculo cerrado por el diámetro.',
  Arco: 'Dibuja una curva abierta.',
  Estrella: 'Dibuja una estrella de cinco puntas.',
  Cruz: 'Dibuja una cruz de brazos iguales.',
  Corte: 'Los trazos nuevos se cortan.',
  Doblez: 'Los trazos nuevos solo se doblan y no se cortan.',
  Imán: 'Pega el trazo a una guía, a un trazo ya hecho o a un vértice.',
  Imágenes: 'Muestra u oculta la imagen de impresión de cada pieza.',
  Deshacer: 'Vuelve al paso anterior.',
  Rehacer: 'Recupera el paso que deshiciste.',
  Encajar: 'Ajusta el zoom para ver todas las piezas.',
  Cargar: 'Abre un archivo de proyecto guardado.',
  'Guardar archivo': 'Descarga el proyecto en un archivo para abrirlo después.',
  'Importar SVG': 'Trae un SVG y lo convierte en una pieza editable.',
  'SVG de corte': 'Exporta los trazos de corte y doblez, sin las imágenes.',
  'PDF de impresión': 'Exporta una página por cada pieza que tenga imagen.',
  Unir: 'Une las figuras seleccionadas en un solo contorno.',
  Intersecar: 'Deja solo la zona donde las figuras se cruzan.',
  Restar: 'Quita a la primera figura el área de las demás.',
  Excluir: 'Deja el área que las figuras no comparten.',
  Dividir: 'Parte las figuras por donde se cruzan. Una línea que atraviesa una figura la corta en dos.',
  'Alinear aristas': 'Pone sobre la misma línea las aristas y vértices que ya apuntan igual.',
  'Igualar ancho': 'Copia el ancho de la primera figura a las demás.',
  'Igualar alto': 'Copia el alto de la primera figura a las demás.',
  'Igualar tamaño': 'Copia el ancho y el alto de la primera figura.',
  Izquierda: 'Alinea las piezas por el borde izquierdo.',
  Centro: 'Alinea las piezas por el centro horizontal.',
  Derecha: 'Alinea las piezas por el borde derecho.',
  Arriba: 'Alinea las piezas por el borde de arriba.',
  Medio: 'Alinea las piezas por el centro vertical.',
  Abajo: 'Alinea las piezas por el borde de abajo.',
  'Distribuir horizontal': 'Reparte las piezas con la misma separación horizontal.',
  'Distribuir vertical': 'Reparte las piezas con la misma separación vertical.',
  'Reflejar horizontal': 'Voltea la pieza de izquierda a derecha.',
  'Reflejar vertical': 'Voltea la pieza de arriba a abajo.',
  'Rotar 90°': 'Gira la pieza un cuarto de vuelta.',
  Agrupar: 'Mantiene juntas las piezas para moverlas a la vez.',
  Desagrupar: 'Separa las piezas del grupo.',
  'Unir piezas': 'Funde las piezas en una. Los bordes que coinciden pasan a doblez.',
  'Unir líneas': 'Junta en un solo trazo las líneas abiertas que se tocan.',
  Duplicar: 'Crea una copia de las piezas seleccionadas.',
  Borrar: 'Elimina las piezas o el nodo seleccionado.',
}

export function IconButton({
  label,
  hint,
  icon,
  pressed,
  disabled,
  title,
  onClick,
}: {
  label: string
  hint?: string
  icon: ReactNode
  pressed?: boolean
  disabled?: boolean
  title?: string
  onClick: () => void
}) {
  const [tip, setTip] = useState<{ x: number; y: number; above: boolean } | null>(null)
  const description = title ?? helpText[label] ?? ''
  const place = (element: HTMLButtonElement) => {
    const rect = element.getBoundingClientRect()
    const above = rect.bottom + 96 > window.innerHeight
    setTip({ x: rect.left + rect.width / 2, y: above ? rect.top - 8 : rect.bottom + 8, above })
  }
  return (
    <>
      <button
        type="button"
        className={pressed ? 'icon-btn active' : 'icon-btn'}
        aria-label={hint ? `${label} (${hint}). ${description}` : `${label}. ${description}`}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
        onMouseEnter={(event) => place(event.currentTarget)}
        onMouseLeave={() => setTip(null)}
        onFocus={(event) => place(event.currentTarget)}
        onBlur={() => setTip(null)}
      >
        {icon}
      </button>
      {tip &&
        createPortal(
          <div
            className="tooltip"
            role="tooltip"
            style={{
              left: Math.min(Math.max(tip.x, 132), window.innerWidth - 132),
              top: tip.y,
              transform: tip.above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
            }}
          >
            <span className="tooltip-title">
              {label}
              {hint ? <Key>{hint}</Key> : null}
            </span>
            {description && <span className="tooltip-body">{description}</span>}
          </div>,
          document.body,
        )}
    </>
  )
}
