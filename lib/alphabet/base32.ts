import { base32ValueOf, base32Char } from "./alphabet32"
import { checksumChars, checkCountFor } from "./checksum"
import { config } from "../config"
import { DecodeError } from "../codec/types"

export function base32Encode(bytes: Uint8Array): string {
  let acc = 0
  let accBits = 0
  let out = ""
  for (let i = 0; i < bytes.length; i++) {
    acc = (acc << 8) | bytes[i]
    accBits += 8
    while (accBits >= 5) {
      const shift = accBits - 5
      out += base32Char((acc >>> shift) & 31)
      accBits = shift
      acc &= accBits === 0 ? 0 : (1 << accBits) - 1
    }
  }
  if (accBits > 0) {
    out += base32Char((acc << (5 - accBits)) & 31)
  }
  return out
}

export function mapToCanonicalBase32(payload: string): string {
  let out = ""
  for (const c of payload.toLowerCase()) {
    const v = base32ValueOf(c)
    if (v === undefined) throw new DecodeError("INVALID_ALPHABET", `invalid base32 character: ${c}`)
    out += base32Char(v)
  }
  return out
}

export function base32Decode(mapped: string): Uint8Array {
  const bytes: number[] = []
  let acc = 0
  let accBits = 0
  for (const c of mapped) {
    const v = base32ValueOf(c)
    if (v === undefined) throw new DecodeError("INVALID_ALPHABET")
    acc = (acc << 5) | v
    accBits += 5
    if (accBits >= 8) {
      const shift = accBits - 8
      bytes.push((acc >>> shift) & 0xff)
      accBits = shift
      acc &= accBits === 0 ? 0 : (1 << accBits) - 1
    }
  }
  if (accBits > 0 && acc !== 0) {
    throw new DecodeError("INVALID_ALPHABET", "non-canonical base32 padding bits")
  }
  if (base32Encode(Uint8Array.from(bytes)) !== mapped) {
    throw new DecodeError("INVALID_ALPHABET", "non-canonical base32 encoding")
  }
  return Uint8Array.from(bytes)
}

export function groupBase32(s: string): string {
  return s.replace(/(.{4})/g, "$1-").replace(/-$/, "")
}

export function ungroupBase32(s: string): string {
  return s.replace(/-/g, "")
}

export function humanEncode(bytes: Uint8Array): string {
  const data = base32Encode(bytes)
  return groupBase32(data + checksumChars(data))
}

export function humanDecode(payload: string): Uint8Array {
  const stripped = ungroupBase32(payload)
  if (stripped.length === 0) throw new DecodeError("INVALID_ALPHABET", "empty payload")
  if (stripped.length > config.maxPayloadLength) {
    throw new DecodeError("OVERSIZED_PAYLOAD", "payload exceeds maximum length")
  }
  const mapped = mapToCanonicalBase32(stripped)
  const n = mapped.length
  const checkCount = n <= 17 ? 1 : 2
  const data = mapped.slice(0, n - checkCount)
  const provided = mapped.slice(n - checkCount)
  if (data.length === 0) throw new DecodeError("INVALID_ALPHABET", "missing data characters")
  if (checkCountFor(data.length) !== checkCount) {
    throw new DecodeError("INVALID_ALPHABET", "inconsistent checksum length")
  }
  const expected = checksumChars(data)
  if (provided !== expected) {
    throw new DecodeError("CHECKSUM_FAILED", "human-mode checksum mismatch")
  }
  return base32Decode(data)
}

export function suggestHumanCorrection(payload: string): string | null {
  const stripped = ungroupBase32(payload).toLowerCase()
  if (stripped.length === 0 || stripped.length > 64) return null
  const tried = new Set<string>()
  const passing = new Set<string>()
  const consider = (candidate: string) => {
    if (tried.has(candidate)) return
    tried.add(candidate)
    try {
      const bytes = humanDecode(candidate)
      void bytes
      passing.add(candidate)
    } catch {
      // not a valid correction
    }
  }
  for (let i = 0; i < stripped.length; i++) {
    for (let v = 0; v < 32; v++) {
      consider(stripped.slice(0, i) + base32Char(v) + stripped.slice(i + 1))
    }
    consider(stripped.slice(0, i) + stripped.slice(i + 1))
    if (i + 1 < stripped.length && stripped[i] !== stripped[i + 1]) {
      consider(stripped.slice(0, i) + stripped[i + 1] + stripped[i] + stripped.slice(i + 2))
    }
  }
  for (let i = 0; i <= stripped.length; i++) {
    for (let v = 0; v < 32; v++) {
      consider(stripped.slice(0, i) + base32Char(v) + stripped.slice(i))
    }
  }
  if (passing.size === 1) {
    return groupBase32([...passing][0])
  }
  return null
}
