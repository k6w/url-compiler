/** Writer surface shared by the byte-oriented (v0) and bit-oriented (v1) formats. */
export interface StreamWriter {
  byte(b: number): unknown
  bytes(arr: Uint8Array): unknown
  varint(n: number): unknown
  zigzag(n: number): unknown
  writeBits(value: number, count: number): unknown
  readonly bitLength: number
  finish(): Uint8Array
}

export class ByteWriter implements StreamWriter {
  private buf: number[] = []

  byte(b: number): this {
    if (b < 0 || b > 255 || !Number.isInteger(b)) throw new RangeError(`invalid byte: ${b}`)
    this.buf.push(b)
    return this
  }

  bytes(arr: Uint8Array): this {
    for (let i = 0; i < arr.length; i++) this.buf.push(arr[i])
    return this
  }

  writeBits(value: number, count: number): this {
    if (count === 8) return this.byte(value)
    if (count === 0) return this
    throw new RangeError("ByteWriter only supports 8-bit writes")
  }

  varint(n: number): this {
    if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) {
      throw new RangeError(`varint out of range: ${n}`)
    }
    let v = n
    while (v >= 0x80) {
      this.buf.push((v & 0x7f) | 0x80)
      v = Math.floor(v / 128)
    }
    this.buf.push(v)
    return this
  }

  zigzag(n: number): this {
    return this.varint(zigzagEncode(n))
  }

  get bitLength(): number {
    return this.buf.length * 8
  }

  get length(): number {
    return this.buf.length
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.buf)
  }
}

export function zigzagEncode(n: number): number {
  if (!Number.isInteger(n) || n < -0x80000000 || n > 0x7fffffff) {
    throw new RangeError(`zigzag out of range: ${n}`)
  }
  return n >= 0 ? n * 2 : -n * 2 - 1
}

export function zigzagDecode(v: number): number {
  return (v >>> 1) ^ -(v & 1)
}
