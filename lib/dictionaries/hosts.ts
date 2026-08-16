import { dictionaryRefCost } from "../codec/opcodes"
import type { DictionarySet, DictRef } from "./version"

export function lookupHost(set: DictionarySet, host: string): DictRef | null {
  const id = set.hostIndex.get(host)
  if (id === undefined) return null
  return { id, cost: dictionaryRefCost(id) }
}

export function hostById(set: DictionarySet, id: number): string {
  if (id < 0 || id >= set.hosts.length) throw new RangeError(`host dictionary id out of range: ${id}`)
  return set.hosts[id]
}
