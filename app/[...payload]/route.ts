import { decodePayloadString } from "@/lib/codec/candidates"
import { DecodeError } from "@/lib/codec/types"
import { validateRedirectTarget, RedirectError } from "@/lib/security/redirect"
import { checkRateLimit, clientKey } from "@/lib/security/abuse"
import { suggestHumanCorrection } from "@/lib/alphabet/base32"
import { config } from "@/lib/config"

export const runtime = "nodejs"

const REDIRECT_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
}

function errorResponse(status: number, body: string, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...REDIRECT_HEADERS, ...extra },
  })
}

export async function GET(request: Request, context: { params: Promise<{ payload: string[] }> }) {
  const { payload } = await context.params
  const encoded = payload.join("/")

  if (!checkRateLimit(`redirect:${clientKey(request)}`, config.rateLimitRedirects)) {
    return errorResponse(429, "rate limited")
  }
  if (encoded.length > config.maxPayloadLength) {
    return errorResponse(414, "payload too large")
  }

  const start = performance.now()
  try {
    const decoded = await decodePayloadString(encoded)
    validateRedirectTarget(decoded.target)
    const durationMs = performance.now() - start
    return new Response(null, {
      status: 302,
      headers: {
        Location: decoded.target,
        "Server-Timing": `decode;dur=${durationMs.toFixed(2)}`,
        ...REDIRECT_HEADERS,
      },
    })
  } catch (e) {
    if (e instanceof DecodeError && e.code === "CHECKSUM_FAILED") {
      const suggestion = suggestHumanCorrection(encoded)
      const body = suggestion
        ? `checksum failed. did you mean: ${config.publicOrigin}/${suggestion}`
        : "checksum failed"
      return errorResponse(400, body)
    }
    if (e instanceof DecodeError) {
      return errorResponse(400, `invalid payload: ${e.code}`)
    }
    if (e instanceof RedirectError) {
      return errorResponse(400, `invalid target: ${e.message}`)
    }
    return errorResponse(400, "invalid payload")
  }
}
