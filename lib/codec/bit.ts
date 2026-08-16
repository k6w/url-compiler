import { DecodeError } from "./types"
import { zigzagDecode, zigzagEncode } from "./writer"
import { decodeUtf8Strict } from "./reader"
import type { HuffmanCodes } from "./huffman"

/**
 * MSB-first bit writer. `byte()` writes 8 bits, so the non-literal parts of
 * an instruction stream are byte-identical in order to the byte-oriented
 * format; only Huffman-coded literal content is sub-byte. `finish()` pads
 * the final partial byte with zero bits (never a full padding byte).
 */
export class BitWriter {
  private buf: number[] = []
  private bitBuf = 0
  private bitCount = 0
  private totalBits = 0

  writeBits(value: number, count: number): this {
    if (!Number.isInteger(value) || value < 0 || !Number.isInteger(count) || count < 0 || count > 31 || value >= 2 ** count) {
      throw new RangeError(`invalid bit write: ${count} bits for value ${value}`)
    }
    this.totalBits += count
    for (let i = count - 1; i >= 0; i--) {
      this.bitBuf = (this.bitBuf << 1) | ((value >>> i) & 1)
      this.bitCount++
      if (this.bitCount === 8) {
        this.buf.push(this.bitBuf)
        this.bitBuf = 0
        this.bitCount = 0
      }
    }
    return this
  }

  byte(b: number): this {
    if (b < 0 || b > 255 || !Number.isInteger(b)) throw new RangeError(`invalid byte: ${b}`)
    return this.writeBits(b, 8)
  }

  bytes(arr: Uint8Array): this {
    for (let i = 0; i < arr.length; i++) this.byte(arr[i])
    return this
  }

  varint(n: number): this {
    if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) {
      throw new RangeError(`varint out of range: ${n}`)
    }
    let v = n
    while (v >= 0x80) {
      this.byte((v & 0x7f) | 0x80)
      v = Math.floor(v / 128)
    }
    this.byte(v)
    return this
  }

  zigzag(n: number): this {
    return this.varint(zigzagEncode(n))
  }

  get bitLength(): number {
    return this.totalBits
  }

  get length(): number {
    return this.buf.length + (this.bitCount > 0 ? 1 : 0)
  }

  finish(): Uint8Array {
    if (this.bitCount > 0) {
      this.buf.push(this.bitBuf << (8 - this.bitCount))
      this.bitBuf = 0
      this.bitCount = 0
    }
    return Uint8Array.from(this.buf)
  }
}

/**
 * MSB-first bit reader over a byte payload, with ByteReader-compatible
 * methods so the specialized decoder is generic over both. Literal content
 * reads (`readLiteral`) decode through the provided Huffman table; all other
 * reads are 8-bit aligned groups.
 */
export class BitReader {
  private bitPos = 0
  private readonly totalBits: number

  constructor(
    private readonly bytes: Uint8Array,
    private readonly huffman: HuffmanCodes,
  ) {
    this.totalBits = bytes.length * 8
  }

  private readBit(): number {
    if (this.bitPos >= this.totalBits) throw new DecodeError("TRUNCATED", "unexpected end of bit stream")
    const byte = this.bytes[this.bitPos >>> 3]
    const bit = (byte >>> (7 - (this.bitPos & 7))) & 1
    this.bitPos++
    return bit
  }

  /** Non-throwing bit read for Huffman decoding: -1 at end of stream. */
  tryReadBit(): number {
    if (this.bitPos >= this.totalBits) return -1
    const byte = this.bytes[this.bitPos >>> 3]
    const bit = (byte >>> (7 - (this.bitPos & 7))) & 1
    this.bitPos++
    return bit
  }

  readBits(count: number): number {
    let v = 0
    for (let i = 0; i < count; i++) v = (v << 1) | this.readBit()
    return v
  }

  eof(): boolean {
    return this.bitPos >= this.totalBits
  }

  peek(): number {
    if (this.totalBits - this.bitPos < 8) throw new DecodeError("TRUNCATED", "unexpected end of stream")
    const save = this.bitPos
    const b = this.readBits(8)
    this.bitPos = save
    return b
  }

  readByte(): number {
    return this.readBits(8)
  }

  readVarint(maxBytes = 5): number {
    let result = 0
    let count = 0
    let b = 0
    do {
      if (count >= maxBytes) {
        throw new DecodeError("MALFORMED_VARINT", "varint exceeds maximum length")
      }
      if (this.bitPos + 8 > this.totalBits) {
        throw new DecodeError("TRUNCATED", "varint extends past end of stream")
      }
      b = this.readByte()
      result += (b & 0x7f) * 2 ** (7 * count)
      count++
    } while (b & 0x80)
    if (count > 1 && (b & 0x7f) === 0) {
      throw new DecodeError("MALFORMED_VARINT", "non-minimal varint encoding")
    }
    if (result > 0xffffffff) {
      throw new DecodeError("VALUE_OUT_OF_RANGE", "varint exceeds 32-bit range")
    }
    return result
  }

  readZigzag(): number {
    return zigzagDecode(this.readVarint())
  }

  readBytes(n: number): Uint8Array {
    if (n < 0 || this.bitPos + n * 8 > this.totalBits) {
      throw new DecodeError("TRUNCATED", "requested bytes extend past end of stream")
    }
    const out = new Uint8Array(n)
    for (let i = 0; i < n; i++) out[i] = this.readByte()
    return out
  }

  /** Huffman-decoded literal content (format v1). */
  readLiteral(n: number): Uint8Array {
    if (n < 0) throw new DecodeError("TRUNCATED", "negative literal length")
    const out = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      out[i] = this.huffman.decodeByte(this)
      if (out[i] < 0) throw new DecodeError("TRUNCATED", "huffman literal extends past end of stream")
    }
    return out
  }

  /** Raw (non-literal) UTF-8 content: credentials, fragments. Byte-oriented. */
  readUtf8(n: number): string {
    return decodeUtf8Strict(this.readBytes(n))
  }

  expectEnd(): void {
    const remaining = this.totalBits - this.bitPos
    if (remaining === 0) return
    if (remaining >= 8) throw new DecodeError("TRAILING_DATA", "unexpected trailing bits")
    const save = this.bitPos
    while (this.bitPos < this.totalBits) {
      if (this.readBit() !== 0) {
        this.bitPos = save
        throw new DecodeError("TRAILING_DATA", "nonzero padding bits after stream end")
      }
    }
  }
}
