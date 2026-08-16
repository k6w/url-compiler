import zlib from "node:zlib"
import { brotliDecompress } from "./compress"
import { decodeUtf8Strict } from "./reader"

export function brotliCompress(data: Uint8Array): Uint8Array {
  return zlib.brotliCompressSync(data, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
    },
  })
}

export async function brotliDecompressToString(data: Uint8Array): Promise<string> {
  const out = await brotliDecompress(data)
  return decodeUtf8Strict(out)
}
