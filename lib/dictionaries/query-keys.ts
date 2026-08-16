import { dictionaryRefCost } from "../codec/opcodes"
import type { DictionarySet, DictRef } from "./version"

export function lookupQueryKey(set: DictionarySet, key: string): DictRef | null {
  const id = set.queryKeyIndex.get(key)
  if (id === undefined) return null
  return { id, cost: dictionaryRefCost(id) }
}

export function queryKeyById(set: DictionarySet, id: number): string {
  if (id < 0 || id >= set.queryKeys.length) throw new RangeError(`query key dictionary id out of range: ${id}`)
  return set.queryKeys[id]
}
