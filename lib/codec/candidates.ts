import { config } from "../config"
import { canonicalize } from "../url/normalize"
import { validateModelLimits } from "../url/validate"
import { toUrl } from "../url/model"
import { DictionaryVersionError, getDictionaries, isSupportedDictionaryVersion, supportedDictionaryVersions } from "../dictionaries/version"
import { decodeSpecialized, encodeSpecialized } from "./specialized"
import { huffmanV1 } from "./huffman"
import { rcModel, RcLiteralReader } from "./rangecoder"
import { BitReader } from "./bit"
import { brotliCompress, brotliDecompressToString, sharedBrotliCompress, sharedBrotliDecompressToString } from "./brotli"
import { deflateCompress, deflateDecompressToString } from "./deflate"
import { ByteWriter } from "./writer"
import { ByteReader } from "./reader"
import { modelFromUrlString } from "./raw"
import { base64UrlDecode, base64UrlEncode } from "../alphabet/base64url"
import { humanDecode, humanEncode } from "../alphabet/base32"
import { voiceDecode, voiceEncode, looksLikeVoice } from "../alphabet/voice"
import {
  DecodeError,
  FLAG_DICT_VERSION_EXT,
  FLAG_ENCRYPTION,
  FormatFamily,
  PayloadCandidate,
  formatByte,
  parseFormatByte,
} from "./types"

const utf8 = new TextEncoder()

const FAMILY_PREFERENCE: FormatFamily[] = ["specialized", "brotli", "deflate"]

export interface EncodeOptions {
  aggressive?: boolean
  dictVersion?: number
}

export interface EncodeResult {
  originalUrl: string
  canonical: string
  candidates: PayloadCandidate[]
  best: PayloadCandidate
  ultraPayload: string
  humanPayload: string
  voicePayload: string
  ultraUrlLength: number
  humanUrlLength: number
  voiceUrlLength: number
  warning: boolean
}

export function compressFamilyPayload(family: "brotli" | "deflate", canonical: string): Uint8Array {
  const data = utf8.encode(canonical)
  const compressed = family === "brotli" ? brotliCompress(data) : deflateCompress(data)
  const w = new ByteWriter()
  w.byte(formatByte(family, 0))
  w.byte(0)
  w.bytes(compressed)
  return w.finish()
}

export async function sharedBrotliFamilyPayload(canonical: string): Promise<Uint8Array> {
  const data = utf8.encode(canonical)
  const compressed = await sharedBrotliCompress(data)
  const w = new ByteWriter()
  w.byte(formatByte("brotli", 1))
  w.byte(0)
  w.bytes(compressed)
  return w.finish()
}

export interface DecodedPayload {
  target: string
  family: FormatFamily
  formatVersion: number
  dictionaryVersion: number
  encrypted?: boolean
}

export async function decodePayloadBytes(bytes: Uint8Array): Promise<DecodedPayload> {
  const r = new ByteReader(bytes)
  const b0 = r.readByte()
  const fmt = parseFormatByte(b0)
  if (fmt === null) {
    throw new DecodeError("UNKNOWN_FORMAT", `unsupported format byte: 0x${b0.toString(16)}`)
  }
  if (fmt.family !== "specialized" && fmt.family !== "encrypted" && fmt.family !== "brotli" && fmt.version !== 0) {
    throw new DecodeError("UNKNOWN_FORMAT", `unsupported ${fmt.family} format version: ${fmt.version}`)
  }
  if (fmt.family === "specialized" && fmt.version > 2) {
    throw new DecodeError("UNKNOWN_FORMAT", `unsupported specialized format version: ${fmt.version}`)
  }
  if (fmt.family === "brotli" && fmt.version > 1) {
    throw new DecodeError("UNKNOWN_FORMAT", `unsupported brotli format version: ${fmt.version}`)
  }
  const flags = r.readByte()
  if (flags & FLAG_ENCRYPTION) {
    throw new DecodeError("ENCRYPTION_NOT_SUPPORTED", "encryption flag is reserved; use the encrypted format family")
  }
  let dictionaryVersion = 0
  if (flags & FLAG_DICT_VERSION_EXT) {
    dictionaryVersion = r.readVarint()
  }

  if (fmt.family === "encrypted") {
    if (fmt.version !== 0) {
      throw new DecodeError("UNKNOWN_FORMAT", `unsupported encrypted format version: ${fmt.version}`)
    }
    const envelope = r.rest()
    if (envelope.length > config.maxDecompressedBytes + 4096) {
      throw new DecodeError("OVERSIZED_PAYLOAD", "encrypted payload too large")
    }
    const { decryptPayload } = await import("../crypto/encryption")
    const inner = await decryptPayload(envelope)
    const decoded = await decodePayloadBytes(inner)
    if (decoded.family === "encrypted") {
      throw new DecodeError("INVALID_OPCODE", "nested encrypted payloads are not allowed")
    }
    return { ...decoded, encrypted: true }
  }

  if (fmt.family === "specialized") {
    let set
    try {
      set = getDictionaries(dictionaryVersion)
    } catch (e) {
      if (e instanceof DictionaryVersionError) {
        throw new DecodeError("INVALID_DICT_VERSION", e.message)
      }
      throw e
    }
    const reader =
      fmt.version === 1
        ? (new BitReader(r.rest(), huffmanV1()) as never)
        : fmt.version === 2
          ? new RcLiteralReader(r, r.readBytes(r.readVarint()), rcModel())
          : r
    const model = decodeSpecialized(reader, flags, set)
    return { target: toUrl(model), family: fmt.family, formatVersion: fmt.version, dictionaryVersion }
  }

  const rest = r.rest()
  const urlStr =
    fmt.family === "brotli"
      ? fmt.version === 1
        ? await sharedBrotliDecompressToString(rest)
        : await brotliDecompressToString(rest)
      : await deflateDecompressToString(rest)
  try {
    const model = modelFromUrlString(urlStr)
    return { target: toUrl(model), family: fmt.family, formatVersion: fmt.version, dictionaryVersion: 0 }
  } catch {
    throw new DecodeError("INVALID_TARGET", "decompressed payload is not a valid http(s) URL")
  }
}

export interface DecodedVia extends DecodedPayload {
  via: "base64url" | "base32" | "voice"
}

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/

export async function decodePayloadString(payload: string): Promise<DecodedVia> {
  if (payload.length === 0) {
    throw new DecodeError("INVALID_ALPHABET", "empty payload")
  }
  if (payload.length > config.maxPayloadLength + 64) {
    throw new DecodeError("OVERSIZED_PAYLOAD", "payload exceeds maximum length")
  }
  const errors: DecodeError[] = []
  if (BASE64URL_RE.test(payload)) {
    try {
      const bytes = base64UrlDecode(payload)
      const decoded = await decodePayloadBytes(bytes)
      return { ...decoded, via: "base64url" }
    } catch (e) {
      if (e instanceof DecodeError) errors.push(e)
      else throw e
    }
  }
  try {
    const bytes = humanDecode(payload)
    const decoded = await decodePayloadBytes(bytes)
    return { ...decoded, via: "base32" }
  } catch (e) {
    if (e instanceof DecodeError) errors.push(e)
    else throw e
  }
  if (looksLikeVoice(payload)) {
    try {
      const bytes = voiceDecode(payload)
      const decoded = await decodePayloadBytes(bytes)
      return { ...decoded, via: "voice" }
    } catch (e) {
      if (e instanceof DecodeError) errors.push(e)
      else throw e
    }
  }
  const meaningful = errors.find((e) => e.code !== "INVALID_ALPHABET")
  throw meaningful ?? errors[0] ?? new DecodeError("INVALID_ALPHABET", "undecodable payload")
}

function resolveDictionaryVersion(requested: number): number {
  if (isSupportedDictionaryVersion(requested)) return requested
  const older = supportedDictionaryVersions.filter((v) => v <= requested)
  return older.length > 0 ? older[older.length - 1] : supportedDictionaryVersions[0]
}

export async function encodeUrl(input: string, options: EncodeOptions = {}): Promise<EncodeResult> {
  const { model, canonical } = canonicalize(input, { aggressive: options.aggressive })
  validateModelLimits(model)
  const dictVersion = resolveDictionaryVersion(options.dictVersion ?? config.activeDictionaryVersion)

  const drafts: PayloadCandidate[] = [
    { format: "specialized", version: 0, bytes: encodeSpecialized(model, dictVersion), canonical },
    { format: "specialized", version: 1, bytes: encodeSpecialized(model, dictVersion, { huffman: huffmanV1() }), canonical },
    { format: "brotli", version: 0, bytes: compressFamilyPayload("brotli", canonical), canonical },
    { format: "deflate", version: 0, bytes: compressFamilyPayload("deflate", canonical), canonical },
  ]
  try {
    drafts.push({
      format: "brotli",
      version: 1,
      bytes: await sharedBrotliFamilyPayload(canonical),
      canonical,
    })
  } catch {
    // wasm shared-brotli unavailable on this runtime; skip the candidate
  }

  const candidates: PayloadCandidate[] = []
  for (const draft of drafts) {
    try {
      const decoded = await decodePayloadBytes(draft.bytes)
      if (decoded.target === canonical) {
        candidates.push({ ...draft, canonical: decoded.target })
      }
    } catch {
      // candidate failed verification; excluded from selection
    }
  }
  if (candidates.length === 0) {
    throw new Error(`no verified candidate for canonical URL: ${canonical}`)
  }

  candidates.sort(
    (a, b) =>
      a.bytes.length - b.bytes.length ||
      FAMILY_PREFERENCE.indexOf(a.format) - FAMILY_PREFERENCE.indexOf(b.format) ||
      a.version - b.version,
  )
  const best = candidates[0]

  const ultraPayload = base64UrlEncode(best.bytes)
  const humanPayload = humanEncode(best.bytes)
  const voicePayload = voiceEncode(best.bytes)
  const originLength = config.publicOrigin.length
  const ultraUrlLength = originLength + 1 + ultraPayload.length
  const humanUrlLength = originLength + 1 + humanPayload.length
  const voiceUrlLength = originLength + 1 + voicePayload.length

  return {
    originalUrl: input,
    canonical,
    candidates,
    best,
    ultraPayload,
    humanPayload,
    voicePayload,
    ultraUrlLength,
    humanUrlLength,
    voiceUrlLength,
    warning: ultraUrlLength >= input.length,
  }
}

/** Private mode: AES-GCM-wrap the best verified candidate (format family 11). */
export async function encryptCandidate(result: EncodeResult): Promise<string> {
  const { encryptPayload, PrivateModeError } = await import("../crypto/encryption")
  const header = new ByteWriter()
  header.byte(formatByte("encrypted", 0))
  header.byte(0)
  let envelope: Uint8Array
  try {
    envelope = await encryptPayload(result.best.bytes)
  } catch (e) {
    if (e instanceof PrivateModeError) {
      throw new DecodeError("KEY_UNAVAILABLE", e.message)
    }
    throw e
  }
  const out = new Uint8Array(2 + envelope.length)
  out.set(header.finish())
  out.set(envelope, 2)
  return base64UrlEncode(out)
}

export function completeUrlLength(payloadLength: number): number {
  return config.publicOrigin.length + 1 + payloadLength
}
