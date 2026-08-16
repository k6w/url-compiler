import v0 from "../../data/dictionaries/v0.json"
import v1 from "../../data/dictionaries/v1.json"

export interface DictionaryData {
  hosts: string[]
  labels: string[]
  suffixes: string[]
  paths: string[]
  queryKeys: string[]
  values: string[]
}

export interface DictionarySet {
  readonly version: number
  readonly hosts: readonly string[]
  readonly labels: readonly string[]
  readonly suffixes: readonly string[]
  readonly paths: readonly string[]
  readonly queryKeys: readonly string[]
  readonly values: readonly string[]
  readonly hostIndex: ReadonlyMap<string, number>
  readonly labelIndex: ReadonlyMap<string, number>
  readonly pathIndex: ReadonlyMap<string, number>
  readonly queryKeyIndex: ReadonlyMap<string, number>
  readonly valueIndex: ReadonlyMap<string, number>
}

export interface DictRef {
  id: number
  cost: number
}

export class DictionaryVersionError extends Error {
  constructor(public readonly version: number) {
    super(`unknown dictionary version: ${version}`)
    this.name = "DictionaryVersionError"
  }
}

function toIndex(entries: readonly string[]): ReadonlyMap<string, number> {
  const m = new Map<string, number>()
  for (let i = 0; i < entries.length; i++) if (!m.has(entries[i])) m.set(entries[i], i)
  return m
}

function buildSet(version: number, data: DictionaryData): DictionarySet {
  const hosts = Object.freeze(data.hosts)
  const labels = Object.freeze(data.labels)
  const suffixes = Object.freeze(data.suffixes)
  const paths = Object.freeze(data.paths)
  const queryKeys = Object.freeze(data.queryKeys)
  const values = Object.freeze(data.values)
  return Object.freeze({
    version,
    hosts,
    labels,
    suffixes,
    paths,
    queryKeys,
    values,
    hostIndex: toIndex(hosts),
    labelIndex: toIndex(labels),
    pathIndex: toIndex(paths),
    queryKeyIndex: toIndex(queryKeys),
    valueIndex: toIndex(values),
  })
}

const registry = new Map<number, DictionarySet>()

function register(set: DictionarySet): void {
  if (registry.has(set.version)) {
    throw new Error(`dictionary version ${set.version} already registered`)
  }
  registry.set(set.version, set)
}

register(buildSet(v0.version, v0))
register(buildSet(v1.version, v1))

export function getDictionaries(version: number): DictionarySet {
  const set = registry.get(version)
  if (set === undefined) throw new DictionaryVersionError(version)
  return set
}

export function isSupportedDictionaryVersion(version: number): boolean {
  return registry.has(version)
}

export const supportedDictionaryVersions: readonly number[] = [...registry.keys()].sort((a, b) => a - b)
