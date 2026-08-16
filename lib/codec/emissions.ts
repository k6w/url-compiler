import { getDictionaries, DictionarySet, DictRef } from "../dictionaries/version"
import { Opcode, INLINE_DICTIONARY_BASE, INLINE_INTEGER_BASE, isInlineIntegerByte, varintLen, dictionaryRefCost } from "./opcodes"
import { ByteWriter, zigzagEncode } from "./writer"
import { ByteReader } from "./reader"
import { DecodeError } from "./types"
import { config } from "../config"

const utf8 = new TextEncoder()

export interface Emission {
  cost: number
  emit: (w: ByteWriter) => void
}

export function literalEmission(text: string): Emission {
  const bytes = utf8.encode(text)
  const cost = 1 + varintLen(bytes.length) + bytes.length
  return {
    cost,
    emit: (w) => {
      w.byte(Opcode.LITERAL_BYTES)
      w.varint(bytes.length)
      w.bytes(bytes)
    },
  }
}

export function dictRefEmission(opcode: number, id: number): Emission {
  return {
    cost: dictionaryRefCost(id),
    emit: (w) => {
      w.byte(opcode)
      w.varint(id)
    },
  }
}

export function inlineDictEmission(id: number): Emission {
  return {
    cost: 1,
    emit: (w) => w.byte(INLINE_DICTIONARY_BASE + id),
  }
}

export function contextDictEmission(opcode: number, id: number): Emission {
  return id < 32 ? inlineDictEmission(id) : dictRefEmission(opcode, id)
}

export function integerEmission(text: string): Emission | null {
  if (!/^(0|-?[1-9]\d*)$/.test(text)) return null
  const n = Number(text)
  if (n > 0x7fffffff || n < -0x80000000) return null
  if (n >= 0 && n <= 31) {
    return {
      cost: 1,
      emit: (w) => w.byte(INLINE_INTEGER_BASE + n),
    }
  }
  const z = zigzagEncode(n)
  return {
    cost: 1 + varintLen(z),
    emit: (w) => {
      w.byte(Opcode.INTEGER)
      w.zigzag(n)
    },
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const HEX_RE = /^[0-9a-f]+$/

export function uuidEmission(text: string): Emission | null {
  if (!UUID_RE.test(text)) return null
  const bytes = hexToBytes(text.replace(/-/g, ""))
  return {
    cost: 17,
    emit: (w) => {
      w.byte(Opcode.UUID)
      w.bytes(bytes)
    },
  }
}

export function hexEmission(text: string): Emission | null {
  if (text.length < 2 || text.length % 2 !== 0 || !HEX_RE.test(text)) return null
  const bytes = hexToBytes(text)
  return {
    cost: 1 + varintLen(bytes.length) + bytes.length,
    emit: (w) => {
      w.byte(Opcode.HEX_BYTES)
      w.varint(bytes.length)
      w.bytes(bytes)
    },
  }
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = ""
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0")
  return s
}

export function bytesToUuid(bytes: Uint8Array): string {
  const h = bytesToHex(bytes)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

export function cheapest(candidates: Emission[]): Emission {
  let best = candidates[0]
  for (const c of candidates) {
    if (c.cost < best.cost) best = c
  }
  return best
}

export function typedValueEmissions(text: string): Emission[] {
  const emissions: Emission[] = [literalEmission(text)]
  const int = integerEmission(text)
  if (int) emissions.push(int)
  const uuid = uuidEmission(text)
  if (uuid) emissions.push(uuid)
  const hex = hexEmission(text)
  if (hex) emissions.push(hex)
  return emissions
}

export function dictSet(version = 0): DictionarySet {
  return getDictionaries(version)
}

export function decodeTypedValue(r: ByteReader): string {
  const b = r.readByte()
  if (isInlineIntegerByte(b)) return String(b - INLINE_INTEGER_BASE)
  switch (b) {
    case Opcode.LITERAL_BYTES: {
      const len = r.readVarint()
      if (len > config.maxSegmentBytes) throw new DecodeError("LIMIT_EXCEEDED", "literal too large")
      return r.readUtf8(len)
    }
    case Opcode.INTEGER:
      return String(r.readZigzag())
    case Opcode.UUID:
      return bytesToUuid(r.readBytes(16))
    case Opcode.HEX_BYTES: {
      const count = r.readVarint()
      if (count > config.maxSegmentBytes) throw new DecodeError("LIMIT_EXCEEDED", "hex run too large")
      return bytesToHex(r.readBytes(count))
    }
    default:
      throw new DecodeError("INVALID_OPCODE", `opcode 0x${b.toString(16)} not allowed in template param`)
  }
}

export type { DictRef }
