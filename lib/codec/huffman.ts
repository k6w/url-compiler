import huffmanV1Lengths from "../../data/dictionaries/huffman-v1.json"
import type { BitReader } from "./bit"

/** Structural writer dependency: BitWriter and test doubles satisfy this. */
export interface BitOutput {
  writeBits(value: number, count: number): unknown
}

export const ESCAPE_SYMBOL = 256
export const SYMBOL_COUNT = 257
export const HUFFMAN_TABLE_VERSION = 1

/**
 * Canonical Huffman codes built from a frozen code-length table
 * (data/dictionaries/huffman-v1.json). Symbols are assigned codes in order
 * (length asc, symbol asc) — the RFC 1951-style canonical construction — so
 * encoder and decoder derive identical codes from lengths alone. The table is
 * immutable: any change requires a new format version, never an edit here.
 */
export class HuffmanCodes {
  readonly codeLengths: Uint8Array
  private readonly encodeCodes: Uint32Array
  private readonly counts: Uint16Array
  private readonly offsets: Uint16Array
  private readonly symbols: Uint16Array

  constructor(lengths: ArrayLike<number>) {
    if (lengths.length !== SYMBOL_COUNT) {
      throw new Error(`huffman length table must have ${SYMBOL_COUNT} entries`)
    }
    const len = new Uint8Array(SYMBOL_COUNT)
    for (let i = 0; i < SYMBOL_COUNT; i++) {
      const l = lengths[i]
      if (!Number.isInteger(l) || l < 0 || l > 24) {
        throw new Error(`invalid code length ${l} for symbol ${i}`)
      }
      len[i] = l
    }
    if (len[ESCAPE_SYMBOL] === 0) {
      throw new Error("huffman table must define an escape symbol")
    }

    const maxLen = Math.max(...len)
    const counts = new Uint16Array(maxLen + 2)
    for (let i = 0; i < SYMBOL_COUNT; i++) {
      if (len[i] > 0) counts[len[i]]++
    }
    // canonical validity (Kraft equality check is on decode bounds)
    let code = 0
    const firstCode = new Uint32Array(maxLen + 2)
    for (let l = 1; l <= maxLen; l++) {
      code = (code + counts[l - 1]) << 1
      firstCode[l] = code
      if (counts[l] > 0 && firstCode[l] + counts[l] > 2 ** l) {
        throw new Error("over-subscribed huffman code lengths")
      }
    }
    if (code + counts[maxLen] !== 2 ** maxLen) {
      throw new Error("incomplete huffman code lengths (Kraft inequality violated)")
    }

    const symbols = new Uint16Array(SYMBOL_COUNT)
    let used = 0
    const offsets = new Uint16Array(maxLen + 2)
    const nextCode = firstCode.slice()
    const encodeCodes = new Uint32Array(SYMBOL_COUNT)
    for (let l = 1; l <= maxLen; l++) {
      offsets[l] = used
      for (let s = 0; s < SYMBOL_COUNT; s++) {
        if (len[s] === l) {
          symbols[used] = s
          encodeCodes[s] = nextCode[l]++
          used++
        }
      }
    }

    this.codeLengths = len
    this.encodeCodes = encodeCodes
    this.counts = counts
    this.offsets = offsets
    this.symbols = symbols
    this.firstCode = firstCode
  }

  private readonly firstCode: Uint32Array

  encodeByte(w: BitOutput, byte: number): void {
    const l = this.codeLengths[byte]
    if (l > 0) {
      w.writeBits(this.encodeCodes[byte], l)
      return
    }
    w.writeBits(this.encodeCodes[ESCAPE_SYMBOL], this.codeLengths[ESCAPE_SYMBOL])
    w.writeBits(byte, 8)
  }

  /** Returns the decoded byte, or -1 if the bit stream ended mid-symbol. */
  decodeByte(r: BitReader): number {
    let code = 0
    for (let l = 1; l < this.counts.length; l++) {
      const bit = r.tryReadBit()
      if (bit < 0) return -1
      code = (code << 1) | bit
      if (this.counts[l] > 0 && code >= this.firstCode[l] && code < this.firstCode[l] + this.counts[l]) {
        const symbol = this.symbols[this.offsets[l] + code - this.firstCode[l]]
        if (symbol === ESCAPE_SYMBOL) {
          let escaped = 0
          for (let i = 0; i < 8; i++) {
            const b = r.tryReadBit()
            if (b < 0) return -1
            escaped = (escaped << 1) | b
          }
          return escaped
        }
        return symbol
      }
    }
    // fell off the code space: corrupt stream
    return -1
  }

  bitLengthOf(byte: number): number {
    const l = this.codeLengths[byte]
    return l > 0 ? l : this.codeLengths[ESCAPE_SYMBOL] + 8
  }
}

let tableV1: HuffmanCodes | null = null

export function huffmanV1(): HuffmanCodes {
  if (tableV1 === null) {
    tableV1 = new HuffmanCodes(huffmanV1Lengths.lengths)
  }
  return tableV1
}
