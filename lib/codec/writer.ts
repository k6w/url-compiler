export class ByteWriter {
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
