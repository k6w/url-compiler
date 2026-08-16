import { describe, expect, test } from "bun:test"
import { encodeUrl, decodePayloadString, decodePayloadBytes } from "@/lib/codec/candidates"
import { encodeSpecialized, decodeSpecialized } from "@/lib/codec/specialized"
import { ByteWriter } from "@/lib/codec/writer"
import { ByteReader } from "@/lib/codec/reader"
import { getDictionaries } from "@/lib/dictionaries/version"
import { canonicalize } from "@/lib/url/normalize"
import { toUrl } from "@/lib/url/model"
import { formatByte } from "@/lib/codec/types"

const FIXTURES: string[] = [
  "https://www.example.com/products/12345?utm_source=google&id=7",
  "http://example.com/",
  "https://example.com/",
  "https://example.com:8080/path",
  "https://example.com:443/path",
  "http://example.com:80/path",
  "https://example.com/a/b/c/d/e/f",
  "https://example.com/日本語/パス",
  "https://example.com/🎉/party",
  "https://example.com/page#section",
  "https://example.com/page#",
  "https://example.com/?a=1&a=2",
  "https://example.com/?flag",
  "https://example.com/?flag=",
  "https://example.com/?empty=&x=1",
  "https://example.com/?q=" + "x".repeat(300),
  "https://example.com/items/3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  "https://example.com/hex/deadbeefcafebabe0011223344556677",
  "https://example.com/hex/00ff",
  "https://example.com/num/0",
  "https://example.com/num/007",
  "https://example.com/num/2147483647",
  "https://example.com/same/same/same/same",
  "https://example.com/abc/def/abc/def/abc",
  "https://user@example.com/",
  "https://user:secretpw@example.com/path?x=1",
  "https://:pwonly@example.com/",
  "https://пример.рф/документы",
  "https://xn--e1afmkfd.xn--p1ai/docs",
  "https://[::1]:8080/ipv6",
  "https://localhost/no-tld",
  "https://github.com/vercel/next.js/pull/58452",
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "https://www.amazon.com/dp/B08N5WRWNW",
  "https://example.com/a%20b/%41/%2F",
  "https://example.com/?d=a%26b&e=a%3Db",
  "https://example.com/trailing/",
  "https://example.com/?",
  "https://example.com/?#",
  "http://neverssl.com/this-page",
  "https://example.com/true/false/boolean?on=true&off=false",
]

describe("codec round-trip", async () => {
  for (const url of FIXTURES) {
    test(`ultra: ${url}`, async () => {
      const result = await encodeUrl(url)
      expect(result.canonical.length).toBeGreaterThan(0)
      const decoded = await decodePayloadString(result.ultraPayload)
      expect(decoded.target).toBe(result.canonical)
      expect(decoded.via).toBe("base64url")
    })

    test(`human: ${url}`, async () => {
      const result = await encodeUrl(url)
      const decoded = await decodePayloadString(result.humanPayload)
      expect(decoded.target).toBe(result.canonical)
      expect(decoded.via).toBe("base32")
    })

    test(`every candidate verifies: ${url}`, async () => {
      const result = await encodeUrl(url)
      for (const candidate of result.candidates) {
        expect((await decodePayloadBytes(candidate.bytes)).target).toBe(result.canonical)
      }
    })
  }

  test("specialized beats or ties literal size for dictionary-friendly urls", async () => {
    const result = await encodeUrl("https://github.com/vercel/next.js/pull/58452")
    const specialized = result.candidates.find((c) => c.format === "specialized")
    expect(specialized).toBeDefined()
    expect(specialized!.bytes.length).toBeLessThan(64)
  })

  test("selection prefers smallest verified candidate", async () => {
    const result = await encodeUrl("https://www.example.com/products/12345?utm_source=google&id=7")
    const minBytes = Math.min(...result.candidates.map((c) => c.bytes.length))
    expect(result.best.bytes.length).toBe(minBytes)
  })
})

describe("human mode aliases", async () => {
  test("decodes case-insensitively with alias characters", async () => {
    const result = await encodeUrl("https://example.com/alias")
    const aliased = result.humanPayload
      .toLowerCase()
      .replace(/0/g, "o")
      .replace(/1/g, "i")
    expect((await decodePayloadString(aliased)).target).toBe(result.canonical)
  })
})

describe("canonical payload stability", async () => {
  test("encode(decode(payload)) is canonical", async () => {
    for (const url of FIXTURES.slice(0, 15)) {
      const result = await encodeUrl(url)
      const decoded = await decodePayloadString(result.ultraPayload)
      const recanonicalized = canonicalize(decoded.target)
      const reencoded = await encodeUrl(recanonicalized.canonical)
      expect(reencoded.canonical).toBe(result.canonical)
    }
  })
})

describe("property-based round-trip", async () => {
  function mulberry32(seed: number) {
    let a = seed
    return () => {
      a |= 0
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  const WORDS = ["alpha", "beta", "gamma", "12345", "0", "99", "deadbeef", "same", "true", "x", "a-b", "2", "777"]
  const HOSTS = ["example.com", "www.example.com", "github.com", "api.test.co.uk", "localhost", "shop.example.org"]
  const KEYS = ["id", "page", "q", "limit", "utm_source", "weird-key", "ok1"]
  const VALUES = ["1", "42", "true", "false", "hello-world", "en", "0", "abc123def", "deadbeef", "3f2504e0-4f89-11d3-9a0c-0305e82c3301"]

  function randomModelUrl(rand: () => number): string {
    const scheme = rand() < 0.85 ? "https" : "http"
    const host = HOSTS[Math.floor(rand() * HOSTS.length)]
    const port = rand() < 0.15 ? `:${1000 + Math.floor(rand() * 64000)}` : ""
    const segCount = Math.floor(rand() * 6)
    const segments: string[] = []
    for (let i = 0; i < segCount; i++) {
      const pick = WORDS[Math.floor(rand() * WORDS.length)]
      segments.push(rand() < 0.1 ? encodeURIComponent(pick) : pick)
    }
    let url = `${scheme}://${host}${port}/${segments.join("/")}`
    const pairCount = Math.floor(rand() * 4)
    if (pairCount > 0 || rand() < 0.2) {
      const pairs: string[] = []
      for (let i = 0; i < pairCount; i++) {
        const key = KEYS[Math.floor(rand() * KEYS.length)]
        const roll = rand()
        if (roll < 0.15) pairs.push(key)
        else if (roll < 0.3) pairs.push(`${key}=`)
        else pairs.push(`${key}=${VALUES[Math.floor(rand() * VALUES.length)]}`)
      }
      url += "?" + pairs.join("&")
    }
    if (rand() < 0.25) url += "#section-" + Math.floor(rand() * 100)
    return url
  }

  test("decode(encode(model)) === canonical for 300 random models", async () => {
    const rand = mulberry32(0xc0ffee)
    for (let i = 0; i < 300; i++) {
      const url = randomModelUrl(rand)
      const result = await encodeUrl(url)
      expect((await decodePayloadString(result.ultraPayload)).target).toBe(result.canonical)
      expect((await decodePayloadString(result.humanPayload)).target).toBe(result.canonical)
    }
  })

  test("canonicalization is idempotent for random models", async () => {
    const rand = mulberry32(0xfeed)
    for (let i = 0; i < 300; i++) {
      const url = randomModelUrl(rand)
      const first = canonicalize(url).canonical
      const second = canonicalize(first).canonical
      expect(second).toBe(first)
    }
  })
})

describe("cross-context backrefs", async () => {
  test("query values referencing path segments round-trip", async () => {
    const url = "https://example.com/repos/vercel/next.js?repo=vercel&name=next.js&fork=vercel"
    const result = await encodeUrl(url)
    expect((await decodePayloadString(result.ultraPayload)).target).toBe(result.canonical)
    expect((await decodePayloadString(result.humanPayload)).target).toBe(result.canonical)
  })

  test("SEGMENT_BACKREF with out-of-range index is rejected", async () => {
    const { ByteWriter } = await import("@/lib/codec/writer")
    const { formatByte, DecodeError } = await import("@/lib/codec/types")
    const { Opcode } = await import("@/lib/codec/opcodes")
    const { decodePayloadBytes } = await import("@/lib/codec/candidates")
    const w = new ByteWriter()
    w.byte(formatByte("specialized", 0))
    w.byte(0b0000_1000)
    w.byte(Opcode.LITERAL_BYTES)
    w.byte(11)
    w.bytes(new TextEncoder().encode("example.com"))
    w.byte(Opcode.END)
    w.varint(0)
    w.varint(1)
    w.byte(Opcode.LITERAL_BYTES)
    w.byte(1)
    w.bytes(new TextEncoder().encode("q"))
    w.byte(Opcode.SEGMENT_BACKREF)
    w.varint(9)
    await expect(decodePayloadBytes(w.finish())).rejects.toBeInstanceOf(DecodeError)
  })
})

describe("dictionary versioning", async () => {
  test("version 0 is registered and immutable", async () => {
    const set = getDictionaries(0)
    expect(set.version).toBe(0)
    expect(() => {
      ;(set.hosts as string[]).push("evil.example")
    }).toThrow()
    expect(set.hosts.length).toBeGreaterThan(32)
  })

  test("unknown dictionary version throws", async () => {
    expect(() => getDictionaries(99)).toThrow(/dictionary version/)
  })

  test("payload with unknown dictionary version is rejected", async () => {
    const w = new ByteWriter()
    w.byte(formatByte("specialized", 0))
    w.byte(0b0010_0000)
    w.varint(99)
    const decoded = await (async () => {
      try {
        await decodePayloadBytes(w.finish())
        return "no-error"
      } catch (e) {
        return (e as { code?: string }).code ?? String(e)
      }
    })()
    expect(decoded).toBe("INVALID_DICT_VERSION")
  })
})

describe("raw specialized bytecode directly", async () => {
  test("host dictionary full reference", async () => {
    const { model } = canonicalize("https://github.com/vercel/next.js")
    const bytes = encodeSpecialized(model, 0)
    expect(bytes[0]).toBe(formatByte("specialized", 0))
    expect(bytes[1]).toBe(0)
    expect(bytes[2]).toBe(0x20 + 12)
    const r = new ByteReader(bytes)
    r.readByte()
    r.readByte()
    const set = getDictionaries(0)
    const decoded = decodeSpecialized(r, 0, set)
    expect(decoded.hostname).toBe("github.com")
    expect(toUrl(decoded)).toBe("https://github.com/vercel/next.js")
  })
})
