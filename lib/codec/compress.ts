import zlib from "node:zlib"
import { config } from "../config"
import { DecodeError } from "./types"

export type DecompressFormat = "deflate-raw" | "br" | "zstd"

let zlibOk: boolean | null = null
const webOk = new Map<DecompressFormat, boolean | null>()
let forceWebStreams = false

type ZstdSyncFn = (input: Buffer, options?: { maxOutputLength?: number }) => Buffer

function zstdDecompressSyncFn(): ZstdSyncFn | undefined {
  const candidate = (zlib as unknown as { zstdDecompressSync?: unknown }).zstdDecompressSync
  return typeof candidate === "function"
    ? (candidate as ZstdSyncFn)
    : undefined
}

function hasNodeZlib(): boolean {
  if (zlibOk === null) {
    zlibOk = typeof zlib?.inflateRawSync === "function"
  }
  return zlibOk
}

export function hasWebFormat(format: DecompressFormat): boolean {
  let ok = webOk.get(format)
  if (ok === undefined || ok === null) {
    try {
      new DecompressionStream(format as unknown as globalThis.CompressionFormat)
      ok = true
    } catch {
      ok = false
    }
    webOk.set(format, ok)
  }
  return ok
}

export function forceWebStreamsForTests(enabled: boolean): void {
  forceWebStreams = enabled
}

export function compressionCapabilities(): Record<DecompressFormat, "zlib" | "web" | "none"> {
  const caps: Record<DecompressFormat, "zlib" | "web" | "none"> = {
    "deflate-raw": hasNodeZlib() ? "zlib" : hasWebFormat("deflate-raw") ? "web" : "none",
    br: hasNodeZlib() ? "zlib" : hasWebFormat("br") ? "web" : "none",
    zstd: hasNodeZlib() && zstdDecompressSyncFn() !== undefined ? "zlib" : hasWebFormat("zstd") ? "web" : "none",
  }
  return caps
}

async function webDecompress(format: DecompressFormat, data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream(format as unknown as globalThis.CompressionFormat))
  const buffer = await new Response(stream).arrayBuffer()
  return new Uint8Array(buffer)
}

function capExceeded(): DecodeError {
  return new DecodeError("DECOMPRESSED_TOO_LARGE", "decompressed output exceeds limit")
}

async function decompress(
  format: DecompressFormat,
  data: Uint8Array,
  zlibFn: ((input: Buffer, options?: { maxOutputLength?: number }) => Buffer) | undefined,
): Promise<Uint8Array> {
  const useZlib = !forceWebStreams && zlibFn !== undefined && hasNodeZlib()
  if (useZlib) {
    try {
      return new Uint8Array(zlibFn(Buffer.from(data), { maxOutputLength: config.maxDecompressedBytes }))
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (message.includes("larger than") || message.includes("maxOutputLength") || message.includes("buffer size exceeds")) {
        throw capExceeded()
      }
      throw new DecodeError("DECOMPRESSION_FAILED", `${format} decompression failed`)
    }
  }
  if (hasWebFormat(format)) {
    let out: Uint8Array
    try {
      out = await webDecompress(format, data)
    } catch {
      throw new DecodeError("DECOMPRESSION_FAILED", `${format} decompression failed`)
    }
    if (out.length > config.maxDecompressedBytes) throw capExceeded()
    return out
  }
  throw new DecodeError("DECOMPRESSION_FAILED", `${format} decoding unavailable on this runtime`)
}

export async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  return decompress("deflate-raw", data, (input, opts) => zlib.inflateRawSync(input, opts))
}

export async function brotliDecompress(data: Uint8Array): Promise<Uint8Array> {
  return decompress("br", data, (input, opts) => zlib.brotliDecompressSync(input, opts))
}

export async function zstdDecompress(data: Uint8Array): Promise<Uint8Array> {
  return decompress("zstd", data, zstdDecompressSyncFn())
}
