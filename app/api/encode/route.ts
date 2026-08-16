import { config } from "@/lib/config"
import { encodeUrl } from "@/lib/codec/candidates"
import { UrlParseError } from "@/lib/url/parse"
import { ValidationError } from "@/lib/url/validate"
import { assertPrivateModeDisabled } from "@/lib/crypto/encryption"
import { checkRateLimit, clientKey } from "@/lib/security/abuse"

export const runtime = "nodejs"

interface EncodeRequestBody {
  url?: unknown
  mode?: unknown
  aggressive?: unknown
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
  const mode = body.mode === "human" ? "human" : "ultra"
  const aggressive = body.aggressive === true
  if (url.length === 0) {
    return Response.json({ error: "missing_url" }, { status: 400 })
  }

  try {
    assertPrivateModeDisabled()
    const result = encodeUrl(url, { aggressive })
    const payload = mode === "human" ? result.humanPayload : result.ultraPayload
    const shortUrl = `${config.publicOrigin}/${payload}`
    const shortenedLength = shortUrl.length
    return Response.json({
      originalUrl: result.originalUrl,
      canonical: result.canonical,
      mode,
      format: result.best.format,
      payload,
      shortUrl,
      originalLength: url.length,
      shortenedLength,
      saved: url.length - shortenedLength,
      warning: shortenedLength >= url.length,
      candidates: result.candidates.map((c) => ({
        format: c.format,
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
