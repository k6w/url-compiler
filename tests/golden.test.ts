import { describe, expect, test } from "bun:test"
import { readFileSync, existsSync } from "node:fs"
import { decodePayloadString } from "@/lib/codec/candidates"
import golden from "../data/golden/payloads.json"

type Entry = { original: string; target: string; format: string; dictionaryVersion: number; ultra: string; human: string }

const entries = (golden as { entries: Entry[] }).entries

describe("golden decode contract", async () => {
  test("golden payload file exists and is non-trivial", async () => {
    expect(existsSync("data/golden/payloads.json")).toBe(true)
    expect(entries.length).toBeGreaterThanOrEqual(50)
  })

  for (const entry of entries) {
    test(`ultra ${entry.ultra} → ${entry.target}`, async () => {
      const decoded = await decodePayloadString(entry.ultra)
      expect(decoded.target).toBe(entry.target)
      expect(decoded.family === entry.format).toBe(true)
    })

    test(`human ${entry.human} → ${entry.target}`, async () => {
      const decoded = await decodePayloadString(entry.human)
      expect(decoded.target).toBe(entry.target)
    })
  }

  test("no duplicate golden entries", async () => {
    const seen = new Set(entries.map((e) => e.ultra))
    expect(seen.size).toBe(entries.length)
  })

  test("golden file is committed (not regenerated drift)", async () => {
    const raw = readFileSync("data/golden/payloads.json", "utf8")
    expect(raw).toContain('"dictionaryVersionAtGeneration": 0')
  })
})
