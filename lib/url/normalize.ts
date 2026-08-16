import { UrlModel, cloneModel, toUrl } from "./model"
import { parseUrl } from "./parse"

export interface NormalizeOptions {
  aggressive?: boolean
}

const SAFE_DECODED = /^[\x20A-Za-z0-9\-._~\u0080-\u{10FFFF}]*$/u

const TRACKING_KEYS = new Set([
  "fbclid",
  "gclid",
  "msclkid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "ttclid",
  "twclid",
  "li_fat_id",
  "_ga",
  "_gl",
  "rb_clickid",
  "yclid",
  "ymclid",
  "vmclid",
  "ocid",
  "ito",
])

function isTrackingKey(key: string): boolean {
  return TRACKING_KEYS.has(key) || key.startsWith("utm_")
}

function tryPercentDecode(s: string): string | null {
  if (!s.includes("%")) return s
  try {
    return decodeURIComponent(s)
  } catch {
    return null
  }
}

function normalizeComponent(s: string): string {
  const decoded = tryPercentDecode(s)
  if (decoded !== null && SAFE_DECODED.test(decoded)) return decoded
  return s
}

export function normalizeModel(model: UrlModel, options: NormalizeOptions = {}): UrlModel {
  const normalized = cloneModel(model)
  for (const seg of normalized.pathSegments) {
    seg.text = normalizeComponent(seg.text)
  }
  for (const pair of normalized.query) {
    pair.key = normalizeComponent(pair.key)
    if (pair.value !== null) pair.value = normalizeComponent(pair.value)
  }
  if (normalized.fragment !== undefined) {
    normalized.fragment = normalizeComponent(normalized.fragment)
  }
  if (options.aggressive) {
    normalized.query = normalized.query.filter((p) => !isTrackingKey(p.key))
    normalized.queryPresent = normalized.query.length > 0
  }
  return normalized
}

export interface CanonicalUrl {
  model: UrlModel
  canonical: string
}

export function canonicalize(input: string, options: NormalizeOptions = {}): CanonicalUrl {
  const model = normalizeModel(parseUrl(input), options)
  return { model, canonical: toUrl(model) }
}
