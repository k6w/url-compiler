import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { encodeUrl, decodePayloadBytes, decodePayloadString, encryptCandidate } from "@/lib/codec/candidates"
import { DecodeError, DecodeErrorCode, formatByte } from "@/lib/codec/types"
import { generateEphemeralKey, encryptWithKey } from "@/lib/crypto/encryption"
import { voiceEncode, voiceDecode } from "@/lib/alphabet/voice"
import { VOICE_WORDS } from "@/lib/alphabet/wordlist"
import { ByteWriter } from "@/lib/codec/writer"
import { canonicalize } from "@/lib/url/normalize"

const KEY_A = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
const KEY_B = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")

describe("server-readable private mode (C1)", () => {
  beforeAll(() => {
    process.env.PAYLOAD_KEY_CURRENT = KEY_A
  })
  afterAll(() => {
    delete process.env.PAYLOAD_KEY_CURRENT
    delete process.env.PAYLOAD_KEY_PREVIOUS
  })

  test("encrypted payload round-trips and reports encrypted", async () => {
    const result = await encodeUrl("https://secret.example.com/private/path?token=x")
    const encrypted = await encryptCandidate(result)
    const decoded = await decodePayloadString(encrypted)
    expect(decoded.target).toBe(result.canonical)
    expect(decoded.encrypted).toBe(true)
    expect(decoded.via).toBe("base64url")
  })

  test("ciphertext differs from plaintext payload and is nontrivial", async () => {
    const result = await encodeUrl("https://secret.example.com/private/path")
    const encrypted = await encryptCandidate(result)
    expect(encrypted).not.toBe(result.ultraPayload)
    expect(encrypted.length).toBeGreaterThan(result.ultraPayload.length)
  })

  test("tampered ciphertext fails authentication", async () => {
    const result = await encodeUrl("https://secret.example.com/tamper")
    const encrypted = await encryptCandidate(result)
    const bytes = Buffer.from(encrypted, "base64url")
    bytes[bytes.length - 1] ^= 0xff
    const tampered = bytes.toString("base64url")
    await expect(decodePayloadString(tampered)).rejects.toMatchObject({ code: "DECRYPTION_FAILED" })
  })

  test("key rotation: old payloads decode via PAYLOAD_KEY_PREVIOUS", async () => {
    const result = await encodeUrl("https://secret.example.com/rotated")
    const encrypted = await encryptCandidate(result)
    process.env.PAYLOAD_KEY_CURRENT = KEY_B
    process.env.PAYLOAD_KEY_PREVIOUS = KEY_A
    try {
      const decoded = await decodePayloadString(encrypted)
      expect(decoded.target).toBe(result.canonical)
    } finally {
      process.env.PAYLOAD_KEY_CURRENT = KEY_A
      delete process.env.PAYLOAD_KEY_PREVIOUS
    }
  })

  test("wrong keys reject with DECRYPTION_FAILED", async () => {
    const result = await encodeUrl("https://secret.example.com/wrongkey")
    const encrypted = await encryptCandidate(result)
    process.env.PAYLOAD_KEY_CURRENT = KEY_B
    try {
      await expect(decodePayloadString(encrypted)).rejects.toMatchObject({ code: "DECRYPTION_FAILED" })
    } finally {
      process.env.PAYLOAD_KEY_CURRENT = KEY_A
    }
  })

  test("missing keys produce KEY_UNAVAILABLE", async () => {
    delete process.env.PAYLOAD_KEY_CURRENT
    delete process.env.PAYLOAD_KEY_PREVIOUS
    try {
      const w = new ByteWriter()
      w.byte(formatByte("encrypted", 0))
      w.byte(0)
      w.bytes(crypto.getRandomValues(new Uint8Array(48)))
      await expect(decodePayloadBytes(w.finish())).rejects.toMatchObject({ code: "KEY_UNAVAILABLE" })
    } finally {
      process.env.PAYLOAD_KEY_CURRENT = KEY_A
    }
  })

  test("nested encrypted payloads are rejected", async () => {
    const result = await encodeUrl("https://secret.example.com/nested")
    const once = Buffer.from(await encryptCandidate(result), "base64url")
    const envelope = await encryptWithKey(generateEphemeralKeySync(), new Uint8Array(once))
    const w = new ByteWriter()
    w.byte(formatByte("encrypted", 0))
    w.byte(0)
    w.bytes(envelope)
    await expect(decodePayloadBytes(w.finish())).rejects.toBeInstanceOf(DecodeError)
  })

  test("encrypted format version 1 is rejected", async () => {
    const w = new ByteWriter()
    w.byte(formatByte("encrypted", 1))
    w.byte(0)
    await expectDecodeError(w.finish(), "UNKNOWN_FORMAT")
  })
})

function generateEphemeralKeySync(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32))
}

async function expectDecodeError(bytes: Uint8Array, code: DecodeErrorCode) {
  try {
    await decodePayloadBytes(bytes)
    throw new Error(`expected DecodeError ${code}`)
  } catch (e) {
    if (e instanceof DecodeError) expect(e.code).toBe(code)
    else throw e
  }
}

describe("server-blind mode (C2 primitives)", () => {
  test("ephemeral-key envelope decrypts only with the right key", async () => {
    const key = await generateEphemeralKey()
    const { encryptWithKey: enc } = await import("@/lib/crypto/encryption")
    const message = new TextEncoder().encode("https://blind.example.com/destination")
    const envelope = await enc(key, message)

    const cryptoKey = await crypto.subtle.importKey("raw", key as BufferSource, { name: "AES-GCM" }, false, ["decrypt"])
    const nonce = envelope.subarray(0, 12)
    const ct = envelope.subarray(12)
    const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce as BufferSource }, cryptoKey, ct as BufferSource))
    expect(new TextDecoder().decode(plaintext)).toBe("https://blind.example.com/destination")

    const wrongKey = await crypto.subtle.importKey("raw", (await generateEphemeralKey()) as BufferSource, { name: "AES-GCM" }, false, ["decrypt"])
    await expect(crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce as BufferSource }, wrongKey, ct as BufferSource)).rejects.toThrow()
  })
})

describe("voice mode (D2)", () => {
  test("wordlist is frozen at 256 unique lowercase words", () => {
    expect(VOICE_WORDS.length).toBe(256)
    expect(new Set(VOICE_WORDS).size).toBe(256)
    for (const w of VOICE_WORDS) {
      expect(w).toMatch(/^[a-z]+$/)
      expect(w.length).toBeLessThanOrEqual(11)
    }
  })

  test("voice round-trips", async () => {
    const result = await encodeUrl("https://example.com/voice-check")
    const spoken = voiceEncode(Buffer.from(result.ultraPayload, "base64url"))
    const decoded = await decodePayloadString(spoken)
    expect(decoded.via).toBe("voice")
    expect(decoded.target).toBe(result.canonical)
  })

  test("voice is case-insensitive and hyphen tolerant", async () => {
    const result = await encodeUrl("https://example.com/voice-case")
    const spoken = voiceEncode(Buffer.from(result.ultraPayload, "base64url"))
    const upper = spoken.toUpperCase()
    const decoded = await decodePayloadString(upper)
    expect(decoded.target).toBe(result.canonical)
  })

  test("unknown word is rejected", () => {
    expect(() => voiceDecode("mango-zebrazz")).toThrow(/unknown voice word/)
  })

  test("checksum catches word substitution", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(8))
    const spoken = voiceEncode(bytes)
    const words = spoken.split("-")
    const idx = words.findIndex((w) => w !== VOICE_WORDS[0])
    words[idx] = VOICE_WORDS[(VOICE_WORDS.indexOf(words[idx]) + 7) % 256]
    expect(() => voiceDecode(words.join("-"))).toThrow(/checksum/)
  })

  test("single word and empty payloads are rejected", () => {
    expect(() => voiceDecode("mango")).toThrow(/at least two words/)
    expect(() => voiceDecode("")).toThrow()
  })
})
