export type FormatFamily = "specialized" | "brotli" | "deflate"

export const FAMILY_BITS = {
  specialized: 0b00,
  brotli: 0b01,
  deflate: 0b10,
} as const

export const FAMILY_RESERVED = 0b11

export type FormatVersion = 0

export function formatByte(family: FormatFamily, version: number): number {
  return (FAMILY_BITS[family] << 6) | version
}

export function parseFormatByte(b: number): { family: FormatFamily; version: number } | null {
  const familyBits = b >>> 6
  if (familyBits === FAMILY_RESERVED) return null
  const family = (["specialized", "brotli", "deflate"] as const)[familyBits]
  return { family, version: b & 0x3f }
}

export const FLAG_HTTP = 0b0000_0001
export const FLAG_PORT = 0b0000_0010
export const FLAG_CREDENTIALS = 0b0000_0100
export const FLAG_QUERY = 0b0000_1000
export const FLAG_FRAGMENT = 0b0001_0000
export const FLAG_DICT_VERSION_EXT = 0b0010_0000
export const FLAG_CHECKSUM = 0b0100_0000
export const FLAG_ENCRYPTION = 0b1000_0000

export type DecodeErrorCode =
  | "UNKNOWN_FORMAT"
  | "UNSUPPORTED_FLAG"
  | "ENCRYPTION_NOT_SUPPORTED"
  | "TRUNCATED"
  | "TRAILING_DATA"
  | "INVALID_OPCODE"
  | "INVALID_DICT_ID"
  | "INVALID_DICT_VERSION"
  | "MALFORMED_VARINT"
  | "VALUE_OUT_OF_RANGE"
  | "INVALID_UTF8"
  | "LIMIT_EXCEEDED"
  | "INVALID_ALPHABET"
  | "CHECKSUM_FAILED"
  | "OVERSIZED_PAYLOAD"
  | "DECOMPRESSION_FAILED"
  | "DECOMPRESSED_TOO_LARGE"
  | "INVALID_TARGET"

export class DecodeError extends Error {
  constructor(public readonly code: DecodeErrorCode, message?: string) {
    super(message ?? code)
    this.name = "DecodeError"
  }
}

export class NotImplemented extends Error {
  constructor(what: string) {
    super(`not implemented: ${what}`)
    this.name = "NotImplemented"
  }
}

export interface PayloadCandidate {
  format: FormatFamily
  bytes: Uint8Array
  canonical: string
}
