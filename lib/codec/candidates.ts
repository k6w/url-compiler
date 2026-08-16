import { config } from "../config"
import { canonicalize } from "../url/normalize"
import { validateModelLimits } from "../url/validate"
import { toUrl } from "../url/model"
import { DictionaryVersionError, getDictionaries, isSupportedDictionaryVersion, supportedDictionaryVersions } from "../dictionaries/version"
import { decodeSpecialized, encodeSpecialized } from "./specialized"
import { huffmanV1 } from "./huffman"
import { BitReader } from "./bit"
import { brotliCompress, brotliDecompressToString } from "./brotli"
import { deflateCompress, deflateDecompressToString } from "./deflate"
import { ByteWriter } from "./writer"
import { ByteReader } from "./reader"
import { modelFromUrlString } from "./raw"
import { base64UrlDecode, base64UrlEncode } from "../alphabet/base64url"
import { humanDecode, humanEncode } from "../alphabet/base32"
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
  ultraUrlLength: number
  humanUrlLength: number
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

export interface DecodedPayload {
  target: string
  family: FormatFamily
  formatVersion: number
  dictionaryVersion: number
}

export async function decodePayloadBytes(bytes: Uint8Array): Promise<DecodedPayload> {
  const r = new ByteReader(bytes)
  const b0 = r.readByte()
  const fmt = parseFormatByte(b0)
  if (fmt === null) {
    throw new DecodeError("UNKNOWN_FORMAT", `unsupported format byte: 0x${b0.toString(16)}`)
  }
  if (fmt.family !== "specialized" && fmt.version !== 0) {
    throw new DecodeError("UNKNOWN_FORMAT", `unsupported ${fmt.family} format version: ${fmt.version}`)
  }
  if (fmt.family === "specialized" && fmt.version > 1) {
    throw new DecodeError("UNKNOWN_FORMAT", `unsupported specialized format version: ${fmt.version}`)
  }
  const flags = r.readByte()
  if (flags & FLAG_ENCRYPTION) {
    throw new DecodeError("ENCRYPTION_NOT_SUPPORTED", "encrypted payloads are not supported in this release")
  }
  let dictionaryVersion = 0
  if (flags & FLAG_DICT_VERSION_EXT) {
    dictionaryVersion = r.readVarint()
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
    const reader = fmt.version === 1 ? (new BitReader(r.rest(), huffmanV1()) as never) : r
    const model = decodeSpecialized(reader, flags, set)
    return { target: toUrl(model), family: fmt.family, formatVersion: fmt.version, dictionaryVersion }
  }

  const rest = r.rest()
  const urlStr =
    fmt.family === "brotli" ? await brotliDecompressToString(rest) : await deflateDecompressToString(rest)
  try {
    const model = modelFromUrlString(urlStr)
    return { target: toUrl(model), family: fmt.family, formatVersion: fmt.version, dictionaryVersion: 0 }
  } catch {
    throw new DecodeError("INVALID_TARGET", "decompressed payload is not a valid http(s) URL")
  }
}

export interface DecodedVia extends DecodedPayload {
  via: "base64url" | "base32"
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
  const originLength = config.publicOrigin.length
  const ultraUrlLength = originLength + 1 + ultraPayload.length
  const humanUrlLength = originLength + 1 + humanPayload.length

  return {
    originalUrl: input,
    canonical,
    candidates,
    best,
    ultraPayload,
    humanPayload,
    ultraUrlLength,
    humanUrlLength,
    warning: ultraUrlLength >= input.length,
  }
}

export function completeUrlLength(payloadLength: number): number {
  return config.publicOrigin.length + 1 + payloadLength
}
