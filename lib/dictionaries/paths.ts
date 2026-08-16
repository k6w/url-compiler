import { dictionaryRefCost } from "../codec/opcodes"
import type { DictionarySet, DictRef } from "./version"

export function lookupPathToken(set: DictionarySet, token: string): DictRef | null {
  const id = set.pathIndex.get(token)
  if (id === undefined) return null
  return { id, cost: dictionaryRefCost(id) }
}

export function pathById(set: DictionarySet, id: number): string {
  if (id < 0 || id >= set.paths.length) throw new RangeError(`path dictionary id out of range: ${id}`)
  return set.paths[id]
}
