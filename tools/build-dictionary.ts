import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { parse } from "node:path"
import { parseUrl } from "@/lib/url/parse"
import { normalizeModel } from "@/lib/url/normalize"

const DICT_DIR = "data/dictionaries"
function shannonEntropy(token: string): number {
  const freq = new Map<string, number>()
  for (const c of token) freq.set(c, (freq.get(c) ?? 0) + 1)
  let h = 0
  for (const count of freq.values()) {
    const p = count / token.length
    h -= p * Math.log2(p)
  }
  return h
}

/**
 * Prevents overfitting: dictionary-worthy tokens are human-language-like or
 * short structured values. Random/high-entropy identifiers (base64 blobs,
 * long hex, mixed-case noise) are rejected — they occur once in any corpus
 * and a dictionary entry for them is memorization, not compression.
 */
function dictionaryWorthy(token: string): boolean {
  if (token.length === 0) return false
  if (token.length <= 2) return true
  if (/^\d+$/.test(token)) return token.length <= 6
  if (/^[0-9a-f]+$/.test(token) && token.length >= 8) return false
  if (token.length >= 8 && /[A-Z]/.test(token) && /[a-z]/.test(token) && /\d/.test(token)) return false
  if (token.length > 24) return false
  return shannonEntropy(token) <= 4.0
}

const SIZES = { hosts: 256, labels: 128, suffixes: 256, paths: 512, queryKeys: 256, values: 512 } as const
type DictKey = keyof typeof SIZES

function usage(): never {
  console.log(`usage: bun tools/build-dictionary.ts [--corpus data/corpus.txt] [--version N] [--min-count 2]

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
  let minCount = 2
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--corpus") corpusPath = args[++i]
    else if (args[i] === "--version") requestedVersion = Number(args[++i])
    else if (args[i] === "--min-count") minCount = Number(args[++i])
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
  const FILTERED: DictKey[] = ["paths", "values"]
  const output: Record<string, unknown> = { version: next }
  for (const key of Object.keys(SIZES) as DictKey[]) {
    const priorTokens = previous?.[key] ?? []
    const fresh = [...counts[key].entries()]
      .filter(([token, count]) => count >= minCount)
      .filter(([token]) => !FILTERED.includes(key) || dictionaryWorthy(token))
      .sort((a, b) => b[1] - a[1])
      .map(([token]) => token)
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
    const filteredOut = FILTERED.includes(key)
      ? counts[key].size - fresh.length
      : 0
    console.log(
      `${key}: ${merged.length} entries (${newCount} new, ${merged.length - newCount} carried from v${latest}${filteredOut ? `, ${filteredOut} filtered as high-entropy` : ""})`,
    )
  }

  writeFileSync(target, JSON.stringify(output, null, 2) + "\n")
  console.log(`\nwritten: ${target}`)
  console.log(`next: register version ${next} in lib/dictionaries/version.ts and run the corpus benchmark`)
}

main()
