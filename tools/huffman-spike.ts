import { encodeSpecialized } from "@/lib/codec/specialized"
import { encodeUrl } from "@/lib/codec/candidates"
import { collectLiteralBytes } from "@/lib/codec/emissions"
import { canonicalize } from "@/lib/url/normalize"
import { config } from "@/lib/config"
import corpus from "../data/corpus.json"
import { mkdirSync, writeFileSync } from "node:fs"

function huffmanCodeLengths(freqs: Map<number, number>): number[] {
  // package-merge-free approximation: build Huffman tree with a simple heap
  type Node = { w: number; left: Node | null; right: Node | null; sym: number }
  const leaves: Node[] = [...freqs.entries()].map(([sym, w]) => ({ w, left: null, right: null, sym }))
  if (leaves.length === 0) return []
  if (leaves.length === 1) return [1]
  const heap = [...leaves]
  while (heap.length > 1) {
    heap.sort((a, b) => a.w - b.w)
    const a = heap.shift()!
    const b = heap.shift()!
    heap.push({ w: a.w + b.w, left: a, right: b, sym: -1 })
  }
  const lengths: number[] = []
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

async function main(): Promise<void> {
  const sink: Uint8Array[] = []
  collectLiteralBytes(sink)
  const useDict = config.activeDictionaryVersion

  let totalSpecializedBytes = 0
  const freqs = new Map<number, number>()
  for (const category of corpus.categories) {
    for (const url of category.urls) {
      const { model } = canonicalize(url)
      totalSpecializedBytes += encodeSpecialized(model, useDict).length
    }
  }
  let totalLiteralBytes = 0
  for (const chunk of sink) {
    for (const b of chunk) {
      freqs.set(b, (freqs.get(b) ?? 0) + 1)
      totalLiteralBytes++
    }
  }
  collectLiteralBytes(null)

  const lengths = huffmanCodeLengths(freqs)
  let currentBits = 0
  let huffmanBits = 0
  for (const [sym, w] of freqs) {
    currentBits += w * 8
    huffmanBits += w * (lengths[sym] ?? 8)
  }

  const literalShare = totalLiteralBytes / totalSpecializedBytes
  const literalSaving = (currentBits - huffmanBits) / currentBits
  const overallSaving = (currentBits - huffmanBits) / 8 / totalSpecializedBytes

  const report = `# Huffman spike report

Measured on the full corpus with dictionary v${useDict} (specialized bytecode only,
emitted literals only — exploration costs excluded).

| metric | value |
|---|---|
| total specialized bytes | ${totalSpecializedBytes} |
| literal (LITERAL_BYTES) content bytes | ${totalLiteralBytes} (${(literalShare * 100).toFixed(1)}% of stream) |
| distinct literal byte values | ${freqs.size} |
| Shannon-optimal static Huffman length | ${(huffmanBits / 8).toFixed(0)} bytes vs ${totalLiteralBytes} raw (${(literalSaving * 100).toFixed(1)}% smaller literals) |
| estimated total payload saving | ${(overallSaving * 100).toFixed(1)}% |

## Interpretation

Static canonical Huffman over literal bytes would shrink the literal portion by
${(literalSaving * 100).toFixed(1)}%, but literals are only ${(literalShare * 100).toFixed(1)}% of the
bytecode stream — the rest is opcodes, varints, and typed values (already compact).
Net effect on final payload length: ~${(overallSaving * 100).toFixed(1)}%.

Threshold from the plan: implement only if the ceiling is >8% on literal-heavy
categories. Measured ceiling across the whole corpus: ${(overallSaving * 100).toFixed(1)}%.

**Decision: ${overallSaving > 0.08 ? "PROCEED — ceiling exceeds 8%" : "SKIP — ceiling below 8%; the format-version fork and decoder complexity are not justified."}**

Note: base64url expands bytes by 4/3, so the URL-level effect is the same
percentage as the byte-level effect. UTF-8 literal content (unicode category)
is multi-byte and partially incompressible by byte-level Huffman; a
script-aware model would be needed for more.
`
  mkdirSync("data/analysis", { recursive: true })
  writeFileSync("data/analysis/huffman-spike.md", report)
  console.log(report)
}

await main()
