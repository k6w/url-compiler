import { decodePayloadString } from "@/lib/codec/candidates"
import { DecodeError } from "@/lib/codec/types"
import { validateRedirectTarget } from "@/lib/security/redirect"
import { checkRateLimit, clientKey } from "@/lib/security/abuse"
import { config } from "@/lib/config"

export const runtime = "nodejs"

export async function POST(request: Request) {
  if (!checkRateLimit(`inspect:${clientKey(request)}`, config.rateLimitEncode)) {
    return Response.json({ error: "rate_limited" }, { status: 429 })
  }

  let payload: unknown
  try {
    const body = (await request.json()) as { payload?: unknown }
    payload = body.payload
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 })
  }

  if (typeof payload !== "string" || payload.length === 0) {
    return Response.json({ error: "missing_payload" }, { status: 400 })
  }

  try {
    const decoded = await decodePayloadString(payload)
    const parsed = validateRedirectTarget(decoded.target)
    return Response.json({
      payload,
      alphabet: decoded.via,
      format: decoded.family,
      formatVersion: decoded.formatVersion,
      dictionaryVersion: decoded.dictionaryVersion,
      target: decoded.target,
      hostname: parsed.hostname,
    })
  } catch (e) {
    if (e instanceof DecodeError) {
      return Response.json({ error: e.code, message: e.message }, { status: 400 })
    }
    return Response.json({ error: "decode_failed", message: e instanceof Error ? e.message : String(e) }, { status: 400 })
  }
}
