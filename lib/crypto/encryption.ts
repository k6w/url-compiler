import { DecodeError } from "../codec/types"

/**
 * Private-mode cryptography (spec §17).
 *
 * Server-readable mode: AES-256-GCM envelope in the reserved format family
 * (0b11). The encrypted payload wraps a complete inner payload (any family);
 * decoding decrypts first, then recurses once (nesting is rejected).
 *
 * Keys come from the environment as 32-byte base64url values and are read
 * per call so rotation tests and hot reload behave:
 *   PAYLOAD_KEY_CURRENT  — used for every new encryption
 *   PAYLOAD_KEY_PREVIOUS — accepted for decryption during rotation
 * Decryption tries the current key first, then the previous key; GCM
 * authentication makes wrong-key attempts fail closed.
 *
 * Server-blind mode uses the same primitives with an ephemeral per-link key
 * delivered in the URL fragment (never sent to the server); see the /p/
 * landing route.
 */

export class PrivateModeError extends Error {
  constructor(message = "private mode is not available") {
    super(message)
    this.name = "PrivateModeError"
  }
}

const NONCE_LENGTH = 12
const KEY_LENGTH = 32

function parseKeyEnv(name: string): Uint8Array | null {
  const raw = process.env[name]
  if (raw === undefined || raw === "") return null
  const bytes = Buffer.from(raw, "base64url")
  if (bytes.length !== KEY_LENGTH) {
    throw new PrivateModeError(`${name} must be 32 bytes of base64url`)
  }
  return new Uint8Array(bytes)
}

export function currentKey(): Uint8Array | null {
  try {
    return parseKeyEnv("PAYLOAD_KEY_CURRENT")
  } catch (e) {
    if (e instanceof PrivateModeError) return null
    throw e
  }
}

export function privateKeysAvailable(): boolean {
  return currentKey() !== null
}

async function importAesKey(raw: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw as BufferSource, { name: "AES-GCM" }, false, usage)
}

/** Envelope: [12-byte nonce][ciphertext+16-byte GCM tag]. */
export async function encryptWithKey(key: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH))
  const cryptoKey = await importAesKey(key, ["encrypt"])
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, cryptoKey, plaintext as BufferSource),
  )
  const out = new Uint8Array(NONCE_LENGTH + ct.length)
  out.set(nonce)
  out.set(ct, NONCE_LENGTH)
  return out
}

async function decryptWithKey(key: Uint8Array, envelope: Uint8Array): Promise<Uint8Array | null> {
  if (envelope.length <= NONCE_LENGTH + 16) return null
  try {
    const nonce = envelope.subarray(0, NONCE_LENGTH)
    const ct = envelope.subarray(NONCE_LENGTH)
    const cryptoKey = await importAesKey(key, ["decrypt"])
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce as BufferSource }, cryptoKey, ct as BufferSource)
    return new Uint8Array(pt)
  } catch {
    return null
  }
}

/** Encrypt an inner payload with PAYLOAD_KEY_CURRENT. */
export async function encryptPayload(inner: Uint8Array): Promise<Uint8Array> {
  const key = currentKey()
  if (key === null) {
    throw new PrivateModeError("PAYLOAD_KEY_CURRENT is not configured")
  }
  return encryptWithKey(key, inner)
}

/** Try PAYLOAD_KEY_CURRENT then PAYLOAD_KEY_PREVIOUS. */
export async function decryptPayload(envelope: Uint8Array): Promise<Uint8Array> {
  const key = currentKey()
  if (key !== null) {
    const viaCurrent = await decryptWithKey(key, envelope)
    if (viaCurrent !== null) return viaCurrent
  }
  const previous = parseKeyEnv("PAYLOAD_KEY_PREVIOUS")
  if (previous !== null) {
    const viaPrevious = await decryptWithKey(previous, envelope)
    if (viaPrevious !== null) return viaPrevious
  }
  if (key === null && previous === null) {
    throw new DecodeError("KEY_UNAVAILABLE", "no payload decryption keys configured")
  }
  throw new DecodeError("DECRYPTION_FAILED", "payload failed authentication with every configured key")
}

/** Server-blind helpers: ephemeral key returned to the caller only. */
export async function generateEphemeralKey(): Promise<Uint8Array> {
  return crypto.getRandomValues(new Uint8Array(KEY_LENGTH))
}
