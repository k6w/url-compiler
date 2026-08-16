import { UrlModel, QueryPair, PathSegment } from "../url/model"
import type { Reader } from "./reader"
import type { StreamWriter } from "./writer"
import { DecodeError } from "./types"
import { Opcode } from "./opcodes"
import {
  Emission,
  cheapest,
  literalEmission,
  integerEmission,
  uuidEmission,
  hexEmission,
  decodeTypedValue,
} from "./emissions"

/**
 * Service templates (spec §16). IDs are immutable: never reuse or renumber.
 * A template applies only on a strict full-structure match — never because
 * the hostname matches alone — and reconstructs the destination byte-exact.
 * Nothing is dropped or rewritten: if anything would differ (extra query
 * params, alternate host form like m.youtube.com, t=1m30s durations), the
 * template is skipped and the generic bytecode is used. IDs are one per
 * host variant (e.g. youtube-watch www=0, bare=6).
 */

export const Opcode_SERVICE_TEMPLATE = Opcode.SERVICE_TEMPLATE

export interface TemplateParts {
  hostname: string
  pathSegments: PathSegment[]
  query: QueryPair[]
  queryPresent: boolean
}

export interface TemplateMatch {
  id: number
  params: string[]
  parts: TemplateParts
}

export interface ServiceTemplate {
  readonly id: number
  readonly name: string
  readonly hosts: readonly string[]
  match(model: UrlModel): TemplateMatch | null
  apply(params: string[]): TemplateParts
}

const YT_HOSTS = ["www.youtube.com", "youtube.com"]
const AMAZON_HOSTS = ["www.amazon.com"]
const GITHUB_HOST = "github.com"

const VIDEO_ID_RE = /^[\w-]{6,20}$/
const ASIN_RE = /^[A-Z0-9]{10}$/

function parseYoutubeSeconds(value: string): number | null {
  if (!/^\d+$/.test(value)) return null
  const n = Number(value)
  return n <= 0x7fffffff ? n : null
}

function baseEligible(model: UrlModel): boolean {
  return (
    model.scheme === "https" &&
    model.port === undefined &&
    model.username === undefined &&
    model.password === undefined &&
    !model.fragmentPresent
  )
}

function youtubeWatch(id: number, host: string): ServiceTemplate {
  return {
    id,
    name: "youtube-watch",
    hosts: [host],
    match(model) {
      if (!baseEligible(model)) return null
      if (model.hostname !== host) return null
      if (model.pathSegments.length !== 1 || model.pathSegments[0].text !== "watch") return null
      const query = model.query
      if (query.length < 1 || query.length > 2) return null
      if (query[0].key !== "v" || query[0].value === null || !VIDEO_ID_RE.test(query[0].value)) return null
      let tSeconds: number | null = null
      if (query.length === 2) {
        if (query[1].key !== "t" || query[1].value === null) return null
        tSeconds = parseYoutubeSeconds(query[1].value)
        if (tSeconds === null) return null
      }
      const params = tSeconds === null ? [query[0].value] : [query[0].value, String(tSeconds)]
      return {
        id: this.id,
        params,
        parts: {
          hostname: host,
          pathSegments: [{ text: "watch" }],
          query: tSeconds === null
            ? [{ key: "v", value: query[0].value }]
            : [
                { key: "v", value: query[0].value },
                { key: "t", value: String(tSeconds) },
              ],
          queryPresent: true,
        },
      }
    },
    apply(params) {
      if (params.length < 1 || params.length > 2 || !VIDEO_ID_RE.test(params[0])) {
        throw new DecodeError("INVALID_OPCODE", "youtube-watch: bad video id")
      }
      const query: QueryPair[] = [{ key: "v", value: params[0] }]
      if (params.length === 2) {
        if (!/^\d+$/.test(params[1])) throw new DecodeError("INVALID_OPCODE", "youtube-watch: bad t")
        query.push({ key: "t", value: params[1] })
      }
      return {
        hostname: host,
        pathSegments: [{ text: "watch" }],
        query,
        queryPresent: true,
      }
    },
  }
}

function youtubeShorts(id: number, host: string): ServiceTemplate {
  return {
    id,
    name: "youtube-shorts",
    hosts: [host],
    match(model) {
      if (!baseEligible(model)) return null
      if (model.hostname !== host) return null
      if (model.pathSegments.length !== 2) return null
      if (model.pathSegments[0].text !== "shorts") return null
      const id = model.pathSegments[1].text
      if (!VIDEO_ID_RE.test(id)) return null
      if (model.queryPresent && model.query.length > 0) return null
      return {
        id: this.id,
        params: [id],
        parts: {
          hostname: host,
          pathSegments: [{ text: "shorts" }, { text: id }],
          query: [],
          queryPresent: false,
        },
      }
    },
    apply(params) {
      if (params.length !== 1 || !VIDEO_ID_RE.test(params[0])) {
        throw new DecodeError("INVALID_OPCODE", "youtube-shorts: bad video id")
      }
      return {
        hostname: host,
        pathSegments: [{ text: "shorts" }, { text: params[0] }],
        query: [],
        queryPresent: false,
      }
    },
  }
}

function githubRepo(): ServiceTemplate {
  return {
    id: 2,
    name: "github-repo",
    hosts: [GITHUB_HOST],
    match(model) {
      if (!baseEligible(model)) return null
      if (model.hostname !== GITHUB_HOST) return null
      if (model.pathSegments.length !== 2) return null
      const [owner, repo] = model.pathSegments.map((s) => s.text)
      if (owner.length === 0 || repo.length === 0) return null
      if (owner.includes(".") && repo.includes(".")) return null
      if (model.queryPresent && model.query.length > 0) return null
      return {
        id: this.id,
        params: [owner, repo],
        parts: {
          hostname: GITHUB_HOST,
          pathSegments: [{ text: owner }, { text: repo }],
          query: [],
          queryPresent: false,
        },
      }
    },
    apply(params) {
      if (params.length !== 2 || params[0].length === 0 || params[1].length === 0) {
        throw new DecodeError("INVALID_OPCODE", "github-repo: bad params")
      }
      return {
        hostname: GITHUB_HOST,
        pathSegments: [{ text: params[0] }, { text: params[1] }],
        query: [],
        queryPresent: false,
      }
    },
  }
}

function githubNumbered(kind: "issues" | "pull", id: number): ServiceTemplate {
  return {
    id,
    name: `github-${kind}`,
    hosts: [GITHUB_HOST],
    match(model) {
      if (!baseEligible(model)) return null
      if (model.hostname !== GITHUB_HOST) return null
      if (model.pathSegments.length !== 4) return null
      const [owner, repo, kindSeg, numSeg] = model.pathSegments.map((s) => s.text)
      if (kindSeg !== kind) return null
      if (owner.length === 0 || repo.length === 0) return null
      if (!/^(0|[1-9]\d*)$/.test(numSeg)) return null
      const n = Number(numSeg)
      if (n > 0x7fffffff) return null
      if (model.queryPresent && model.query.length > 0) return null
      return {
        id: this.id,
        params: [owner, repo, numSeg],
        parts: {
          hostname: GITHUB_HOST,
          pathSegments: [{ text: owner }, { text: repo }, { text: kind }, { text: numSeg }],
          query: [],
          queryPresent: false,
        },
      }
    },
    apply(params) {
      if (params.length !== 3 || params[0].length === 0 || params[1].length === 0) {
        throw new DecodeError("INVALID_OPCODE", `github-${kind}: bad params`)
      }
      if (!/^(0|[1-9]\d*)$/.test(params[2]) || Number(params[2]) > 0x7fffffff) {
        throw new DecodeError("INVALID_OPCODE", `github-${kind}: bad number`)
      }
      return {
        hostname: GITHUB_HOST,
        pathSegments: [{ text: params[0] }, { text: params[1] }, { text: kind }, { text: params[2] }],
        query: [],
        queryPresent: false,
      }
    },
  }
}

function amazonAsin(): ServiceTemplate {
  return {
    id: 5,
    name: "amazon-asin",
    hosts: AMAZON_HOSTS,
    match(model) {
      if (!baseEligible(model)) return null
      if (!AMAZON_HOSTS.includes(model.hostname)) return null
      const segs = model.pathSegments.map((s) => s.text)
      if (segs.length !== 2 || segs[0] !== "dp") return null
      const asin = segs[1]
      if (!ASIN_RE.test(asin)) return null
      if (model.queryPresent && model.query.length > 0) return null
      return {
        id: this.id,
        params: [asin],
        parts: {
          hostname: "www.amazon.com",
          pathSegments: [{ text: "dp" }, { text: asin }],
          query: [],
          queryPresent: false,
        },
      }
    },
    apply(params) {
      if (params.length !== 1 || !ASIN_RE.test(params[0])) {
        throw new DecodeError("INVALID_OPCODE", "amazon-asin: bad ASIN")
      }
      return {
        hostname: "www.amazon.com",
        pathSegments: [{ text: "dp" }, { text: params[0] }],
        query: [],
        queryPresent: false,
      }
    },
  }
}

export const TEMPLATES: readonly ServiceTemplate[] = [
  youtubeWatch(0, "www.youtube.com"),
  youtubeShorts(1, "www.youtube.com"),
  githubRepo(),
  githubNumbered("issues", 3),
  githubNumbered("pull", 4),
  amazonAsin(),
  youtubeWatch(6, "youtube.com"),
  youtubeShorts(7, "youtube.com"),
]

export function matchTemplate(model: UrlModel): TemplateMatch | null {
  for (const template of TEMPLATES) {
    if (!template.hosts.includes(model.hostname)) continue
    const match = template.match(model)
    if (match !== null) return match
  }
  return null
}

export function templateById(id: number): ServiceTemplate {
  const template = TEMPLATES.find((t) => t.id === id)
  if (template === undefined) throw new DecodeError("INVALID_DICT_ID", `unknown template id: ${id}`)
  return template
}

export function paramEmissions(param: string): Emission {
  const candidates: Emission[] = [literalEmission(param)]
  const int = integerEmission(param)
  if (int) candidates.push(int)
  const uuid = uuidEmission(param)
  if (uuid) candidates.push(uuid)
  const hex = hexEmission(param)
  if (hex) candidates.push(hex)
  return cheapest(candidates)
}

export function writeTemplateBody(w: StreamWriter, match: TemplateMatch): void {
  w.byte(Opcode.SERVICE_TEMPLATE)
  w.varint(match.id)
  w.varint(match.params.length)
  for (const param of match.params) {
    paramEmissions(param).emit(w)
  }
}

export function decodeTemplateBody(r: Reader): TemplateParts {
  const id = r.readVarint()
  const template = templateById(id)
  const count = r.readVarint()
  if (count > 8) throw new DecodeError("LIMIT_EXCEEDED", "too many template params")
  const params: string[] = []
  for (let i = 0; i < count; i++) {
    params.push(decodeTypedValue(r))
  }
  return template.apply(params)
}
