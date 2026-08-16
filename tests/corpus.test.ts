import { describe, expect, test } from "bun:test"
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { encodeUrl, decodePayloadString } from "@/lib/codec/candidates"
import corpus from "../data/corpus.json"

interface CategoryMetrics {
  category: string
  urls: number
  avgOriginal: number
  avgUltra: number
  avgUltraPayload: number
  avgHuman: number
  minUltra: number
  maxUltra: number
  encodeMs: number
  decodeMs: number
}

const ORIGIN = "http://localhost:3000"

async function runCorpus(): Promise<{ entries: CategoryMetrics[]; total: number; shortenedCount: number }> {
  const entries: CategoryMetrics[] = []
  let total = 0
  let shortenedCount = 0
  for (const category of corpus.categories) {
    let originalSum = 0
    let ultraSum = 0
    let ultraPayloadSum = 0
    let humanSum = 0
    let minUltra = Infinity
    let maxUltra = 0
    let encodeMs = 0
    let decodeMs = 0
    for (const url of category.urls) {
      const encStart = performance.now()
      const result = await encodeUrl(url)
      encodeMs += performance.now() - encStart

      const decStart = performance.now()
      const decoded = await decodePayloadString(result.ultraPayload)
      decodeMs += performance.now() - decStart

      expect(decoded.target).toBe(result.canonical)
      const humanDecoded = await decodePayloadString(result.humanPayload)
      expect(humanDecoded.target).toBe(result.canonical)

      const ultraLength = ORIGIN.length + 1 + result.ultraPayload.length
      originalSum += url.length
      ultraSum += ultraLength
      ultraPayloadSum += result.ultraPayload.length
      humanSum += ORIGIN.length + 1 + result.humanPayload.length
      minUltra = Math.min(minUltra, ultraLength)
      maxUltra = Math.max(maxUltra, ultraLength)
      total++
      if (ultraLength < url.length) shortenedCount++
    }
    entries.push({
      category: category.name,
      urls: category.urls.length,
      avgOriginal: Math.round(originalSum / category.urls.length),
      avgUltra: Math.round(ultraSum / category.urls.length),
      avgUltraPayload: Math.round(ultraPayloadSum / category.urls.length),
      avgHuman: Math.round(humanSum / category.urls.length),
      minUltra,
      maxUltra,
      encodeMs: Math.round(encodeMs * 100) / 100,
      decodeMs: Math.round(decodeMs * 100) / 100,
    })
  }
  return { entries, total, shortenedCount }
}

describe("corpus", async () => {
  test("every corpus url round-trips in both modes", async () => {
    const { entries, total } = await runCorpus()
    expect(total).toBeGreaterThanOrEqual(40)
    for (const entry of entries) {
      expect(entry.urls).toBeGreaterThan(0)
    }
  })

  test("dictionary-friendly categories compress well at the payload level", async () => {
    const { entries } = await runCorpus()
    for (const name of ["long-paths", "api", "uuid", "tracking", "service-template"]) {
      const entry = entries.find((e) => e.category === name)
      expect(entry!.avgUltraPayload).toBeLessThan(entry!.avgOriginal)
    }
  })

  test("no major regression against committed baseline", async () => {
    const { entries } = await runCorpus()
    const baselinePath = "data/benchmarks/baseline.json"
    if (!existsSync(baselinePath)) return
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as { categories: CategoryMetrics[] }
    for (const current of entries) {
      const prior = baseline.categories.find((c) => c.category === current.category)
      if (!prior) continue
      const regression = current.avgUltra - prior.avgUltra
      expect(regression).toBeLessThanOrEqual(Math.max(3, prior.avgUltra * 0.05))
    }
  })

  test("records latest metrics", async () => {
    const { entries, total, shortenedCount } = await runCorpus()
    mkdirSync("data/benchmarks", { recursive: true })
    writeFileSync(
      "data/benchmarks/latest.json",
      JSON.stringify({ generatedAt: new Date().toISOString(), total, shortenedCount, categories: entries }, null, 2) + "\n",
    )
    expect(shortenedCount).toBeGreaterThan(0)
  })
})
