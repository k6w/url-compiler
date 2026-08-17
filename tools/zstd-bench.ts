import zlib from "node:zlib"
import { writeFileSync, mkdirSync } from "node:fs"
import { canonicalize } from "@/lib/url/normalize"
import corpus from "../data/corpus.json"

const utf8 = new TextEncoder()

type ZstdCompressSync = (data: Buffer, options?: { dictionary?: Buffer; params?: Record<number, number> }) => Buffer
const zstdCompressSync = (zlib as unknown as { zstdCompressSync?: ZstdCompressSync }).zstdCompressSync
const ZSTD_LEVEL = 0x64 // ZSTD_c_compressionLevel

if (typeof zstdCompressSync !== "function") {
  console.error("zstd not available in this runtime")
  process.exit(1)
}

function buildRawContentDictionary(): Buffer {
  const urls = corpus.categories.flatMap((c) => c.urls).map((u) => canonicalize(u).canonical)
  return Buffer.from(urls.join("\n") + "\n", "utf8")
}

function zstdCompress(data: Uint8Array, dictionary: Buffer | null, level: number): Uint8Array {
  const fn = zstdCompressSync!
  const options = dictionary ? { dictionary, params: { [ZSTD_LEVEL]: level } } : { params: { [ZSTD_LEVEL]: level } }
  return fn(Buffer.from(data), options)
}

function main(): void {
  const dict = buildRawContentDictionary()
  mkdirSync("data/dictionaries", { recursive: true })
  writeFileSync("data/dictionaries/zdict-v0.bin", dict)
  console.log(`zdict-v0.bin: ${dict.length} bytes (raw-content dictionary)`)

  const ORIGIN = "http://localhost:3000"
  const rows: Array<[string, number, number, number]> = []
  for (const category of corpus.categories) {
    let brotliSum = 0
    let deflateSum = 0
    let zstdSum = 0
    let zstdNoDictSum = 0
    for (const url of category.urls) {
      const canonical = canonicalize(url).canonical
      const data = Buffer.from(utf8.encode(canonical))

      const br = zlib.brotliCompressSync(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } })
      const df = zlib.deflateRawSync(data, { level: 9 })
      const zs19 = zstdCompress(data, dict, 19)
      const zs19n = zstdCompress(data, null, 19)

      brotliSum += 2 + Math.ceil((br.length * 4) / 3)
      deflateSum += 2 + Math.ceil((df.length * 4) / 3)
      zstdSum += 2 + Math.ceil((zs19.length * 4) / 3)
      zstdNoDictSum += 2 + Math.ceil((zs19n.length * 4) / 3)
    }
    const n = category.urls.length
    rows.push([category.name, brotliSum / n, deflateSum / n, zstdSum / n])
    console.log(
      category.name.padEnd(18),
      "brotli", Math.round(brotliSum / n).toString().padStart(4),
      "deflate", Math.round(deflateSum / n).toString().padStart(4),
      "zstd+dict", Math.round(zstdSum / n).toString().padStart(4),
      "zstd", Math.round(zstdNoDictSum / n).toString().padStart(4),
    )
  }
  void ORIGIN
}

main()
