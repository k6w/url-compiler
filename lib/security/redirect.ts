import { config } from "../config"

export class RedirectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RedirectError"
  }
}

const CONTROL_CHARS = /[\x00-\x1F\x7F]/

export function validateRedirectTarget(target: string): URL {
  if (target.length === 0) throw new RedirectError("empty target")
  if (target.length > config.maxTargetLength) {
    throw new RedirectError(`target exceeds maximum length: ${target.length}`)
  }
  if (CONTROL_CHARS.test(target)) {
    throw new RedirectError("target contains control characters")
  }
  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    throw new RedirectError("target is not a valid URL")
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new RedirectError(`disallowed protocol: ${parsed.protocol}`)
  }
  if (parsed.hostname === "") {
    throw new RedirectError("target has no hostname")
  }
  return parsed
}
