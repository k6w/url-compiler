import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { parse } from "node:path"
import { parseUrl } from "@/lib/url/parse"
import { normalizeModel } from "@/lib/url/normalize"

const DICT_DIR = "data/dictionaries"
const SIZES = { hosts: 256, labels: 128, suffixes: 256, paths: 512, queryKeys: 256, values: 512 } as const
type DictKey = keyof typeof SIZES

function usage(): never {
  console.log(`usage: bun tools/build-dictionary.ts [--corpus data/corpus.txt] [--version N]

Builds a new immutable dictionary version from corpus frequency analysis.
The new version must be greater than every existing version.
Existing dictionary files are never modified.
After building, register the version in lib/dictionaries/version.ts.`)
  process.exit(1)
}

function readCorpus(path: string): string[] {
  if (!existsSync(path)) {
    console.error(`corpus file not found: ${path}`)
    process.exit(1)
  }
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"))
}

function existingVersions(): number[] {
  if (!existsSync(DICT_DIR)) return []
  return readdirSync(DICT_DIR)
    .map((f) => parse(f).name)
    .filter((n) => /^v\d+$/.test(n))
    .map((n) => Number(n.slice(1)))
    .sort((a, b) => a - b)
}

function currentDictionary(version: number): Record<string, unknown> | null {
  const path = `${DICT_DIR}/v${version}.json`
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, "utf8"))
}

function main(): void {
  const args = process.argv.slice(2)
  let corpusPath = "data/corpus.txt"
  let requestedVersion: number | null = null
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--corpus") corpusPath = args[++i]
    else if (args[i] === "--version") requestedVersion = Number(args[++i])
    else usage()
  }

  const versions = existingVersions()
  const latest = versions.length > 0 ? versions[versions.length - 1] : -1
  const next = requestedVersion ?? latest + 1
  if (next <= latest) {
    console.error(`refusing: version ${next} must be greater than latest existing version ${latest}`)
    console.error("dictionary versions are immutable; never rebuild an existing version")
    process.exit(1)
  }

  const target = `${DICT_DIR}/v${next}.json`
  if (existsSync(target)) {
    console.error(`refusing: ${target} already exists`)
    process.exit(1)
  }

  const urls = readCorpus(corpusPath)
  const counts: Record<DictKey, Map<string, number>> = {
    hosts: new Map(),
    labels: new Map(),
    suffixes: new Map(),
    paths: new Map(),
    queryKeys: new Map(),
    values: new Map(),
  }
  const bump = (key: DictKey, token: string) => counts[key].set(token, (counts[key].get(token) ?? 0) + 1)

  for (const url of urls) {
    let model
    try {
      model = normalizeModel(parseUrl(url))
    } catch {
      continue
    }
    bump("hosts", model.hostname)
    const parts = model.hostname.split(".")
    for (let i = 1; i < parts.length; i++) bump("suffixes", parts.slice(i).join("."))
    for (const part of parts.slice(0, -1)) bump("labels", part)
    for (const seg of model.pathSegments) bump("paths", seg.text)
    for (const pair of model.query) {
      bump("queryKeys", pair.key)
      if (pair.value !== null) bump("values", pair.value)
    }
  }

  const previous = latest >= 0 ? (currentDictionary(latest) as Record<DictKey, string[]>) : null
  const output: Record<string, unknown> = { version: next }
  for (const key of Object.keys(SIZES) as DictKey[]) {
    const priorTokens = previous?.[key] ?? []
    const fresh = [...counts[key].entries()].sort((a, b) => b[1] - a[1]).map(([token]) => token)
    const merged: string[] = []
    const seen = new Set<string>()
    for (const token of [...fresh, ...priorTokens]) {
      if (seen.has(token)) continue
      seen.add(token)
      merged.push(token)
      if (merged.length >= SIZES[key]) break
    }
    output[key] = merged
    const newCount = merged.filter((t) => !priorTokens.includes(t)).length
    console.log(`${key}: ${merged.length} entries (${newCount} new, ${merged.length - newCount} carried from v${latest})`)
  }

  writeFileSync(target, JSON.stringify(output, null, 2) + "\n")
  console.log(`\nwritten: ${target}`)
  console.log(`next: register version ${next} in lib/dictionaries/version.ts and run the corpus benchmark`)
}

main()
