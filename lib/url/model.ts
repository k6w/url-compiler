export type Scheme = "http" | "https"

export interface QueryPair {
  key: string
  value: string | null
}

export interface PathSegment {
  text: string
}

export interface UrlModel {
  scheme: Scheme
  hostname: string
  port?: number
  username?: string
  password?: string
  pathSegments: PathSegment[]
  query: QueryPair[]
  queryPresent: boolean
  fragment?: string
  fragmentPresent: boolean
}

export function toUrl(m: UrlModel): string {
  let credentials = ""
  if (m.username !== undefined || m.password !== undefined) {
    credentials = `${m.username ?? ""}${m.password !== undefined ? ":" + m.password : ""}@`
  }
  let s = `${m.scheme}://${credentials}${m.hostname}${m.port !== undefined ? ":" + m.port : ""}`
  s += "/" + m.pathSegments.map((seg) => seg.text).join("/")
  if (m.queryPresent) {
    s += "?" + m.query.map((p) => (p.value === null ? p.key : `${p.key}=${p.value}`)).join("&")
  }
  if (m.fragmentPresent) {
    s += "#" + (m.fragment ?? "")
  }
  return new URL(s).href
}

export function cloneModel(m: UrlModel): UrlModel {
  return {
    scheme: m.scheme,
    hostname: m.hostname,
    port: m.port,
    username: m.username,
    password: m.password,
    pathSegments: m.pathSegments.map((seg) => ({ text: seg.text })),
    query: m.query.map((p) => ({ key: p.key, value: p.value })),
    queryPresent: m.queryPresent,
    fragment: m.fragment,
    fragmentPresent: m.fragmentPresent,
  }
}
