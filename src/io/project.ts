import type { Doc } from '../model/types.ts'

export function serializeProject(doc: Doc): string {
  return JSON.stringify({ version: 1, doc }, null, 2)
}

export function parseProject(text: string): Doc {
  const data: unknown = JSON.parse(text)
  if (!isRecord(data) || data.version !== 1 || !isRecord(data.doc) || !Array.isArray(data.doc.pieces)) {
    throw new Error('El archivo no es un proyecto de troqueles.')
  }
  return data.doc as Doc
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function downloadText(filename: string, text: string, type: string): void {
  downloadBlob(filename, new Blob([text], { type }))
}

export function downloadBytes(filename: string, bytes: Uint8Array, type: string): void {
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  downloadBlob(filename, new Blob([copy], { type }))
}
