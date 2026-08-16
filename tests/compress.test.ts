import { describe, expect, test } from "bun:test"
import zlib from "node:zlib"
import {
  compressionCapabilities,
  forceWebStreamsForTests,
  inflateRaw,
  brotliDecompress,
} from "@/lib/codec/compress"
import { deflateCompress } from "@/lib/codec/deflate"
import { brotliCompress } from "@/lib/codec/brotli"

const SAMPLE = new TextEncoder().encode("https://example.com/some/target?query=1")

describe("compression adapter", () => {
  test("capabilities are reported per format", () => {
    const caps = compressionCapabilities()
    expect(["zlib", "web", "none"]).toContain(caps["deflate-raw"])
    expect(["zlib", "web", "none"]).toContain(caps.br)
  })

  test("zlib path decodes deflate and brotli", async () => {
    const inflated = await inflateRaw(deflateCompress(SAMPLE))
    expect(new TextDecoder().decode(inflated)).toBe("https://example.com/some/target?query=1")
    const unbrotlied = await brotliDecompress(brotliCompress(SAMPLE))
    expect(new TextDecoder().decode(unbrotlied)).toBe("https://example.com/some/target?query=1")
  })

  test("web-streams fallback decodes deflate-raw identically to zlib", async () => {
    forceWebStreamsForTests(true)
    try {
      const inflated = await inflateRaw(deflateCompress(SAMPLE))
      expect(new TextDecoder().decode(inflated)).toBe("https://example.com/some/target?query=1")
    } finally {
      forceWebStreamsForTests(false)
    }
  })

  test("web-streams fallback rejects garbage instead of hanging", async () => {
    forceWebStreamsForTests(true)
    try {
      await expect(inflateRaw(new Uint8Array([0xff, 0xff, 0xff, 0xff]))).rejects.toThrow()
    } finally {
      forceWebStreamsForTests(false)
    }
  })

  test("zip bombs are capped on both paths", async () => {
    const bomb = zlib.deflateRawSync(Buffer.alloc(1024 * 1024, 0x41))
    await expect(inflateRaw(new Uint8Array(bomb))).rejects.toThrow(/exceeds limit/i)
    forceWebStreamsForTests(true)
    try {
      await expect(inflateRaw(new Uint8Array(bomb))).rejects.toThrow(/exceeds limit/i)
    } finally {
      forceWebStreamsForTests(false)
    }
  })

  test("brotli web fallback is used only when the runtime supports it", async () => {
    forceWebStreamsForTests(true)
    try {
      const webBr = compressionCapabilities()
      void webBr
      const { hasWebFormat } = await import("@/lib/codec/compress")
      if (hasWebFormat("br")) {
        const out = await brotliDecompress(brotliCompress(SAMPLE))
        expect(out.length).toBe(SAMPLE.length)
      } else {
        await expect(brotliDecompress(brotliCompress(SAMPLE))).rejects.toThrow(/unavailable/)
      }
    } finally {
      forceWebStreamsForTests(false)
    }
  })
})
