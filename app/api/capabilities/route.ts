import { config } from "@/lib/config"
import { privateKeysAvailable } from "@/lib/crypto/encryption"

export const runtime = "nodejs"

/**
 * What this deployment can actually do. The UI reads this so encrypted modes
 * render as disabled-with-a-reason instead of failing only once clicked.
 */
export function GET() {
  return Response.json(
    {
      origin: config.publicOrigin,
      dictionaryVersion: config.activeDictionaryVersion,
      maxTargetLength: config.maxTargetLength,
      privateMode: config.enablePrivateMode,
      serverKeys: config.enablePrivateMode && privateKeysAvailable(),
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}
