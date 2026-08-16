import { dictionaryRefCost } from "../codec/opcodes"
import type { DictionarySet, DictRef } from "./version"

export function lookupValue(set: DictionarySet, value: string): DictRef | null {
  const id = set.valueIndex.get(value)
  if (id === undefined) return null
  return { id, cost: dictionaryRefCost(id) }
}

export function valueById(set: DictionarySet, id: number): string {
  if (id < 0 || id >= set.values.length) throw new RangeError(`value dictionary id out of range: ${id}`)
  return set.values[id]
}
