import zlib from "node:zlib"
import { inflateRaw } from "./compress"
import { decodeUtf8Strict } from "./reader"

export function deflateCompress(data: Uint8Array): Uint8Array {
  return zlib.deflateRawSync(data, { level: 9 })
}

export async function deflateDecompressToString(data: Uint8Array): Promise<string> {
  const out = await inflateRaw(data)
  return decodeUtf8Strict(out)
}
