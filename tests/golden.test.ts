import { describe, expect, test } from "bun:test"
import { readFileSync, existsSync } from "node:fs"
import { decodePayloadString } from "@/lib/codec/candidates"
import golden from "../data/golden/payloads.json"

type Entry = { original: string; target: string; format: string; dictionaryVersion: number; ultra: string; human: string }

const entries = (golden as { entries: Entry[] }).entries

describe("golden decode contract", () => {
  test("golden payload file exists and is non-trivial", () => {
    expect(existsSync("data/golden/payloads.json")).toBe(true)
    expect(entries.length).toBeGreaterThanOrEqual(50)
  })

  for (const entry of entries) {
    test(`ultra ${entry.ultra} → ${entry.target}`, () => {
      const decoded = decodePayloadString(entry.ultra)
      expect(decoded.target).toBe(entry.target)
      expect(decoded.family).toBe(entry.format)
    })

    test(`human ${entry.human} → ${entry.target}`, () => {
      const decoded = decodePayloadString(entry.human)
      expect(decoded.target).toBe(entry.target)
    })
  }

  test("no duplicate golden entries", () => {
    const seen = new Set(entries.map((e) => e.ultra))
    expect(seen.size).toBe(entries.length)
  })

  test("golden file is committed (not regenerated drift)", () => {
    const raw = readFileSync("data/golden/payloads.json", "utf8")
    expect(raw).toContain('"dictionaryVersionAtGeneration": 0')
  })
})
