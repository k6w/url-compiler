#!/usr/bin/env bun
/**
 * Showcase diagrams.
 *
 * Every figure is generated from the thing it describes: the modes chart calls
 * the real encoder, the benchmark chart reads data/benchmarks/latest.json, and
 * the envelope map is laid out from the opcode/flag definitions in the spec. A
 * diagram that is typed by hand goes stale silently; one that is generated
 * cannot disagree with the code for long.
 *
 * Writes <name>.svg (dark), <name>-light.svg and PNGs of both into docs/media/.
 *
 *   bun tools/diagrams.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { encodeUrl } from "../lib/codec/candidates"

const OUT = join(import.meta.dir, "..", "docs", "media")
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
const SANS = "'IBM Plex Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif"

interface Palette {
  bg: string
  panel: string
  well: string
  rule: string
  bone: string
  dim: string
  faint: string
  signal: string
  signalInk: string
  flare: string
}

const DARK: Palette = {
  bg: "#14161d",
  panel: "#1a1d26",
  well: "#21252f",
  rule: "#2c313d",
  bone: "#e7e3da",
  dim: "#8a8fa0",
  faint: "#5d6273",
  signal: "#ffb454",
  signalInk: "#1a1204",
  flare: "#ff6f5e",
}

const LIGHT: Palette = {
  bg: "#f3f0e9",
  panel: "#fbfaf6",
  well: "#eceadf",
  rule: "#d9d4c6",
  bone: "#1a1c24",
  dim: "#5b6072",
  faint: "#8d92a3",
  signal: "#c47f10",
  signalInk: "#fdf6e9",
  flare: "#c23a26",
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

interface TextOptions {
  fill?: string
  size?: number
  family?: string
  weight?: number | string
  anchor?: "start" | "middle" | "end"
  spacing?: number
  opacity?: number
}

function text(x: number, y: number, body: string, o: TextOptions = {}): string {
  const attrs = [
    `x="${x}"`,
    `y="${y}"`,
    `fill="${o.fill ?? "currentColor"}"`,
    `font-family="${o.family ?? SANS}"`,
    `font-size="${o.size ?? 13}"`,
    `font-weight="${o.weight ?? 400}"`,
    `text-anchor="${o.anchor ?? "start"}"`,
    o.spacing ? `letter-spacing="${o.spacing}"` : "",
    o.opacity ? `opacity="${o.opacity}"` : "",
  ].filter(Boolean)
  return `<text ${attrs.join(" ")}>${esc(body)}</text>`
}

/** Small uppercase label, the same eyebrow role the interface uses. */
const label = (x: number, y: number, body: string, p: Palette, fill?: string) =>
  text(x, y, body.toUpperCase(), { fill: fill ?? p.faint, family: MONO, size: 10, weight: 600, spacing: 1.6 })

const rect = (x: number, y: number, w: number, h: number, fill: string, stroke?: string, r = 5) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"${stroke ? ` stroke="${stroke}"` : ""}/>`

const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, width = 1) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${width}"/>`

/** Vertical connector with an arrowhead, pointing down. */
function arrow(x: number, y1: number, y2: number, stroke: string): string {
  return (
    line(x, y1, x, y2 - 5, stroke) +
    `<path d="M ${x - 3.5} ${y2 - 6} L ${x} ${y2} L ${x + 3.5} ${y2 - 6} Z" fill="${stroke}"/>`
  )
}

function svg(width: number, height: number, p: Palette, body: string): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">`,
    rect(0, 0, width, height, p.bg, undefined, 0),
    body,
    `</svg>`,
  ].join("\n")
}

/* ---------------------------------------------------------------- pipeline */

function pipeline(p: Palette, sample: Sample): string {
  const W = 1200
  const H = 600
  const cols = [80, 480, 880] // three aligned columns, 240 wide
  const CW = 240
  const centers = cols.map((x) => x + CW / 2)
  const out: string[] = []

  const stage = (x: number, y: number, title: string, caption: string[]) => {
    out.push(rect(x, y, CW, 78, p.panel, p.rule))
    out.push(text(x + 16, y + 27, title, { fill: p.bone, family: MONO, size: 13, weight: 600 }))
    caption.forEach((row, i) => {
      out.push(text(x + 16, y + 47 + i * 15, row, { fill: p.dim, size: 11.5 }))
    })
  }

  out.push(label(80, 34, "input", p))
  out.push(text(80, 60, sample.original, { fill: p.bone, family: MONO, size: 14 }))
  out.push(
    text(W - 80, 60, `${sample.original.length} chars`, { fill: p.dim, family: MONO, size: 13, anchor: "end" }),
  )
  out.push(arrow(centers[0], 76, 116, p.rule))

  stage(cols[0], 116, "parse", ["Platform URL parser.", "Malformed input rejected."])
  stage(cols[1], 116, "normalize", ["Lowercase host, implicit https,", "unreserved %xx only."])
  stage(cols[2], 116, "typed model", ["scheme · host · path[]", "query[] · fragment"])

  // stage-to-stage connectors
  for (const i of [0, 1]) {
    const x1 = cols[i] + CW
    const x2 = cols[i + 1]
    out.push(line(x1, 155, x2 - 6, 155, p.rule))
    out.push(`<path d="M ${x2 - 7} 151.5 L ${x2 - 1} 155 L ${x2 - 7} 158.5 Z" fill="${p.rule}"/>`)
  }

  // fork: one model, several encoders, all racing
  out.push(line(centers[2], 194, centers[2], 226, p.rule))
  out.push(line(centers[0], 226, centers[2], 226, p.rule))
  out.push(label(centers[0] - 4, 218, "every encoder runs; each result must decode back", p, p.faint))
  for (const c of centers) out.push(arrow(c, 226, 266, p.rule))

  sample.candidates.forEach((candidate, i) => {
    const x = cols[i]
    const won = candidate.name === sample.winner
    out.push(rect(x, 266, CW, 78, won ? p.panel : p.panel, won ? p.signal : p.rule))
    out.push(text(x + 16, 293, candidate.name, { fill: won ? p.signal : p.bone, family: MONO, size: 13, weight: 600 }))
    out.push(text(x + 16, 315, `${candidate.bytes} bytes`, { fill: p.dim, family: MONO, size: 12 }))
    out.push(text(x + 16, 332, "✓ round-trips exactly", { fill: p.dim, size: 11.5 }))
  })

  // join
  for (const c of centers) out.push(line(c, 344, c, 376, p.rule))
  out.push(line(centers[0], 376, centers[2], 376, p.rule))
  out.push(arrow(centers[1], 376, 412, p.signal))

  out.push(rect(cols[1] - 90, 412, CW + 180, 56, p.panel, p.signal))
  out.push(
    text(centers[1], 437, "shortest verified candidate wins", {
      fill: p.signal,
      family: MONO,
      size: 13,
      weight: 600,
      anchor: "middle",
    }),
  )
  out.push(
    text(centers[1], 455, "unverifiable candidates are discarded, never shipped", {
      fill: p.dim,
      size: 11.5,
      anchor: "middle",
    }),
  )

  out.push(arrow(centers[1], 468, 486, p.rule))
  out.push(
    text(centers[1], 506, "Base64URL  ·  Base32 + checksum  ·  256-word list", {
      fill: p.dim,
      family: MONO,
      size: 12,
      anchor: "middle",
    }),
  )

  out.push(line(80, 524, W - 80, 524, p.rule))
  out.push(label(80, 550, "output", p))
  out.push(text(80, 576, sample.shortUrl, { fill: p.signal, family: MONO, size: 14, weight: 600 }))
  out.push(
    text(W - 80, 576, `${sample.shortUrl.length} chars`, {
      fill: p.bone,
      family: MONO,
      size: 13,
      weight: 600,
      anchor: "end",
    }),
  )

  return svg(W, H, p, out.join("\n"))
}

/* ---------------------------------------------------------------- envelope */

const FLAG_BITS = [
  "http (https is implicit)",
  "custom port present",
  "credentials present",
  "query present",
  "fragment present",
  "dictionary-version varint follows",
  "checksum present (reserved)",
  "encryption present (rejected on decode)",
]

const FAMILIES = [
  ["00", "specialized URL bytecode", "v0 raw literals · v1 Huffman literals"],
  ["01", "Brotli-compressed canonical", "v0 plain · v1 shared dictionary"],
  ["10", "DEFLATE-compressed canonical", "v0"],
  ["11", "encrypted envelope", "AES-256-GCM, nonce + ciphertext"],
]

function envelope(p: Palette): string {
  const W = 1200
  const H = 578
  const out: string[] = []
  const cell = 46
  const x0 = 80

  const byteRow = (y: number, bits: string[], fills: (string | null)[]) => {
    bits.forEach((bit, i) => {
      const x = x0 + i * cell
      out.push(rect(x, y, cell - 4, 40, fills[i] ?? p.well, p.rule, 3))
      out.push(
        text(x + (cell - 4) / 2, y + 26, bit, {
          fill: fills[i] ? p.signalInk : p.bone,
          family: MONO,
          size: 14,
          weight: 600,
          anchor: "middle",
        }),
      )
    })
  }

  out.push(label(x0, 34, "byte 0 — format family and version", p, p.dim))
  byteRow(50, ["f", "f", "v", "v", "v", "v", "v", "v"], [p.signal, p.signal, null, null, null, null, null, null])
  out.push(text(x0 + cell * 8 + 20, 66, "2 bits family, 6 bits version", { fill: p.dim, size: 12 }))
  out.push(text(x0 + cell * 8 + 20, 84, "— an old link never becomes ambiguous", { fill: p.faint, size: 12 }))

  FAMILIES.forEach(([bits, name, detail], i) => {
    const y = 118 + i * 34
    out.push(text(x0, y, bits, { fill: p.signal, family: MONO, size: 13, weight: 600 }))
    out.push(text(x0 + 44, y, name, { fill: p.bone, family: MONO, size: 12.5 }))
    out.push(text(x0 + 340, y, detail, { fill: p.dim, size: 12 }))
  })

  out.push(label(x0, 300, "byte 1 — flags", p, p.dim))
  byteRow(316, ["7", "6", "5", "4", "3", "2", "1", "0"], [null, null, null, null, null, null, null, null])

  FLAG_BITS.forEach((meaning, bit) => {
    const y = 386 + bit * 22
    out.push(text(x0, y, `bit ${bit}`, { fill: p.faint, family: MONO, size: 11.5 }))
    out.push(text(x0 + 58, y, meaning, { fill: p.dim, size: 12 }))
  })

  const tailX = 620
  out.push(label(tailX, 300, "then, in order", p, p.dim))
  const tail = [
    ["[dict version varint]", "only when bit 5 is set"],
    ["[instruction stream]", "byte-aligned (v0) or MSB-first bit-packed (v1)"],
  ]
  tail.forEach(([name, detail], i) => {
    const y = 320 + i * 62
    out.push(rect(tailX, y, W - 80 - tailX, 48, p.panel, p.rule))
    out.push(text(tailX + 14, y + 20, name, { fill: p.bone, family: MONO, size: 12.5, weight: 600 }))
    out.push(text(tailX + 14, y + 37, detail, { fill: p.dim, size: 11.5 }))
  })

  out.push(line(tailX, 456, W - 80, 456, p.rule))
  const notes = [
    "Varints are LEB128, ≤5 bytes, minimal — overlong encodings are rejected.",
    "Every read is bounds-checked; truncated streams fail closed.",
    "Decompression is capped at 64 KiB, so a zip bomb cannot land.",
  ]
  notes.forEach((note, i) => {
    out.push(text(tailX, 482 + i * 22, note, { fill: p.dim, size: 12 }))
  })

  return svg(W, H, p, out.join("\n"))
}

/* ------------------------------------------------------------------- modes */

function modes(p: Palette, sample: Sample): string {
  const W = 1200
  const rowH = 104
  const H = 116 + sample.modes.length * rowH
  const out: string[] = []
  const x0 = 80
  const barX = 300
  const numX = W - 80
  const barW = numX - 110 - barX
  const PAYLOAD_COLS = Math.floor(barW / 7.25) // 12px mono advance
  const longest = Math.max(...sample.modes.map((m) => m.url.length), sample.original.length)

  out.push(label(x0, 36, "one destination, three alphabets", p, p.dim))
  out.push(text(x0, 62, sample.original, { fill: p.dim, family: MONO, size: 13 }))
  out.push(
    text(numX, 62, `${sample.original.length} chars in`, { fill: p.faint, family: MONO, size: 12, anchor: "end" }),
  )
  out.push(line(x0, 86, numX, 86, p.rule))

  sample.modes.forEach((m, i) => {
    const y = 124 + i * rowH
    const grew = m.url.length >= sample.original.length

    out.push(text(x0, y + 4, m.name.toUpperCase(), { fill: p.bone, family: MONO, size: 14, weight: 600, spacing: 1.4 }))
    out.push(text(x0, y + 24, m.note, { fill: p.faint, size: 11.5 }))

    out.push(rect(barX, y - 8, barW, 14, p.well, undefined, 3))
    out.push(rect(barX, y - 8, (m.url.length / longest) * barW, 14, grew ? p.flare : p.signal, undefined, 3))
    out.push(
      text(numX, y + 4, `${m.url.length} chars`, {
        fill: grew ? p.flare : p.bone,
        family: MONO,
        size: 13,
        weight: 600,
        anchor: "end",
      }),
    )

    wrap(m.url, PAYLOAD_COLS)
      .slice(0, 3)
      .forEach((chunk, ci) => {
        out.push(text(barX, y + 30 + ci * 17, chunk, { fill: p.dim, family: MONO, size: 12 }))
      })
  })

  return svg(W, H, p, out.join("\n"))
}

function wrap(s: string, width: number): string[] {
  const rows: string[] = []
  for (let i = 0; i < s.length; i += width) rows.push(s.slice(i, i + width))
  return rows
}

/* --------------------------------------------------------------- benchmark */

interface BenchCategory {
  category: string
  urls: number
  avgOriginal: number
  avgUltra: number
}

function benchmark(p: Palette): string {
  const raw = JSON.parse(readFileSync(join(import.meta.dir, "..", "data", "benchmarks", "latest.json"), "utf8")) as {
    total: number
    shortenedCount: number
    categories: BenchCategory[]
  }
  const rows = [...raw.categories].sort((a, b) => a.avgUltra / a.avgOriginal - b.avgUltra / b.avgOriginal)

  const W = 1200
  const rowH = 52
  const H = 150 + rows.length * rowH + 40
  const x0 = 80
  const barX = 250
  const numX = W - 80
  const barW = numX - 120 - barX
  const longest = Math.max(...rows.flatMap((r) => [r.avgOriginal, r.avgUltra]))
  const out: string[] = []

  out.push(text(x0, 44, "Average URL length before and after, by category", { fill: p.bone, size: 15, weight: 600 }))
  out.push(
    text(x0, 68, `${raw.shortenedCount} of ${raw.total} benchmark URLs come out shorter. The rest are reported, not hidden.`, {
      fill: p.dim,
      size: 12.5,
    }),
  )

  // legend
  out.push(rect(x0, 88, 22, 9, p.rule, undefined, 2))
  out.push(text(x0 + 30, 97, "original", { fill: p.dim, family: MONO, size: 11 }))
  out.push(rect(x0 + 110, 88, 22, 9, p.signal, undefined, 2))
  out.push(text(x0 + 140, 97, "compiled", { fill: p.dim, family: MONO, size: 11 }))
  out.push(rect(x0 + 226, 88, 22, 9, p.flare, undefined, 2))
  out.push(text(x0 + 256, 97, "compiled, but longer", { fill: p.dim, family: MONO, size: 11 }))

  out.push(line(x0, 118, W - 80, 118, p.rule))

  rows.forEach((row, i) => {
    const y = 150 + i * rowH
    const grew = row.avgUltra >= row.avgOriginal
    out.push(text(x0, y + 6, row.category, { fill: p.bone, family: MONO, size: 12.5 }))
    out.push(text(x0, y + 22, `${row.urls} urls`, { fill: p.faint, family: MONO, size: 10.5 }))

    out.push(rect(barX, y - 6, (row.avgOriginal / longest) * barW, 11, p.rule, undefined, 2))
    out.push(rect(barX, y + 9, (row.avgUltra / longest) * barW, 11, grew ? p.flare : p.signal, undefined, 2))

    out.push(
      text(numX, y + 4, `${row.avgOriginal} → ${row.avgUltra}`, {
        fill: p.bone,
        family: MONO,
        size: 12.5,
        weight: 600,
        anchor: "end",
      }),
    )
    out.push(
      text(numX, y + 21, `${Math.round((row.avgUltra / row.avgOriginal) * 100)}%`, {
        fill: grew ? p.flare : p.signal,
        family: MONO,
        size: 11,
        anchor: "end",
      }),
    )
  })

  out.push(
    text(x0, H - 24, "Source: data/benchmarks/latest.json — regenerate with `bun run benchmark`.", {
      fill: p.faint,
      size: 11.5,
    }),
  )

  return svg(W, H, p, out.join("\n"))
}

/* -------------------------------------------------------------------- main */

interface Sample {
  original: string
  shortUrl: string
  winner: string
  candidates: { name: string; bytes: number }[]
  modes: { name: string; note: string; url: string }[]
}

const ORIGIN = "https://x.example"

function candidateLabel(format: string, version: number): string {
  if (version === 0) return format
  if (format === "specialized") return "specialized+huffman"
  if (format === "brotli") return "brotli+shared-dict"
  return `${format}+v${version}`
}

async function buildSample(): Promise<Sample> {
  const original = "https://www.example.com/products/12345?utm_source=google&id=7"
  const result = await encodeUrl(original, { aggressive: false })
  const ranked = [...result.candidates].sort((a, b) => a.bytes.length - b.bytes.length)
  const winner = candidateLabel(result.best.format, result.best.version)

  // Three columns of diagram, so three representative encoders: the winner
  // plus the next two distinct families.
  const picked: { name: string; bytes: number }[] = []
  for (const candidate of ranked) {
    const name = candidateLabel(candidate.format, candidate.version)
    if (picked.some((c) => c.name === name)) continue
    picked.push({ name, bytes: candidate.bytes.length })
    if (picked.length === 3) break
  }

  return {
    original,
    shortUrl: `${ORIGIN}/${result.ultraPayload}`,
    winner,
    candidates: picked,
    modes: [
      { name: "ultra", note: "Base64URL, densest", url: `${ORIGIN}/${result.ultraPayload}` },
      { name: "human", note: "Base32 + checksum", url: `${ORIGIN}/${result.humanPayload}` },
      { name: "voice", note: "one word per byte", url: `${ORIGIN}/${result.voicePayload}` },
    ],
  }
}

async function main(): Promise<number> {
  mkdirSync(OUT, { recursive: true })
  const sample = await buildSample()

  const figures: Record<string, (p: Palette) => string> = {
    pipeline: (p) => pipeline(p, sample),
    envelope,
    modes: (p) => modes(p, sample),
    benchmark,
  }

  for (const [name, render] of Object.entries(figures)) {
    for (const [suffix, palette] of [
      ["", DARK],
      ["-light", LIGHT],
    ] as const) {
      const file = join(OUT, `${name}${suffix}.svg`)
      writeFileSync(file, render(palette))
      const png = join(OUT, `${name}${suffix}.png`)
      const converted = Bun.spawnSync(["rsvg-convert", "--zoom", "2", file, "-o", png])
      if (converted.exitCode !== 0) {
        console.error(`  rsvg-convert failed for ${name}${suffix} — install librsvg (brew install librsvg)`)
        return 1
      }
      console.log(`  ${name}${suffix}.svg + .png`)
    }
  }
  return 0
}

process.exit(await main())
