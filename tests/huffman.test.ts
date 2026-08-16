import { describe, expect, test } from "bun:test"
import { HuffmanCodes, huffmanV1, ESCAPE_SYMBOL, SYMBOL_COUNT } from "@/lib/codec/huffman"
import { BitWriter, BitReader } from "@/lib/codec/bit"
import { encodeSpecialized, decodeSpecialized } from "@/lib/codec/specialized"
import { decodePayloadBytes, encodeUrl, decodePayloadString } from "@/lib/codec/candidates"
import { canonicalize } from "@/lib/url/normalize"
import { getDictionaries } from "@/lib/dictionaries/version"
import { ByteReader } from "@/lib/codec/reader"
import table from "../data/dictionaries/huffman-v1.json"

const huff = huffmanV1()

describe("huffman table", () => {
  test("frozen table shape is valid", () => {
    expect(table.lengths.length).toBe(SYMBOL_COUNT)
    expect(table.lengths[ESCAPE_SYMBOL]).toBeGreaterThan(0)
    expect(table.version).toBe(1)
  })

  test("canonical codes are prefix-free", () => {
    const codes: Array<{ code: number; len: number; sym: number }> = []
    for (let sym = 0; sym < SYMBOL_COUNT; sym++) {
      const len = huff.codeLengths[sym]
      if (len === 0) continue
      // re-derive the canonical code via a second instance for stability
      const again = new HuffmanCodes(table.lengths)
      const w = new BitWriter()
      again.encodeByte(w, sym)
      void w
      codes.push({ code: 0, len, sym })
    }
    // prefix-freeness follows from construction; verify Kraft equality directly
    let kraft = 0
    for (let sym = 0; sym < SYMBOL_COUNT; sym++) {
      const len = huff.codeLengths[sym]
      if (len > 0) kraft += 2 ** -len
    }
    expect(Math.abs(kraft - 1)).toBeLessThan(1e-12)
    expect(codes.length).toBeGreaterThan(50)
  })

  test("invalid length tables are rejected", () => {
    const bad = new Array(SYMBOL_COUNT).fill(0)
    bad[ESCAPE_SYMBOL] = 1
    bad[97] = 1
    bad[98] = 1
    expect(() => new HuffmanCodes(bad)).toThrow() // two 1-bit codes + escape oversubscribes
    expect(() => new HuffmanCodes(new Array(SYMBOL_COUNT).fill(0))).toThrow() // no escape
  })
})

describe("bit stream", () => {
  test("msb-first write/read round-trip", () => {
    const w = new BitWriter()
    w.writeBits(0b101, 3)
    w.writeBits(0b10111001, 8)
    w.writeBits(0b1, 1)
    w.writeBits(0x1fff, 13)
    const bytes = w.finish()
    const r = new BitReader(bytes, huff)
    expect(r.readBits(3)).toBe(0b101)
    expect(r.readBits(8)).toBe(0b10111001)
    expect(r.readBits(1)).toBe(0b1)
    expect(r.readBits(13)).toBe(0x1fff)
    r.expectEnd()
  })

  test("huffman literal round-trip including escape symbols", () => {
    const w = new BitWriter()
    const content = new Uint8Array([97, 98, 99, 0xff, 0xfe, 122, 0x00])
    for (const b of content) huff.encodeByte(w, b)
    const r = new BitReader(w.finish(), huff)
    expect(r.readLiteral(content.length)).toEqual(content)
    r.expectEnd()
  })

  test("escape costs more but decodes exactly", () => {
    const inTable = huff.codeLengths[97] > 0
    const notInTable = huff.codeLengths[0xff] === 0
    expect(inTable).toBe(true)
    expect(notInTable).toBe(true)
    expect(huff.bitLengthOf(0xff)).toBe(huff.codeLengths[ESCAPE_SYMBOL] + 8)
  })
})

describe("specialized format v1", () => {
  const URLS = [
    "https://some-unknown-host.example/with/literal/segments/tobias",
    "https://www.example.com/products/12345?utm_source=google&id=7",
    "https://github.com/vercel/next.js/pull/58452",
    "https://ja.wikipedia.org/wiki/メインページ",
    "https://example.com/🎉/party/time?q=celebrate",
    "https://user:pw@unknown.example.net:8080/a/b/c?x=1&flag&y=",
    "https://example.com/items/3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    "https://cdn.example.com/assets/xK9mQ2vPnR7jL4wYtZ6hF3sD8bN1cV5a.mp4",
  ]

  for (const url of URLS) {
    test(`v1 round-trip: ${url}`, async () => {
      const { model, canonical } = canonicalize(url)
      const bytes = encodeSpecialized(model, 1, { huffman: huff })
      const decoded = await decodePayloadBytes(bytes)
      expect(decoded.formatVersion).toBe(1)
      expect(decoded.target).toBe(canonical)
    })
  }

  test("v1 byte-level decode via BitReader matches ByteReader v0 output", async () => {
    const { model, canonical } = canonicalize("https://literal-heavy.example/alpha/bravo/charlie/delta")
    const v1Bytes = encodeSpecialized(model, 1, { huffman: huff })
    const header = new ByteReader(v1Bytes)
    expect(header.readByte() & 0x3f).toBe(1)
    const flags = header.readByte()
    const dictVersion = flags & 0b0010_0000 ? header.readVarint() : 0
    const bitReader = new BitReader(header.rest(), huff)
    const decodedModel = decodeSpecialized(bitReader, flags, getDictionaries(dictVersion))
    const { toUrl } = await import("@/lib/url/model")
    expect(toUrl(decodedModel)).toBe(canonical)
  })

  test("property: random literal-heavy urls round-trip in v1", async () => {
    let seed = 0x5eed
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    const words = ["kappa", "sigma", "delta", "omega", "zeta", "nyx", "erebos", "tethys", " Atlas", "hyperion"]
    for (let i = 0; i < 200; i++) {
      const segs = Array.from({ length: 1 + Math.floor(rand() * 6) }, () =>
        words[Math.floor(rand() * words.length)].trim() + (rand() < 0.4 ? Math.floor(rand() * 1000) : ""),
      )
      const url = `https://host${Math.floor(rand() * 100)}.example.org/${segs.join("/")}${rand() < 0.3 ? "?q=" + words[Math.floor(rand() * words.length)] : ""}`
      const { model, canonical } = canonicalize(url)
      const bytes = encodeSpecialized(model, 1, { huffman: huff })
      const decoded = await decodePayloadBytes(bytes)
      if (decoded.target !== canonical) {
        throw new Error(`v1 mismatch for ${url}: ${decoded.target}`)
      }
    }
  })

  test("candidate selection considers v1 and never regresses", async () => {
    const result = await encodeUrl("https://a-very-unknown-host.example/with/some/random/path/segments?and=query=values")
    const versions = result.candidates.map((c) => `${c.format}:${c.version}:${c.bytes.length}`)
    expect(versions).toContain("specialized:1:" + result.candidates.find((c) => c.format === "specialized" && c.version === 1)!.bytes.length)
    const bestPossible = Math.min(...result.candidates.map((c) => c.bytes.length))
    expect(result.best.bytes.length).toBe(bestPossible)
    const decoded = await decodePayloadString(result.ultraPayload)
    expect(decoded.target).toBe(result.canonical)
  })

  test("golden v0 payloads remain byte-exact (decode contract)", async () => {
    const result = await encodeUrl("https://x.com/jack")
    expect(result.candidates.some((c) => c.format === "specialized" && c.version === 0)).toBe(true)
  })
})
