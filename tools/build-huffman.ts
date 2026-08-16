import { mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { encodeSpecialized } from "@/lib/codec/specialized"
import { collectLiteralBytes } from "@/lib/codec/emissions"
import { canonicalize } from "@/lib/url/normalize"
import { config } from "@/lib/config"
import { SYMBOL_COUNT, ESCAPE_SYMBOL } from "@/lib/codec/huffman"
import corpus from "../data/corpus.json"

/**
 * Builds the frozen Huffman code-length table for format v1 from the
 * emitted-literal byte distribution over the corpus (dictionary version
 * active at generation time). Output is written once and becomes immutable;
 * any future table change requires a new format version.
 */

function huffmanLengths(freqs: Map<number, number>): number[] {
  type Node = { w: number; left: Node | null; right: Node | null; sym: number }
  const leaves: Node[] = [...freqs.entries()].map(([sym, w]) => ({ w, left: null, right: null, sym }))
  if (leaves.length === 0) throw new Error("no symbols")
  const lengths = new Array<number>(SYMBOL_COUNT).fill(0)
  if (leaves.length === 1) {
    lengths[leaves[0].sym] = 1
    return lengths
  }
  const heap = [...leaves]
  while (heap.length > 1) {
    heap.sort((a, b) => a.w - b.w)
    const a = heap.shift()!
    const b = heap.shift()!
    heap.push({ w: a.w + b.w, left: a, right: b, sym: -1 })
  }
  const walk = (node: Node, depth: number) => {
    if (node.sym >= 0) {
      lengths[node.sym] = depth
      return
    }
    walk(node.left!, depth + 1)
    walk(node.right!, depth + 1)
  }
  walk(heap[0], 0)
  return lengths
}

const corpusTxt = readFileSync("data/corpus.txt", "utf8")
const corpusTxtUrls = corpusTxt.split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("#"))

const sink: Uint8Array[] = []
collectLiteralBytes(sink)
for (const url of corpusTxtUrls.length > 0 ? corpusTxtUrls : corpus.categories.flatMap((c) => c.urls)) {
  try {
    encodeSpecialized(canonicalize(url).model, config.activeDictionaryVersion)
  } catch {
    // corpus entries that fail validation contribute nothing
  }
}
collectLiteralBytes(null)

const freqs = new Map<number, number>()
let total = 0
for (const chunk of sink) {
  for (const b of chunk) {
    freqs.set(b, (freqs.get(b) ?? 0) + 1)
    total++
  }
}
if (total === 0) throw new Error("no literal bytes collected")

// escape must be representable but rare
freqs.set(ESCAPE_SYMBOL, Math.max(1, Math.ceil(total / 1024)))

const lengths = huffmanLengths(freqs)
const usedSymbols = [...freqs.keys()].length
let codedBits = 0
for (const chunk of sink) {
  for (const b of chunk) codedBits += lengths[b]
}
const avgLen = codedBits / total

mkdirSync("data/dictionaries", { recursive: true })
writeFileSync(
  "data/dictionaries/huffman-v1.json",
  JSON.stringify(
    {
      version: 1,
      description:
        "Frozen canonical Huffman code lengths for specialized format v1 literals. Immutable — changes require a new format version.",
      generatedFrom: "emitted literals over data/corpus.json + data/corpus.txt",
      symbols: usedSymbols,
      literalBytesMeasured: total,
      averageCodeLength: Math.round(avgLen * 100) / 100,
      lengths,
    },
    null,
    2,
  ) + "\n",
)
console.log(`huffman-v1.json: ${usedSymbols} symbols, ${total} literal bytes measured, avg code ${avgLen.toFixed(2)} bits`)
