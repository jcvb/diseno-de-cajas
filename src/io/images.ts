import { pieceLocalBBox } from '../model/geometry.ts'
import type { Piece, PieceImage } from '../model/types.ts'

export function readImageFile(file: File): Promise<{ href: string; pixelWidth: number; pixelHeight: number; name: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth || 1
      canvas.height = image.naturalHeight || 1
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(url)
        reject(new Error('No se pudo preparar la imagen.'))
        return
      }
      ctx.drawImage(image, 0, 0)
      const href = canvas.toDataURL('image/png')
      URL.revokeObjectURL(url)
      resolve({
        href,
        pixelWidth: canvas.width,
        pixelHeight: canvas.height,
        name: file.name,
      })
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('No se pudo leer la imagen.'))
    }
    image.src = url
  })
}

export function imageFittedToPiece(
  piece: Piece,
  file: { href: string; pixelWidth: number; pixelHeight: number; name: string },
): PieceImage {
  const box = pieceLocalBBox({ ...piece, image: null }) ?? { x: 0, y: 0, width: 100, height: 100 }
  const pad = 4
  const maxW = Math.max(10, box.width - pad * 2)
  const maxH = Math.max(10, box.height - pad * 2)
  const aspect = file.pixelWidth / Math.max(1, file.pixelHeight)
  let width = maxW
  let height = width / aspect
  if (height > maxH) {
    height = maxH
    width = height * aspect
  }
  return {
    href: file.href,
    name: file.name,
    width,
    height,
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    hidden: false,
  }
}
