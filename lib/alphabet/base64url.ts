import { config } from "../config"
import { DecodeError } from "../codec/types"

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/

export function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url")
}

export function base64UrlDecode(payload: string): Uint8Array {
  if (!BASE64URL_RE.test(payload)) {
    throw new DecodeError("INVALID_ALPHABET", "invalid base64url character")
  }
  if (payload.length > config.maxPayloadLength) {
    throw new DecodeError("OVERSIZED_PAYLOAD", "payload exceeds maximum length")
  }
  const buf = Buffer.from(payload, "base64url")
  const bytes = new Uint8Array(buf)
  if (base64UrlEncode(bytes) !== payload) {
    throw new DecodeError("INVALID_ALPHABET", "non-canonical base64url encoding")
  }
  return bytes
}
