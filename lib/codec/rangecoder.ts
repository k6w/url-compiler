import { huffmanV1 } from "./huffman"
import { DecodeError } from "./types"
import type { Reader } from "./reader"
import { ByteReader } from "./reader"

/**
 * Static-model range coder (LZMA-SDK-style carry-handling rc) used by
 * specialized format v2. The frequency model is derived deterministically
 * from the frozen huffman-v1 code lengths (freq ∝ 2^(maxLen − len)), so v2
 * introduces no new frozen data — only a new interpretation. Every byte
 * symbol gets frequency ≥ 1, so there is no escape path; rare bytes simply
 * cost ≈ 16 bits.
 */

const RC_TOTAL_BITS = 16
export const RC_TOTAL = 1 << RC_TOTAL_BITS
const RC_TOP = 1 << 24
const SYMBOLS = 257

export interface FreqModel {
  freq: Uint32Array
  cum: Uint32Array
  total: number
}

let cachedModel: FreqModel | null = null

export function rcModel(): FreqModel {
  if (cachedModel !== null) return cachedModel
  const lengths = huffmanV1().codeLengths
  let maxLen = 0
  for (let i = 0; i < 256; i++) {
    if (lengths[i] > maxLen) maxLen = lengths[i]
  }
  const weights = new Float64Array(256)
  let heaviest = 0
  for (let i = 0; i < 256; i++) {
    weights[i] = lengths[i] > 0 ? 2 ** (maxLen - lengths[i]) : 0
    if (weights[i] > weights[heaviest]) heaviest = i
  }
  const freq = new Uint32Array(SYMBOLS)
  let assigned = 0
  for (let i = 0; i < 256; i++) {
    const scaled = weights[i] > 0 ? Math.max(1, Math.round((weights[i] * RC_TOTAL) / 2 ** maxLen)) : 1
    freq[i] = scaled
    assigned += scaled
  }
  if (assigned > RC_TOTAL) {
    const excess = assigned - RC_TOTAL
    const reduction = Math.ceil(excess / 256) + 1
    for (let i = 0; i < 256; i++) {
      const cut = Math.min(freq[i] - 1, reduction)
      freq[i] -= cut
      assigned -= cut
    }
    freq[heaviest] += RC_TOTAL - assigned
  } else {
    freq[heaviest] += RC_TOTAL - assigned
  }
  const cum = new Uint32Array(SYMBOLS + 1)
  for (let i = 0; i < SYMBOLS; i++) cum[i + 1] = cum[i] + freq[i]
  if (cum[SYMBOLS] !== RC_TOTAL) {
    throw new Error("range coder model normalization failed")
  }
  cachedModel = { freq, cum, total: RC_TOTAL }
  return cachedModel
}

export function rcBitsEstimate(model: FreqModel, bytes: Uint8Array): number {
  let bits = 0
  for (let i = 0; i < bytes.length; i++) {
    bits += Math.log2(RC_TOTAL / model.freq[bytes[i]])
  }
  return bits
}

class BoundedByteSource {
  private pos = 0
  constructor(private readonly bytes: Uint8Array) {}
  next(): number {
    if (this.pos >= this.bytes.length) {
      throw new DecodeError("TRUNCATED", "range coder read past end of literal pool")
    }
    return this.bytes[this.pos++]
  }
  get consumed(): number {
    return this.pos
  }
}

export class RangeEncoder {
  private low = 0
  private range = 0xFFFFFFFF
  readonly out: number[] = []

  private shiftLow(): void {
    if (this.low > 0xFFFFFFFF) {
      let i = this.out.length - 1
      while (i >= 0 && this.out[i] === 0xFF) {
        this.out[i] = 0x00
        i--
      }
      if (i >= 0) this.out[i] += 1
      else this.out.unshift(1)
      this.low -= 0x100000000
    }
    this.out.push(Math.floor(this.low / 0x1000000) & 0xFF)
    this.low = (this.low % 0x1000000) * 256
  }

  encodeSymbol(model: FreqModel, symbol: number): void {
    const r = Math.floor(this.range / model.total)
    this.low += r * model.cum[symbol]
    this.range = r * model.freq[symbol]
    while (this.range < RC_TOP) {
      this.range *= 256
      this.shiftLow()
    }
  }

  flush(): Uint8Array {
    for (let i = 0; i < 5; i++) this.shiftLow()
    return Uint8Array.from(this.out)
  }
}

export class RangeDecoder {
  private code = 0
  private range = 0xFFFFFFFF
  private source: BoundedByteSource | null = null

  private ensureStarted(pool: Uint8Array): void {
    if (this.source !== null) return
    this.source = new BoundedByteSource(pool)
    for (let i = 0; i < 4; i++) {
      this.code = this.code * 256 + this.source.next()
    }
  }

  decodeSymbol(model: FreqModel, pool: Uint8Array): number {
    this.ensureStarted(pool)
    while (this.range < RC_TOP) {
      this.range *= 256
      this.code = this.code * 256 + this.source!.next()
    }
    const r = Math.floor(this.range / model.total)
    let cum = Math.floor(this.code / r)
    if (cum >= model.total) cum = model.total - 1
    let lo = 0
    let hi = SYMBOLS - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (model.cum[mid] <= cum) lo = mid
      else hi = mid
    }
    this.code -= r * model.cum[lo]
    this.range = r * model.freq[lo]
    return lo
  }

  decodeBytes(model: FreqModel, pool: Uint8Array, count: number): Uint8Array {
    const out = new Uint8Array(count)
    for (let i = 0; i < count; i++) {
      out[i] = this.decodeSymbol(model, pool)
    }
    return out
  }

  get consumed(): number {
    return this.source === null ? 0 : this.source.consumed
  }
}

/**
 * Format v2 composite reader: instruction stream is byte-aligned on the
 * inner reader; literal content decodes from the range-coded pool.
 * Credentials and fragments stay raw (readUtf8 delegates to the inner
 * reader).
 */
export class RcLiteralReader implements Reader {
  private readonly rc = new RangeDecoder()

  constructor(
    private readonly instr: ByteReader,
    private readonly pool: Uint8Array,
    private readonly model: FreqModel,
  ) {}

  eof(): boolean {
    return this.instr.eof()
  }
  peek(): number {
    return this.instr.peek()
  }
  readByte(): number {
    return this.instr.readByte()
  }
  readVarint(maxBytes?: number): number {
    return this.instr.readVarint(maxBytes)
  }
  readZigzag(): number {
    return this.instr.readZigzag()
  }
  readBytes(n: number): Uint8Array {
    return this.instr.readBytes(n)
  }
  readUtf8(n: number): string {
    return this.instr.readUtf8(n)
  }
  readLiteral(n: number): Uint8Array {
    return this.rc.decodeBytes(this.model, this.pool, n)
  }
  expectEnd(): void {
    this.instr.expectEnd()
  }
}
