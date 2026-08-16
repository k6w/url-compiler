function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === "") return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.floor(n)
}

export const config = {
  publicOrigin: process.env.PUBLIC_ORIGIN ?? "http://localhost:3000",
  enablePrivateMode: process.env.ENABLE_PRIVATE_MODE === "true",
  activeDictionaryVersion: envNumber("ACTIVE_DICTIONARY_VERSION", 0),
  maxPayloadLength: envNumber("MAX_PAYLOAD_LENGTH", 2048),
  maxTargetLength: envNumber("MAX_TARGET_LENGTH", 8192),
  maxQueryPairs: envNumber("MAX_QUERY_PAIRS", 64),
  maxPathSegments: envNumber("MAX_PATH_SEGMENTS", 64),
  maxSegmentBytes: envNumber("MAX_SEGMENT_BYTES", 1024),
  maxDecompressedBytes: envNumber("MAX_DECOMPRESSED_BYTES", 65536),
  rateLimitRedirects: envNumber("RATE_LIMIT_REDIRECTS", 120),
  rateLimitEncode: envNumber("RATE_LIMIT_ENCODE", 30),
} as const

export type AppConfig = typeof config
