import { Scheme, UrlModel, QueryPair } from "./model"

export class UrlParseError extends Error {
  constructor(message: string, public readonly input?: string) {
    super(message)
    this.name = "UrlParseError"
  }
}

export function parseUrl(input: string): UrlModel {
  let u: URL
  try {
    u = new URL(input)
  } catch {
    throw new UrlParseError("malformed URL", input)
  }
  const scheme = u.protocol.replace(/:$/, "") as Scheme
  if (scheme !== "http" && scheme !== "https") {
    throw new UrlParseError(`unsupported scheme: ${scheme}`, input)
  }

  const pathSegments =
    u.pathname === "/"
      ? []
      : u.pathname.slice(1).split("/").map((text) => ({ text }))

  const query: QueryPair[] = []
  if (u.search.length > 1) {
    for (const part of u.search.slice(1).split("&")) {
      const eq = part.indexOf("=")
      if (eq === -1) query.push({ key: part, value: null })
      else query.push({ key: part.slice(0, eq), value: part.slice(eq + 1) })
    }
  }

  const hashIdx = u.href.indexOf("#")
  const beforeHash = hashIdx >= 0 ? u.href.slice(0, hashIdx) : u.href
  const queryPresent = u.search !== "" || beforeHash.endsWith("?")
  const fragmentPresent = hashIdx >= 0
  const hasCredentials = u.username !== "" || u.password !== ""

  return {
    scheme,
    hostname: u.hostname,
    port: u.port === "" ? undefined : Number(u.port),
    username: hasCredentials ? u.username : undefined,
    password: u.password !== "" ? u.password : undefined,
    pathSegments,
    query,
    queryPresent,
    fragment: fragmentPresent ? u.hash.slice(1) : undefined,
    fragmentPresent,
  }
}
