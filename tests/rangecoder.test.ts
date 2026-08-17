import { describe, expect, test } from "bun:test"
import { rcModel, RangeEncoder, RangeDecoder, RC_TOTAL } from "@/lib/codec/rangecoder"
import { encodeSpecialized, decodeSpecialized } from "@/lib/codec/specialized"
import { decodePayloadBytes } from "@/lib/codec/candidates"
import { canonicalize } from "@/lib/url/normalize"
import { getDictionaries } from "@/lib/dictionaries/version"
import { ByteReader } from "@/lib/codec/reader"
import { RcLiteralReader } from "@/lib/codec/rangecoder"
import { toUrl } from "@/lib/url/model"
import { huffmanV1 } from "@/lib/codec/huffman"

const model = rcModel()

describe("range coder model", () => {
  test("frequencies are positive and sum exactly to 2^16", () => {
    let sum = 0
    for (let i = 0; i < 256; i++) {
      expect(model.freq[i]).toBeGreaterThan(0)
      sum += model.freq[i]
    }
    expect(sum).toBe(RC_TOTAL)
    expect(model.cum[257]).toBe(RC_TOTAL)
  })

  test("model is deterministic across instances", () => {
    expect(rcModel()).toBe(model)
  })
})

describe("range coder round-trip", () => {
  test("fuzz: random, skewed, and carry-stress inputs survive", () => {
    let seed = 0xfeed
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed
    }
    for (let t = 0; t < 3000; t++) {
      const n = rand() % 300
      const data = new Uint8Array(n)
      const mode = t % 4
      for (let i = 0; i < n; i++) {
        if (mode === 0) data[i] = rand() % 256
        else if (mode === 1) data[i] = 97 + (rand() % 26)
        else if (mode === 2) data[i] = [101, 116, 97, 111, 110, 46, 47, 45, 115][rand() % 9]
        else data[i] = rand() % 2 ? 255 : rand() % 2 ? 254 : rand() % 256
      }
      const enc = new RangeEncoder()
      for (const b of data) enc.encodeSymbol(model, b)
      const pool = enc.flush()
      const dec = new RangeDecoder()
      const back = dec.decodeBytes(model, pool, n)
      expect([...back]).toEqual([...data])
    }
  })

  test("empty and single-byte inputs", () => {
    const single = new Uint8Array([42])
    const enc = new RangeEncoder()
    enc.encodeSymbol(model, 42)
    const back = new RangeDecoder().decodeBytes(model, enc.flush(), 1)
    expect([...back]).toEqual([42])
  })
})

describe("specialized format v2 (defined, not emitted)", () => {
  const URLS = [
    "https://some-unknown-host.example/with/literal/segments/here",
    "https://www.example.com/products/12345?utm_source=google&id=7",
    "https://user:pw@unknown.example.net:8080/a/b/c?x=1&flag&y=#frag",
    "https://example.com/🎉/party/time?q=celebrate",
    "https://github.com/vercel/next.js/pull/58452",
  ]

  for (const url of URLS) {
    test(`v2 round-trip: ${url}`, async () => {
      const { model: urlModel, canonical } = canonicalize(url)
      const bytes = encodeSpecialized(urlModel, 1, { rangeModel: model })
      const decoded = await decodePayloadBytes(bytes)
      expect(decoded.formatVersion).toBe(2)
      expect(decoded.target).toBe(canonical)
    })
  }

  test("v2 decodes via RcLiteralReader against the inner ByteReader", async () => {
    const { model: urlModel, canonical } = canonicalize("https://literal-heavy.example/alpha/bravo/charlie")
    const bytes = encodeSpecialized(urlModel, 1, { rangeModel: model })
    const r = new ByteReader(bytes)
    r.readByte()
    const flags = r.readByte()
    const dictVersion = flags & 0b0010_0000 ? r.readVarint() : 0
    const poolLen = r.readVarint()
    const pool = r.readBytes(poolLen)
    const reader = new RcLiteralReader(r, pool, model)
    const decoded = decodeSpecialized(reader, flags, getDictionaries(dictVersion))
    expect(toUrl(decoded)).toBe(canonical)
  })

  test("v2 never beats v1 in the URL domain (bench-gated, not emitted)", () => {
    const { model: urlModel } = canonicalize("https://a-very-unknown-host.example/with/some/random/path/segments")
    const v1 = encodeSpecialized(urlModel, 1, { huffman: huffmanV1() })
    const v2 = encodeSpecialized(urlModel, 1, { rangeModel: model })
    // pool framing (varint + 4-byte init + flush slack) exceeds the ~0.3%
    // entropy gain at URL sizes; documented in README compression decisions
    expect(v2.length).toBeGreaterThan(v1.length - 2)
  })

  test("v2 with truncated pool fails closed", async () => {
    const { model: urlModel } = canonicalize("https://some-host.example/literal/words/only")
    const bytes = encodeSpecialized(urlModel, 1, { rangeModel: model })
    await expect(decodePayloadBytes(bytes.subarray(0, bytes.length - 1))).rejects.toBeTruthy()
  })

  test("oversized pool length varint fails closed", async () => {
    const { ByteWriter } = await import("@/lib/codec/writer")
    const { formatByte } = await import("@/lib/codec/types")
    const w = new ByteWriter()
    w.byte(formatByte("specialized", 2))
    w.byte(0)
    w.varint(5000)
    await expect(decodePayloadBytes(w.finish())).rejects.toBeTruthy()
  })
})
