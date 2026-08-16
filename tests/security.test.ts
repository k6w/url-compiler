import { describe, expect, test } from "bun:test"
import { decodePayloadString, decodePayloadBytes } from "@/lib/codec/candidates"
import { DecodeError, DecodeErrorCode, formatByte } from "@/lib/codec/types"
import { encodeUrl } from "@/lib/codec/candidates"
import { ByteWriter } from "@/lib/codec/writer"
import { Opcode } from "@/lib/codec/opcodes"
import { base64UrlEncode } from "@/lib/alphabet/base64url"
import { humanEncode, suggestHumanCorrection } from "@/lib/alphabet/base32"
import { validateRedirectTarget, RedirectError } from "@/lib/security/redirect"
import { parseUrl } from "@/lib/url/parse"
import { checkRateLimit, resetRateLimits } from "@/lib/security/abuse"
import { encodeSpecialized } from "@/lib/codec/specialized"
import { canonicalize } from "@/lib/url/normalize"
import zlib from "node:zlib"

async function expectDecodeError(payload: string | Uint8Array, code: DecodeErrorCode) {
  try {
    if (typeof payload === "string") await decodePayloadString(payload)
    else await decodePayloadBytes(payload)
    throw new Error(`expected DecodeError ${code}, got success`)
  } catch (e) {
    if (e instanceof DecodeError) {
      expect(e.code).toBe(code)
    } else {
      throw e
    }
  }
}

describe("dangerous schemes are rejected", async () => {
  const dangerous = [
    "javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "file:///etc/passwd",
    "vbscript:msgbox(1)",
    "about:blank",
    "JAVASCRIPT:alert(1)",
    " javascript:alert(1)",
  ]
  for (const url of dangerous) {
    test(`parse rejects ${JSON.stringify(url)}`, async () => {
      expect(() => parseUrl(url)).toThrow()
    })
    test(`redirect validation rejects ${JSON.stringify(url)}`, async () => {
      expect(() => validateRedirectTarget(url)).toThrow(RedirectError)
    })
  }
})

describe("redirect target validation", async () => {
  test("allows http and https", async () => {
    expect(validateRedirectTarget("https://example.com/").protocol).toBe("https:")
    expect(validateRedirectTarget("http://example.com/").protocol).toBe("http:")
  })

  test("rejects control characters (CRLF injection)", async () => {
    expect(() => validateRedirectTarget("https://example.com/\r\nSet-Cookie:evil=1")).toThrow(/control/)
    expect(() => validateRedirectTarget("https://example.com/\x00")).toThrow(/control/)
  })

  test("rejects oversized targets", async () => {
    expect(() => validateRedirectTarget("https://example.com/" + "a".repeat(9000))).toThrow(/maximum length/)
  })

  test("rejects malformed targets", async () => {
    expect(() => validateRedirectTarget("not-a-url")).toThrow()
    expect(() => validateRedirectTarget("")).toThrow()
  })
})

describe("payload limits", async () => {
  test("oversized payloads are rejected", async () => {
    await expectDecodeError("A".repeat(3000), "OVERSIZED_PAYLOAD")
  })

  test("encoding oversized urls fails validation", async () => {
    const long = "https://example.com/" + "a".repeat(9000)
    await expect(encodeUrl(long)).rejects.toThrow()
  })
})

describe("alphabet validation", async () => {
  test("invalid base64url characters are rejected", async () => {
    await expectDecodeError("abc$%", "INVALID_ALPHABET")
    await expectDecodeError("abc+/", "INVALID_ALPHABET")
  })

  test("padded base64url is rejected", async () => {
    await expectDecodeError("abcd=", "INVALID_ALPHABET")
  })

  test("non-canonical base64url leftover bits are rejected", async () => {
    const bytes = encodeSpecialized(canonicalize("https://example.com/canonical").model, 0)
    const encoded = base64UrlEncode(bytes)
    await expect(decodePayloadString(encoded + "a")).rejects.toBeInstanceOf(DecodeError)
    await expect(decodePayloadString(encoded + "$")).rejects.toBeInstanceOf(DecodeError)
    await expect(decodePayloadString(encoded.slice(0, -1))).rejects.toBeInstanceOf(DecodeError)
  })

  test("empty payload is rejected", async () => {
    await expectDecodeError("", "INVALID_ALPHABET")
  })

  test("invalid base32 characters are rejected", async () => {
    await expectDecodeError("1234*67890", "INVALID_ALPHABET")
    await expectDecodeError("uuuu", "UNKNOWN_FORMAT")
  })
})

describe("binary stream hardening", async () => {
  test("truncated streams are rejected", async () => {
    const bytes = encodeSpecialized(canonicalize("https://example.com/a/b/c?x=1#f").model, 0)
    await expectDecodeError(bytes.subarray(0, bytes.length - 2), "TRUNCATED")
  })

  test("trailing data is rejected", async () => {
    const bytes = encodeSpecialized(canonicalize("https://example.com/").model, 0)
    const padded = new Uint8Array(bytes.length + 1)
    padded.set(bytes)
    padded[bytes.length] = 0x41
    await expectDecodeError(padded, "TRAILING_DATA")
  })

  test("invalid dictionary id is rejected", async () => {
    const w = new ByteWriter()
    w.byte(formatByte("specialized", 0))
    w.byte(0)
    w.byte(Opcode.HOST_FULL)
    w.varint(99999)
    await expectDecodeError(w.finish(), "INVALID_DICT_ID")
  })

  test("unknown format byte is rejected", async () => {
    await expectDecodeError(new Uint8Array([0xc0, 0x00]), "UNKNOWN_FORMAT")
    await expectDecodeError(new Uint8Array([0x02, 0x00]), "UNKNOWN_FORMAT")
    await expectDecodeError(new Uint8Array([0x41, 0x00]), "UNKNOWN_FORMAT")
  })

  test("oversized specialized format version is rejected", async () => {
    const w = new ByteWriter()
    w.byte(formatByte("specialized", 2))
    w.byte(0)
    await expectDecodeError(w.finish(), "UNKNOWN_FORMAT")
  })

  test("huffman format v1 rejects truncated bit stream and bad padding", async () => {
    const { canonicalize: canon } = await import("@/lib/url/normalize")
    const { encodeSpecialized: enc } = await import("@/lib/codec/specialized")
    const { huffmanV1 } = await import("@/lib/codec/huffman")
    const { model } = canon("https://some-host.example/with/literal/segments/only")
    const full = enc(model, 1, { huffman: huffmanV1() })
    await expect(decodePayloadBytes(full.subarray(0, full.length - 1))).rejects.toBeInstanceOf(DecodeError)
    await expect(decodePayloadBytes(full.subarray(0, 2))).rejects.toBeInstanceOf(DecodeError)
    const padded = new Uint8Array(full.length + 1)
    padded.set(full)
    padded[full.length] = 0xff
    await expectDecodeError(padded, "TRAILING_DATA")
  })

  test("encryption flag is rejected", async () => {
    const w = new ByteWriter()
    w.byte(formatByte("specialized", 0))
    w.byte(0b1000_0000)
    await expectDecodeError(w.finish(), "ENCRYPTION_NOT_SUPPORTED")
  })

  test("malformed (never-terminating) varint is rejected", async () => {
    const w = new ByteWriter()
    w.byte(formatByte("specialized", 0))
    w.byte(0)
    w.byte(Opcode.LITERAL_BYTES)
    for (let i = 0; i < 6; i++) w.byte(0x80)
    await expectDecodeError(w.finish(), "MALFORMED_VARINT")
  })

  test("non-minimal varint is rejected", async () => {
    const w = new ByteWriter()
    w.byte(formatByte("specialized", 0))
    w.byte(0)
    w.byte(Opcode.LITERAL_BYTES)
    w.byte(0x81)
    w.byte(0x00)
    await expectDecodeError(w.finish(), "MALFORMED_VARINT")
  })

  test("port overflow is rejected", async () => {
    const w = new ByteWriter()
    w.byte(formatByte("specialized", 0))
    w.byte(0b0000_0010)
    w.byte(Opcode.LITERAL_BYTES)
    w.byte(11)
    w.bytes(new TextEncoder().encode("example.com"))
    w.byte(Opcode.END)
    w.byte(Opcode.PORT)
    w.varint(70000)
    await expectDecodeError(w.finish(), "VALUE_OUT_OF_RANGE")
  })

  test("invalid path segment count is rejected", async () => {
    const w = new ByteWriter()
    w.byte(formatByte("specialized", 0))
    w.byte(0)
    w.byte(Opcode.LITERAL_BYTES)
    w.byte(11)
    w.bytes(new TextEncoder().encode("example.com"))
    w.byte(Opcode.END)
    w.varint(5000)
    await expectDecodeError(w.finish(), "LIMIT_EXCEEDED")
  })

  test("invalid UTF-8 in literals is rejected", async () => {
    const w = new ByteWriter()
    w.byte(formatByte("specialized", 0))
    w.byte(0)
    w.byte(Opcode.LITERAL_BYTES)
    w.byte(2)
    w.bytes(new Uint8Array([0xff, 0xfe]))
    w.byte(Opcode.END)
    w.varint(0)
    await expectDecodeError(w.finish(), "INVALID_UTF8")
  })
})

describe("decompression guards", async () => {
  test("deflate zip bomb is capped", async () => {
    const bomb = zlib.deflateRawSync(Buffer.alloc(1024 * 1024, 0x41))
    const w = new ByteWriter()
    w.byte(formatByte("deflate", 0))
    w.byte(0)
    w.bytes(new Uint8Array(bomb))
    await expectDecodeError(w.finish(), "DECOMPRESSED_TOO_LARGE")
  })

  test("garbage compressed data is rejected", async () => {
    const w = new ByteWriter()
    w.byte(formatByte("brotli", 0))
    w.byte(0)
    w.bytes(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]))
    await expectDecodeError(w.finish(), "DECOMPRESSION_FAILED")
  })
})

describe("human-mode checksum", async () => {
  const url = "https://example.com/checksum-test"

  function corruptOneChar(s: string): string {
    const chars = [...s]
    const idx = chars.findIndex((c, i) => i > 2 && c !== "-")
    const replacement = chars[idx] === "0" ? "1" : "0"
    chars[idx] = replacement
    return chars.join("")
  }

  test("single substitution is detected", async () => {
    const result = await encodeUrl(url)
    const corrupted = corruptOneChar(result.humanPayload)
    try {
      await decodePayloadString(corrupted)
      throw new Error("expected failure")
    } catch (e) {
      if (!(e instanceof DecodeError)) throw e
      expect(["CHECKSUM_FAILED", "UNKNOWN_FORMAT", "INVALID_ALPHABET"]).toContain(e.code)
    }
    // correction is offered only when unique; must never suggest a wrong payload
    const suggestion = suggestHumanCorrection(corrupted)
    if (suggestion !== null) {
      expect(suggestion).toBe(result.humanPayload)
    }
  })

  test("deletion is detected", async () => {
    const result = await encodeUrl(url)
    const stripped = result.humanPayload.replace(/-/g, "")
    const deleted = stripped.slice(0, 3) + stripped.slice(4)
    try {
      await decodePayloadString(deleted)
      throw new Error("expected failure")
    } catch (e) {
      if (!(e instanceof DecodeError)) throw e
      expect(["CHECKSUM_FAILED", "INVALID_ALPHABET"]).toContain(e.code)
    }
  })

  test("transposition is detected", async () => {
    const result = await encodeUrl(url)
    const stripped = result.humanPayload.replace(/-/g, "")
    const swapped = stripped.slice(0, 3) + stripped[4] + stripped[3] + stripped.slice(5)
    if (swapped === stripped) return
    try {
      await decodePayloadString(swapped)
      throw new Error("expected failure")
    } catch (e) {
      if (!(e instanceof DecodeError)) throw e
      expect(["CHECKSUM_FAILED", "UNKNOWN_FORMAT", "INVALID_ALPHABET"]).toContain(e.code)
    }
  })

  test("correction suggestion is either unique-fix or none", async () => {
    const result = await encodeUrl(url)
    const corrupted = corruptOneChar(result.humanPayload)
    const suggestion = suggestHumanCorrection(corrupted)
    if (suggestion !== null) {
      expect(suggestion).toBe(result.humanPayload)
    }
  })

  test("human payload groups never contain ambiguous characters", async () => {
    const result = await encodeUrl(url)
    const data = result.humanPayload.replace(/-/g, "")
    expect(data).not.toMatch(/[ilou]/)
  })

  test("human payload that also parses as base64url still decodes via base32", async () => {
    const { model } = canonicalize("https://example.com/fixture")
    const bytes = encodeSpecialized(model, 0)
    const payload = humanEncode(bytes)
    const decoded = await decodePayloadString(payload)
    expect(decoded.via).toBe("base32")
    expect(decoded.target).toBe("https://example.com/fixture")
  })
})

describe("rate limiting", async () => {
  test("limits after configured count within window", async () => {
    resetRateLimits()
    const key = "test-ip-1"
    expect(checkRateLimit(key, 3)).toBe(true)
    expect(checkRateLimit(key, 3)).toBe(true)
    expect(checkRateLimit(key, 3)).toBe(true)
    expect(checkRateLimit(key, 3)).toBe(false)
  })

  test("independent keys are independent", async () => {
    resetRateLimits()
    expect(checkRateLimit("a", 1)).toBe(true)
    expect(checkRateLimit("b", 1)).toBe(true)
    expect(checkRateLimit("a", 1)).toBe(false)
  })
})
