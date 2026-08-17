#!/usr/bin/env bun
import { encodeUrl, decodePayloadString, encryptCandidate } from "./lib/codec/candidates"
import { config } from "./lib/config"
import { privateKeysAvailable } from "./lib/crypto/encryption"
import { validateRedirectTarget } from "./lib/security/redirect"
import { renderLocalized, type VoiceLocale } from "./lib/alphabet/voice"

const USAGE = `url-compiler CLI

usage:
  bun cli.ts encode <url> [--mode ultra|human|voice|private] [--aggressive] [--locale en|vi|ja]
  bun cli.ts decode <payload>
  bun cli.ts inspect <payload>

environment: PUBLIC_ORIGIN, ACTIVE_DICTIONARY_VERSION, PAYLOAD_KEY_CURRENT (private mode)`

interface Args {
  command: string
  positional: string[]
  flags: Set<string>
  values: Map<string, string>
}

function parseArgs(argv: string[]): Args {
  const flags = new Set<string>()
  const values = new Map<string, string>()
  const positional: string[] = []
  let i = 0
  const valueFlags = new Set(["mode", "locale"])
  while (i < argv.length) {
    const a = argv[i]
    if (a.startsWith("--")) {
      const key = a.slice(2)
      if (valueFlags.has(key)) {
        values.set(key, argv[++i] ?? "")
      } else {
        flags.add(key)
      }
    } else {
      positional.push(a)
    }
    i++
  }
  return { command: positional[0] ?? "", positional, flags, values }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  if (args.flags.has("help") || args.command === "") {
    console.log(USAGE)
    return args.command === "" ? 1 : 0
  }

  if (args.command === "encode") {
    const url = args.positional[1]
    if (url === undefined) {
      console.error("encode: missing <url>")
      return 1
    }
    const mode = args.values.get("mode") ?? "ultra"
    const result = await encodeUrl(url, { aggressive: args.flags.has("aggressive") })
    if (mode === "private") {
      if (!privateKeysAvailable()) {
        console.error("private: PAYLOAD_KEY_CURRENT is not configured")
        return 1
      }
      const payload = await encryptCandidate(result)
      console.log(`${config.publicOrigin}/${payload}`)
      return 0
    }
    const payload = mode === "human" ? result.humanPayload : mode === "voice" ? result.voicePayload : result.ultraPayload
    console.log(`${config.publicOrigin}/${payload}`)
    if (args.flags.has("verbose")) {
      console.error(JSON.stringify({
        canonical: result.canonical,
        format: result.best.format,
        version: result.best.version,
        candidates: result.candidates.map((c) => ({ format: c.format, version: c.version, bytes: c.bytes.length })),
      }, null, 2))
    }
    if (mode === "voice" && args.values.has("locale")) {
      console.error(renderLocalized(payload, args.values.get("locale") as VoiceLocale))
    }
    return 0
  }

  if (args.command === "decode" || args.command === "inspect") {
    const payload = args.positional[1]
    if (payload === undefined) {
      console.error(`${args.command}: missing <payload>`)
      return 1
    }
    try {
      const decoded = await decodePayloadString(payload)
      validateRedirectTarget(decoded.target)
      if (args.command === "decode") {
        console.log(decoded.target)
      } else {
        console.log(JSON.stringify({
          target: decoded.target,
          alphabet: decoded.via,
          format: decoded.family,
          formatVersion: decoded.formatVersion,
          dictionaryVersion: decoded.dictionaryVersion,
          encrypted: decoded.encrypted ?? false,
        }, null, 2))
      }
      return 0
    } catch (e) {
      console.error(`decode failed: ${e instanceof Error ? e.message : String(e)}`)
      return 1
    }
  }

  console.error(`unknown command: ${args.command}`)
  console.log(USAGE)
  return 1
}

process.exit(await main())
