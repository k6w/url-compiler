import { mkdirSync, writeFileSync } from "node:fs"
import { encodeUrl } from "@/lib/codec/candidates"
import { canonicalize } from "@/lib/url/normalize"
import corpus from "../data/corpus.json"

const EXTRA_FIXTURES: string[] = [
  "https://www.example.com/products/12345?utm_source=google&id=7",
  "https://example.com/?a=1&a=2&flag&empty=",
  "https://example.com/page#section",
  "https://example.com/page#",
  "https://example.com/?#",
  "http://neverssl.com/this-page",
  "https://user:secretpw@example.com/path?x=1",
  "https://[::1]:8080/ipv6",
  "https://example.com/items/3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  "https://example.com/same/same/same/same",
  "https://example.com/num/2147483647",
  "https://example.com/a%2Fb/%41",
  "https://пример.рф/документы",
]

interface GoldenEntry {
  original: string
  target: string
  format: string
  dictionaryVersion: number
  ultra: string
  human: string
}

async function main(): Promise<void> {
  const urls = [...corpus.categories.flatMap((c) => c.urls), ...EXTRA_FIXTURES]
  const entries: GoldenEntry[] = []
  for (const url of urls) {
    const { canonical } = canonicalize(url)
    const result = await encodeUrl(url)
    entries.push({
      original: url,
      target: canonical,
      format: result.best.format,
      dictionaryVersion: 0,
      ultra: result.ultraPayload,
      human: result.humanPayload,
    })
  }

  mkdirSync("data/golden", { recursive: true })
  writeFileSync(
    "data/golden/payloads.json",
    JSON.stringify(
      {
        description:
          "Frozen decode-contract payloads. Every entry must keep decoding to its target byte-for-byte, forever, regardless of future dictionary versions or format changes. Generated once — never regenerate over existing entries; only append via merge tooling.",
        generatedAt: new Date().toISOString(),
        dictionaryVersionAtGeneration: 0,
        entries,
      },
      null,
      2,
    ) + "\n",
  )
  console.log(`written: data/golden/payloads.json (${entries.length} entries)`)
}

main()
await main()
