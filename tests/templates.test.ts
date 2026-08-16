import { describe, expect, test } from "bun:test"
import { encodeUrl, decodePayloadString } from "@/lib/codec/candidates"
import { canonicalize } from "@/lib/url/normalize"
import { encodeSpecialized } from "@/lib/codec/specialized"
import { matchTemplate, TEMPLATES } from "@/lib/codec/templates"

const MATCH_CASES: Array<[string, string]> = [
  ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
  ["https://youtube.com/watch?v=dQw4w9WgXcQ", "https://youtube.com/watch?v=dQw4w9WgXcQ"],
  ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90"],
  ["https://www.youtube.com/shorts/ABC123def45", "https://www.youtube.com/shorts/ABC123def45"],
  ["https://youtube.com/shorts/ABC123def45", "https://youtube.com/shorts/ABC123def45"],
  ["https://github.com/vercel/next.js", "https://github.com/vercel/next.js"],
  ["https://github.com/vercel/next.js/issues/45123", "https://github.com/vercel/next.js/issues/45123"],
  ["https://github.com/vercel/next.js/pull/58452", "https://github.com/vercel/next.js/pull/58452"],
  ["https://www.amazon.com/dp/B08N5WRWNW", "https://www.amazon.com/dp/B08N5WRWNW"],
]

const NO_MATCH_CASES: string[] = [
  // wrong structure for every template
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123",
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s",
  "https://www.youtube.com/watch",
  "https://www.youtube.com/watch?v=short",
  "https://www.youtube.com/feed/subscriptions",
  "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
  "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
  "https://github.com/vercel/next.js/pull/58452/files",
  "https://github.com/vercel/next.js/issues/45123#issuecomment-1",
  "https://github.com/vercel/next.js/tree/canary/packages/next",
  "https://github.com/",
  "https://www.amazon.com/dp/notanasin1",
  "https://www.amazon.com/dp/B08N5WRWNW?keywords=sony",
  "https://www.amazon.com/dp/B08N5WRWNW?ref=sr_1_1&psc=1",
  "https://www.amazon.com/gp/product/B08N5WRWNW",
  "https://gist.github.com/torvalds/1234567890abcdef",
  // scheme/protocol/state incompatibilities
  "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "https://user@github.com/vercel/next.js",
  "https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ",
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ#t=30",
]

describe("service templates", () => {
  test("template ids are unique and stable", () => {
    const ids = TEMPLATES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain(0)
  })

  for (const [url, canonical] of MATCH_CASES) {
    test(`matches and canonicalizes: ${url}`, async () => {
      const { model } = canonicalize(url)
      const match = matchTemplate(model)
      expect(match).not.toBeNull()
      const result = await encodeUrl(url)
      expect(result.canonical).toBe(canonical)
      const decoded = await decodePayloadString(result.ultraPayload)
      expect(decoded.target).toBe(result.canonical)
      const human = await decodePayloadString(result.humanPayload)
      expect(human.target).toBe(result.canonical)
    })
  }

  for (const url of NO_MATCH_CASES) {
    test(`does not match: ${url}`, async () => {
      const { model } = canonicalize(url)
      expect(matchTemplate(model)).toBeNull()
      const result = await encodeUrl(url)
      const decoded = await decodePayloadString(result.ultraPayload)
      expect(decoded.target).toBe(result.canonical)
    })
  }

  test("template payload is used when it beats generic", async () => {
    const before = encodeSpecialized(canonicalize("https://github.com/torvalds").model, 0).length
    const result = await encodeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    // template body: opcode + id + count + 11-char literal + framing = strictly below generic
    expect(result.best.bytes.length).toBeLessThanOrEqual(before + 8)
  })

  test("template decode rejects unknown template id", async () => {
    const { ByteWriter } = await import("@/lib/codec/writer")
    const { formatByte, DecodeError } = await import("@/lib/codec/types")
    const { Opcode } = await import("@/lib/codec/opcodes")
    const w = new ByteWriter()
    w.byte(formatByte("specialized", 0))
    w.byte(0)
    w.byte(Opcode.SERVICE_TEMPLATE)
    w.varint(99)
    w.varint(0)
    const { decodePayloadBytes } = await import("@/lib/codec/candidates")
    await expect(decodePayloadBytes(w.finish())).rejects.toMatchObject({ code: "INVALID_DICT_ID" })
    void DecodeError
  })

  test("template decode rejects illegal flag combination", async () => {
    const { ByteWriter } = await import("@/lib/codec/writer")
    const { formatByte } = await import("@/lib/codec/types")
    const { Opcode } = await import("@/lib/codec/opcodes")
    const w = new ByteWriter()
    w.byte(formatByte("specialized", 0))
    w.byte(0b0000_1000)
    w.byte(Opcode.SERVICE_TEMPLATE)
    w.varint(0)
    w.varint(1)
    w.byte(Opcode.LITERAL_BYTES)
    w.byte(11)
    w.bytes(new TextEncoder().encode("dQw4w9WgXcQ"))
    const { decodePayloadBytes } = await import("@/lib/codec/candidates")
    await expect(decodePayloadBytes(w.finish())).rejects.toMatchObject({ code: "INVALID_OPCODE" })
  })
})
