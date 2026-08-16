import { DecodeError } from "./types"
import { zigzagDecode } from "./writer"

const utf8Decoder = new TextDecoder("utf-8", { fatal: true })

export class ByteReader {
  constructor(
    private readonly buf: Uint8Array,
    private pos = 0,
  ) {}

  eof(): boolean {
    return this.pos >= this.buf.length
  }

  peek(): number {
    if (this.eof()) throw new DecodeError("TRUNCATED", "unexpected end of stream")
    return this.buf[this.pos]
  }

  readByte(): number {
    if (this.eof()) throw new DecodeError("TRUNCATED", "unexpected end of stream")
    return this.buf[this.pos++]
  }

  readVarint(maxBytes = 5): number {
    let result = 0
    let count = 0
    let b = 0
    do {
      if (count >= maxBytes) {
        throw new DecodeError("MALFORMED_VARINT", "varint exceeds maximum length")
      }
      if (this.pos >= this.buf.length) {
        throw new DecodeError("TRUNCATED", "varint extends past end of stream")
      }
      b = this.buf[this.pos++]
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
    if (n < 0 || this.pos + n > this.buf.length) {
      throw new DecodeError("TRUNCATED", "requested bytes extend past end of stream")
    }
    const out = this.buf.subarray(this.pos, this.pos + n)
    this.pos += n
    return out
  }

  rest(): Uint8Array {
    return this.buf.subarray(this.pos)
  }

  readUtf8(n: number): string {
    const bytes = this.readBytes(n)
    try {
      return utf8Decoder.decode(bytes)
    } catch {
      throw new DecodeError("INVALID_UTF8", "invalid UTF-8 byte sequence")
    }
  }

  expectEnd(): void {
    if (!this.eof()) throw new DecodeError("TRAILING_DATA", "unexpected trailing bytes")
  }
}

export function decodeUtf8Strict(bytes: Uint8Array): string {
  try {
    return utf8Decoder.decode(bytes)
  } catch {
    throw new DecodeError("INVALID_UTF8", "invalid UTF-8 byte sequence")
  }
}
