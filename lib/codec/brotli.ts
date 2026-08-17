import zlib from "node:zlib"
import { brotliDecompress } from "./compress"
import { decodeUtf8Strict } from "./reader"
import { DecodeError } from "./types"
import { config } from "../config"
import { BROTLI_DICT_V0_BASE64 } from "./brotli-dict"

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

let dictV0: Uint8Array | null = null

function sharedDict(): Uint8Array {
  if (dictV0 === null) {
    dictV0 = new Uint8Array(Buffer.from(BROTLI_DICT_V0_BASE64, "base64"))
  }
  return dictV0
}

let wasmBrotli: typeof import("brotli-compress") | null = null

async function wasm(): Promise<typeof import("brotli-compress")> {
  if (wasmBrotli === null) {
    wasmBrotli = await import("brotli-compress")
  }
  return wasmBrotli
}

let jsBrotli: typeof import("brotli-compress/js") | null = null

async function pureJs(): Promise<typeof import("brotli-compress/js")> {
  if (jsBrotli === null) {
    jsBrotli = await import("brotli-compress/js")
  }
  return jsBrotli
}

/**
 * Shared-dictionary Brotli (brotli family format version 1): the frozen
 * LZ77 dictionary ships with the code, so payloads never carry it. Encoding
 * uses WASM (unavailable runtimes simply skip the candidate); decoding uses
 * the pure-JS Google implementation so every runtime — Node, Bun, workerd —
 * decodes identically without WebAssembly.
 */
export async function sharedBrotliCompress(data: Uint8Array): Promise<Uint8Array> {
  const api = await wasm()
  const out = await api.compress(data as unknown as Parameters<typeof api.compress>[0], {
    customDictionary: sharedDict(),
    quality: 11,
  })
  return new Uint8Array(out)
}

export async function sharedBrotliDecompressToString(data: Uint8Array): Promise<string> {
  const api = await pureJs()
  let out: Uint8Array
  try {
    out = new Uint8Array(api.decompress(data, { customDictionary: sharedDict() }))
  } catch {
    throw new DecodeError("DECOMPRESSION_FAILED", "shared-brotli decompression failed")
  }
  if (out.length > config.maxDecompressedBytes) {
    throw new DecodeError("DECOMPRESSED_TOO_LARGE", "shared-brotli output exceeds limit")
  }
  return decodeUtf8Strict(out)
}
