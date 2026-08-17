import { config } from "@/lib/config"
import { encodeUrl, encryptCandidate } from "@/lib/codec/candidates"
import { UrlParseError } from "@/lib/url/parse"
import { ValidationError } from "@/lib/url/validate"
import { privateKeysAvailable, generateEphemeralKey, encryptWithKey } from "@/lib/crypto/encryption"
import { checkRateLimit, clientKey } from "@/lib/security/abuse"

export const runtime = "nodejs"

const MODES = ["ultra", "human", "voice", "private", "blind"] as const
type Mode = (typeof MODES)[number]

interface EncodeRequestBody {
  url?: unknown
  mode?: unknown
  aggressive?: unknown
}

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url")
}

export async function POST(request: Request) {
  if (!checkRateLimit(`encode:${clientKey(request)}`, config.rateLimitEncode)) {
    return Response.json({ error: "rate_limited" }, { status: 429 })
  }

  let body: EncodeRequestBody
  try {
    body = (await request.json()) as EncodeRequestBody
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 })
  }

  const url = typeof body.url === "string" ? body.url : ""
  const mode: Mode = (MODES as readonly string[]).includes(body.mode as string)
    ? (body.mode as Mode)
    : "ultra"
  const aggressive = body.aggressive === true
  if (url.length === 0) {
    return Response.json({ error: "missing_url" }, { status: 400 })
  }
  if (!config.enablePrivateMode && (mode === "private" || mode === "blind")) {
    return Response.json({ error: "private_mode_disabled" }, { status: 400 })
  }

  try {
    const result = await encodeUrl(url, { aggressive })

    if (mode === "private") {
      if (!privateKeysAvailable()) {
        return Response.json({ error: "key_unavailable", message: "PAYLOAD_KEY_CURRENT is not configured" }, { status: 400 })
      }
      const payload = await encryptCandidate(result)
      const shortUrl = `${config.publicOrigin}/${payload}`
      return Response.json({
        originalUrl: result.originalUrl,
        canonical: result.canonical,
        mode,
        format: "encrypted(aes-256-gcm)",
        payload,
        shortUrl,
        originalLength: url.length,
        shortenedLength: shortUrl.length,
        saved: url.length - shortUrl.length,
        warning: shortUrl.length >= url.length,
        encrypted: true,
        candidates: result.candidates.map((c) => ({
          format: c.format === "specialized" && c.version === 1 ? "specialized+huffman" : c.format,
          version: c.version,
          bytes: c.bytes.length,
        })),
      })
    }

    if (mode === "blind") {
      const key = await generateEphemeralKey()
      const canonicalBytes = new TextEncoder().encode(result.canonical)
      const envelope = await encryptWithKey(key, canonicalBytes)
      const payload = b64url(envelope)
      const shortUrl = `${config.publicOrigin}/p/${payload}#${b64url(key)}`
      return Response.json({
        originalUrl: result.originalUrl,
        canonical: result.canonical,
        mode,
        format: "blind(aes-256-gcm, fragment key)",
        payload,
        shortUrl,
        originalLength: url.length,
        shortenedLength: shortUrl.length,
        saved: url.length - shortUrl.length,
        warning: shortUrl.length >= url.length,
        blind: true,
        candidates: result.candidates.map((c) => ({
          format: c.format === "specialized" && c.version === 1 ? "specialized+huffman" : c.format,
          version: c.version,
          bytes: c.bytes.length,
        })),
      })
    }

    const payload = mode === "human" ? result.humanPayload : mode === "voice" ? result.voicePayload : result.ultraPayload
    const shortUrl = `${config.publicOrigin}/${payload}`
    const shortenedLength = shortUrl.length
    return Response.json({
      originalUrl: result.originalUrl,
      canonical: result.canonical,
      mode,
      format: result.best.format === "specialized" && result.best.version === 1 ? "specialized+huffman" : result.best.format,
      payload,
      shortUrl,
      originalLength: url.length,
      shortenedLength,
      saved: url.length - shortenedLength,
      warning: shortenedLength >= url.length,
      candidates: result.candidates.map((c) => ({
        format: c.format === "specialized" && c.version === 1 ? "specialized+huffman" : c.format,
        version: c.version,
        bytes: c.bytes.length,
      })),
    })
  } catch (e) {
    if (e instanceof UrlParseError || e instanceof ValidationError) {
      return Response.json({ error: "invalid_url", message: e.message }, { status: 400 })
    }
    return Response.json({ error: "encode_failed", message: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
