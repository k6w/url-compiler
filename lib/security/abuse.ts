interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

export function checkRateLimit(key: string, limit: number, windowMs = 60_000): boolean {
  const now = Date.now()
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) {
      if (now >= v.resetAt) buckets.delete(k)
    }
  }
  let bucket = buckets.get(key)
  if (bucket === undefined || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs }
    buckets.set(key, bucket)
  }
  bucket.count++
  return bucket.count <= limit
}

export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) {
    const first = forwarded.split(",")[0].trim()
    if (first) return first
  }
  return "local"
}

export function resetRateLimits(): void {
  buckets.clear()
}
