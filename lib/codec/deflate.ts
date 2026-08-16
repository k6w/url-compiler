import zlib from "node:zlib"
import { config } from "../config"
import { DecodeError } from "./types"
import { decodeUtf8Strict } from "./reader"

export function deflateCompress(data: Uint8Array): Uint8Array {
  return zlib.deflateRawSync(data, { level: 9 })
}

export function deflateDecompressToString(data: Uint8Array): string {
  let out: Buffer
  try {
    out = zlib.inflateRawSync(data, { maxOutputLength: config.maxDecompressedBytes })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (message.includes("maxOutputLength") || message.includes("buffer size exceeds") || message.includes("larger than")) {
      throw new DecodeError("DECOMPRESSED_TOO_LARGE", "deflate output exceeds limit")
    }
    throw new DecodeError("DECOMPRESSION_FAILED", "deflate decompression failed")
  }
  return decodeUtf8Strict(new Uint8Array(out))
}
