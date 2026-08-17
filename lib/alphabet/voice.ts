import { VOICE_WORDS, voiceWord, voiceIndex } from "./wordlist"
import { DecodeError } from "../codec/types"
import { config } from "../config"

/**
 * Voice mode (spec §2): each byte becomes one word from the frozen 256-word
 * list (8 bits/word), plus a final position-weighted checksum word. Longer
 * than every other mode by design — the value is dictation and readability,
 * not density. Case-insensitive; hyphen-separated; still fully stateless.
 */

const VOICE_RE = /^[a-z]+(-[a-z]+)+$/

function checksumIndex(data: Uint8Array): number {
  let sum = 0
  for (let i = 0; i < data.length; i++) {
    sum = (sum + (i + 1) * (data[i] + 1)) & 0xff
  }
  return sum & 0xff
}

export function voiceEncode(bytes: Uint8Array): string {
  const words: string[] = []
  for (const b of bytes) words.push(voiceWord(b))
  words.push(voiceWord(checksumIndex(bytes)))
  return words.join("-")
}

export function voiceDecode(payload: string): Uint8Array {
  const normalized = payload.trim().toLowerCase()
  const stripped = normalized.replace(/-/g, "-")
  if (stripped.length === 0 || stripped.length > config.maxPayloadLength * 6) {
    throw new DecodeError("OVERSIZED_PAYLOAD", "voice payload too long")
  }
  const parts = normalized.split("-").filter((p) => p.length > 0)
  if (parts.length < 2) {
    throw new DecodeError("INVALID_ALPHABET", "voice payload needs at least two words")
  }
  const indices: number[] = []
  for (const part of parts) {
    const idx = voiceIndex(part)
    if (idx === undefined) {
      throw new DecodeError("INVALID_ALPHABET", `unknown voice word: ${part}`)
    }
    indices.push(idx)
  }
  const dataIndices = indices.slice(0, -1)
  const provided = indices[indices.length - 1]
  const data = Uint8Array.from(dataIndices)
  if (checksumIndex(data) !== provided) {
    throw new DecodeError("CHECKSUM_FAILED", "voice checksum mismatch")
  }
  return data
}

export function looksLikeVoice(payload: string): boolean {
  return VOICE_RE.test(payload.trim().toLowerCase())
}
