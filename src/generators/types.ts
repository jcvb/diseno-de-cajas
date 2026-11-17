import type { Piece } from '../model/types.ts'

export type ParamField = {
  key: string
  label: string
  min: number
  max: number
  step: number
}

export type Generator<T extends Record<string, number>> = {
  id: string
  name: string
  fields: ParamField[]
  defaults: T
  generate: (params: T) => Piece[]
}
