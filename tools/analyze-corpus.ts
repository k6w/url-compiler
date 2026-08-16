import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { canonicalize } from "@/lib/url/normalize"
import corpus from "../data/corpus.json"

function loadUrls(): string[] {
  if (existsSync("data/corpus.txt")) {
    return readFileSync("data/corpus.txt", "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"))
  }
  return corpus.categories.flatMap((c) => c.urls)
}

function topN(counts: Map<string, number>, n: number) {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
}

function bump(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

function main(): void {
  const urls = loadUrls()
  const hosts = new Map<string, number>()
  const labels = new Map<string, number>()
  const suffixes = new Map<string, number>()
  const paths = new Map<string, number>()
  const queryKeys = new Map<string, number>()
  const values = new Map<string, number>()

  for (const url of urls) {
    let model
    try {
      model = canonicalize(url).model
    } catch {
      continue
    }
    bump(hosts, model.hostname)
    const parts = model.hostname.split(".")
    for (let i = 1; i < parts.length; i++) bump(suffixes, parts.slice(i).join("."))
    for (const part of parts.slice(0, -1)) bump(labels, part)
    for (const seg of model.pathSegments) bump(paths, seg.text)
    for (const pair of model.query) {
      bump(queryKeys, pair.key)
      if (pair.value !== null) bump(values, pair.value)
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    analyzedUrls: urls.length,
    suggestions: {
      hosts: topN(hosts, 40),
      labels: topN(labels, 30),
      suffixes: topN(suffixes, 30),
      paths: topN(paths, 50),
      queryKeys: topN(queryKeys, 40),
      values: topN(values, 40),
    },
  }

  console.log(`corpus analysis — ${urls.length} urls`)
  for (const [name, entries] of Object.entries(report.suggestions)) {
    console.log(`\n${name}:`)
    for (const [token, count] of entries) {
      console.log(`  ${String(count).padStart(4)}  ${token}`)
    }
  }

  mkdirSync("data/analysis", { recursive: true })
  writeFileSync("data/analysis/next-dictionary-candidates.json", JSON.stringify(report, null, 2) + "\n")
  console.log("\nwritten: data/analysis/next-dictionary-candidates.json")
  console.log("next: bun tools/build-dictionary.ts to draft a new immutable dictionary version")
}

main()
