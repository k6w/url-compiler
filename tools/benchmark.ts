import { mkdirSync, writeFileSync } from "node:fs"
import { encodeSpecialized } from "@/lib/codec/specialized"
import { huffmanV1 } from "@/lib/codec/huffman"
import { encodeUrl, decodePayloadString, compressFamilyPayload } from "@/lib/codec/candidates"
import { canonicalize } from "@/lib/url/normalize"
import { base64UrlEncode } from "@/lib/alphabet/base64url"
import { getDictionaries } from "@/lib/dictionaries/version"
import corpus from "../data/corpus.json"

const ORIGIN = "http://localhost:3000"
const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
const utf8 = new TextEncoder()

function base62Encode(bytes: Uint8Array): string {
  let n = 0n
  for (const b of bytes) n = (n << 8n) | BigInt(b)
  let out = ""
  while (n > 0n) {
    out = BASE62[Number(n % 62n)] + out
    n /= 62n
  }
  return out || "0"
}

type Strategy = (canonical: string) => string

const strategies: Record<string, Strategy> = {
  "raw-base64url": (canonical) => base64UrlEncode(utf8.encode(canonical)),
  "raw-base62": (canonical) => base62Encode(utf8.encode(canonical)),
  specialized: (canonical) => {
    const { model } = canonicalize(canonical)
    return base64UrlEncode(encodeSpecialized(model, getDictionaries(0).version))
  },
  "specialized-huffman": (canonical) => {
    const { model } = canonicalize(canonical)
    return base64UrlEncode(encodeSpecialized(model, getDictionaries(0).version, { huffman: huffmanV1() }))
  },
  brotli: (canonical) => base64UrlEncode(compressFamilyPayload("brotli", canonical)),
  deflate: (canonical) => base64UrlEncode(compressFamilyPayload("deflate", canonical)),
}

interface Row {
  category: string
  strategy: string
  p50: number
  p90: number
  avg: number
  min: number
  max: number
  encodeMs: number
  decodeMs: number
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

function stats(values: number[]): Omit<Row, "category" | "strategy"> {
  const sorted = [...values].sort((a, b) => a - b)
  return {
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    avg: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    encodeMs: 0,
    decodeMs: 0,
  }
}

async function main(): Promise<void> {
  const rows: Row[] = []
  const warnings: string[] = []

  for (const category of corpus.categories) {
    const canonicals = category.urls.map((u) => canonicalize(u).canonical)

    for (const [name, strategy] of Object.entries(strategies)) {
      const lengths: number[] = []
      const encStart = performance.now()
      for (const canonical of canonicals) {
        lengths.push(ORIGIN.length + 1 + strategy(canonical).length)
      }
      const encodeMs = performance.now() - encStart
      rows.push({ category: category.name, strategy: name, ...stats(lengths), encodeMs: Math.round(encodeMs * 100) / 100 })
    }

    const lengths: number[] = []
    let decodeTotal = 0
    const encStart = performance.now()
    for (const url of category.urls) {
      const result = await encodeUrl(url)
      lengths.push(ORIGIN.length + 1 + result.ultraPayload.length)
    }
    const encodeMs = performance.now() - encStart
    for (const url of category.urls) {
      const result = await encodeUrl(url)
      const decStart = performance.now()
      await decodePayloadString(result.ultraPayload)
      decodeTotal += performance.now() - decStart
    }
    rows.push({
      category: category.name,
      strategy: "auto-selected",
      ...stats(lengths),
      encodeMs: Math.round(encodeMs * 100) / 100,
      decodeMs: Math.round(decodeTotal * 100) / 100,
    })

    const avgOriginal = Math.round(category.urls.reduce((a, b) => a + b.length, 0) / category.urls.length)
    if (rows[rows.length - 1].avg >= avgOriginal) {
      warnings.push(`${category.name}: selected avg ${rows[rows.length - 1].avg} >= original avg ${avgOriginal}`)
    }
  }

  const rawAvg = new Map(rows.filter((r) => r.strategy === "raw-base64url").map((r) => [r.category, r.avg]))

  console.log(`\nURL compiler benchmark — origin ${ORIGIN}`)
  console.log("=".repeat(112))
  console.log(
    ["category", "strategy", "p50", "p90", "avg", "min", "max", "vs-raw", "enc ms", "dec ms"]
      .map((h) => h.padEnd(18))
      .join(""),
  )
  for (const r of rows) {
    const ratio = rawAvg.get(r.category)!
    const vsRaw = r.strategy === "raw-base64url" ? "1.000" : (r.avg / ratio).toFixed(3)
    console.log(
      [r.category, r.strategy, String(r.p50), String(r.p90), String(r.avg), String(r.min), String(r.max), vsRaw, String(r.encodeMs), String(r.decodeMs)]
        .map((c) => c.padEnd(18))
        .join(""),
    )
  }
  if (warnings.length > 0) {
    console.log("\nwarning: categories where stateless encoding does not beat the original URL length")
    for (const w of warnings) console.log(`  - ${w}`)
  }

  mkdirSync("data/benchmarks", { recursive: true })
  writeFileSync(
    "data/benchmarks/benchmark.json",
    JSON.stringify({ generatedAt: new Date().toISOString(), origin: ORIGIN, rows }, null, 2) + "\n",
  )
  console.log("\nwritten: data/benchmarks/benchmark.json")
}

main()
await main()
