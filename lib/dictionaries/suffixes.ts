import { dictionaryRefCost } from "../codec/opcodes"
import type { DictionarySet, DictRef } from "./version"

export interface SuffixMatch {
  id: number
  suffix: string
  labels: number
}

const suffixIndexCache = new WeakMap<DictionarySet, ReadonlyMap<string, number>>()

function suffixIndex(set: DictionarySet): ReadonlyMap<string, number> {
  let idx = suffixIndexCache.get(set)
  if (idx === undefined) {
    const m = new Map<string, number>()
    for (let i = 0; i < set.suffixes.length; i++) if (!m.has(set.suffixes[i])) m.set(set.suffixes[i], i)
    idx = m
    suffixIndexCache.set(set, idx)
  }
  return idx
}

export function lookupSuffix(set: DictionarySet, suffix: string): DictRef | null {
  const id = suffixIndex(set).get(suffix)
  if (id === undefined) return null
  return { id, cost: dictionaryRefCost(id) }
}

export function matchLongestSuffix(set: DictionarySet, hostname: string): SuffixMatch | null {
  const labels = hostname.split(".")
  if (labels.length < 2) return null
  const idx = suffixIndex(set)
  for (let start = 1; start < labels.length; start++) {
    const suffix = labels.slice(start).join(".")
    const id = idx.get(suffix)
    if (id !== undefined) return { id, suffix, labels: labels.length - start }
  }
  return null
}

export function suffixById(set: DictionarySet, id: number): string {
  if (id < 0 || id >= set.suffixes.length) throw new RangeError(`suffix dictionary id out of range: ${id}`)
  return set.suffixes[id]
}
