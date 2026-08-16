import zlib from "node:zlib"
import { config } from "../config"
import { DecodeError } from "./types"
import { decodeUtf8Strict } from "./reader"

export function brotliCompress(data: Uint8Array): Uint8Array {
  return zlib.brotliCompressSync(data, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
    },
  })
}

export function brotliDecompressToString(data: Uint8Array): string {
  let out: Buffer
  try {
    out = zlib.brotliDecompressSync(data, { maxOutputLength: config.maxDecompressedBytes })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (message.includes("maxOutputLength") || message.includes("buffer size exceeds") || message.includes("larger than")) {
      throw new DecodeError("DECOMPRESSED_TOO_LARGE", "brotli output exceeds limit")
    }
    throw new DecodeError("DECOMPRESSION_FAILED", "brotli decompression failed")
  }
  return decodeUtf8Strict(new Uint8Array(out))
}
