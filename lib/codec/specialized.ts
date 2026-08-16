import { config } from "../config"
import { getDictionaries, DictionarySet } from "../dictionaries/version"
import { hostById, lookupHost } from "../dictionaries/hosts"
import { matchLongestSuffix, suffixById } from "../dictionaries/suffixes"
import { pathById } from "../dictionaries/paths"
import { queryKeyById } from "../dictionaries/query-keys"
import { valueById } from "../dictionaries/values"
import { UrlModel, QueryPair, toUrl } from "../url/model"
import { validateModelLimits } from "../url/validate"
import { ByteReader } from "./reader"
import {
  Opcode,
  INLINE_DICTIONARY_BASE,
  INLINE_INTEGER_BASE,
  isInlineDictionaryByte,
  isInlineIntegerByte,
  varintLen,
  dictionaryRefCost,
} from "./opcodes"
import { ByteWriter, zigzagEncode } from "./writer"
import {
  DecodeError,
  FLAG_CREDENTIALS,
  FLAG_DICT_VERSION_EXT,
  FLAG_FRAGMENT,
  FLAG_HTTP,
  FLAG_PORT,
  FLAG_QUERY,
  formatByte,
} from "./types"

const utf8 = new TextEncoder()
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const HEX_RE = /^[0-9a-f]+$/
const INT_RE = /^(0|-?[1-9]\d*)$/

interface Emission {
  cost: number
  emit: (w: ByteWriter) => void
}

function literalEmission(text: string): Emission {
  const bytes = utf8.encode(text)
  const cost = 1 + varintLen(bytes.length) + bytes.length
  return {
    cost,
    emit: (w) => {
      w.byte(Opcode.LITERAL_BYTES)
      w.varint(bytes.length)
      w.bytes(bytes)
    },
  }
}

function dictRefEmission(opcode: number, id: number): Emission {
  return {
    cost: dictionaryRefCost(id),
    emit: (w) => {
      w.byte(opcode)
      w.varint(id)
    },
  }
}

function inlineDictEmission(id: number): Emission {
  return {
    cost: 1,
    emit: (w) => w.byte(INLINE_DICTIONARY_BASE + id),
  }
}

function contextDictEmission(opcode: number, id: number): Emission {
  return id < 32 ? inlineDictEmission(id) : dictRefEmission(opcode, id)
}

function integerEmission(text: string): Emission | null {
  if (!INT_RE.test(text)) return null
  const n = Number(text)
  if (n > 0x7fffffff || n < -0x80000000) return null
  if (n >= 0 && n <= 31) {
    return {
      cost: 1,
      emit: (w) => w.byte(INLINE_INTEGER_BASE + n),
    }
  }
  const z = zigzagEncode(n)
  return {
    cost: 1 + varintLen(z),
    emit: (w) => {
      w.byte(Opcode.INTEGER)
      w.zigzag(n)
    },
  }
}

function uuidEmission(text: string): Emission | null {
  if (!UUID_RE.test(text)) return null
  const bytes = hexToBytes(text.replace(/-/g, ""))
  return {
    cost: 1 + 16,
    emit: (w) => {
      w.byte(Opcode.UUID)
      w.bytes(bytes)
    },
  }
}

function hexEmission(text: string): Emission | null {
  if (text.length < 2 || text.length % 2 !== 0 || !HEX_RE.test(text)) return null
  const bytes = hexToBytes(text)
  return {
    cost: 1 + varintLen(bytes.length) + bytes.length,
    emit: (w) => {
      w.byte(Opcode.HEX_BYTES)
      w.varint(bytes.length)
      w.bytes(bytes)
    },
  }
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function bytesToHex(bytes: Uint8Array): string {
  let s = ""
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0")
  return s
}

function bytesToUuid(bytes: Uint8Array): string {
  const h = bytesToHex(bytes)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

function cheapest(candidates: Emission[]): Emission {
  let best = candidates[0]
  for (const c of candidates) {
    if (c.cost < best.cost) best = c
  }
  return best
}

function typedValueEmissions(text: string): Emission[] {
  const emissions: Emission[] = [literalEmission(text)]
  const int = integerEmission(text)
  if (int) emissions.push(int)
  const uuid = uuidEmission(text)
  if (uuid) emissions.push(uuid)
  const hex = hexEmission(text)
  if (hex) emissions.push(hex)
  return emissions
}

function hostEmissions(hostname: string, set: DictionarySet): Emission[] {
  const wholeLiteral: Emission = {
    cost: 1 + varintLen(hostname.length) + hostname.length + 1,
    emit: (w) => {
      const bytes = utf8.encode(hostname)
      w.byte(Opcode.LITERAL_BYTES)
      w.varint(bytes.length)
      w.bytes(bytes)
      w.byte(Opcode.END)
    },
  }
  const out = [wholeLiteral]

  const full = lookupHost(set, hostname)
  if (full) {
    const ref = contextDictEmission(Opcode.HOST_FULL, full.id)
    out.push({
      cost: ref.cost + 1,
      emit: (w) => {
        ref.emit(w)
        w.byte(Opcode.END)
      },
    })
  }

  const labels = hostname.split(".")
  const match = matchLongestSuffix(set, hostname)
  const headCount = match ? labels.length - match.labels : labels.length
  const useSuffix = match !== null && headCount >= 1
  const effectiveHead = useSuffix ? headCount : labels.length

  const literalWholeCheaperThanStructured =
    wholeLiteral.cost <= (effectiveHead > 0 ? 2 : Infinity)
  if (effectiveHead >= 1 && !(match === null && labels.length === 1 && literalWholeCheaperThanStructured)) {
    const labelEmissions: Emission[] = []
    let cost = 0
    for (let i = 0; i < effectiveHead; i++) {
      const label = labels[i]
      const lit = literalEmission(label)
      const id = set.labelIndex.get(label)
      const ref = id !== undefined ? dictRefEmission(Opcode.HOST_LABEL, id) : null
      const chosen = ref && ref.cost < lit.cost ? ref : lit
      labelEmissions.push(chosen)
      cost += chosen.cost
    }
    if (useSuffix && match) {
      cost += 1 + varintLen(match.id)
    }
    cost += 1
    out.push({
      cost,
      emit: (w) => {
        for (const le of labelEmissions) le.emit(w)
        if (useSuffix && match) {
          w.byte(Opcode.SUFFIX)
          w.varint(match.id)
        }
        w.byte(Opcode.END)
      },
    })
  }

  return out
}

function pathSegmentEmissions(text: string, set: DictionarySet): Emission[] {
  const emissions = typedValueEmissions(text)
  const id = set.pathIndex.get(text)
  if (id !== undefined) emissions.push(contextDictEmission(Opcode.PATH_TOKEN, id))
  return emissions
}

function queryKeyEmissions(text: string, set: DictionarySet): Emission[] {
  const emissions = typedValueEmissions(text)
  const id = set.queryKeyIndex.get(text)
  if (id !== undefined) emissions.push(contextDictEmission(Opcode.QUERY_KEY, id))
  return emissions
}

function queryValueEmissions(text: string, set: DictionarySet): Emission[] {
  const emissions = typedValueEmissions(text)
  const id = set.valueIndex.get(text)
  if (id !== undefined) emissions.push(contextDictEmission(Opcode.COMMON_VALUE, id))
  return emissions
}

function encodePath(segments: string[], set: DictionarySet, w: ByteWriter): void {
  const n = segments.length
  w.varint(n)
  if (n === 0) return

  const single = segments.map((s) => cheapest(pathSegmentEmissions(s, set)))

  const dp = new Array<number>(n + 1).fill(Infinity)
  dp[0] = 0
  type Back = { kind: "single" } | { kind: "backref"; at: number } | { kind: "repeat"; start: number; extra: number }
  const back = new Array<Back | null>(n + 1).fill(null)

  for (let i = 1; i <= n; i++) {
    const viaSingle = dp[i - 1] + single[i - 1].cost
    if (viaSingle < dp[i]) {
      dp[i] = viaSingle
      back[i] = { kind: "single" }
    }
    for (let m = i - 2; m >= 0; m--) {
      if (segments[m] === segments[i - 1]) {
        const c = dp[i - 1] + 1 + varintLen(m)
        if (c < dp[i]) {
          dp[i] = c
          back[i] = { kind: "backref", at: m }
        }
      }
    }
    for (let k = 2; k <= i; k++) {
      const a = i - k
      if (segments[a] !== segments[i - 1]) break
      const c = dp[a] + single[a].cost + 1 + varintLen(k - 1)
      if (c < dp[i]) {
        dp[i] = c
        back[i] = { kind: "repeat", start: a, extra: k - 1 }
      }
    }
  }

  const ops: Array<() => void> = []
  let i = n
  while (i > 0) {
    const b = back[i]
    if (b === null) throw new Error("unreachable dp state")
    if (b.kind === "single") {
      const idx = i - 1
      const enc = single[idx]
      ops.push(() => enc.emit(w))
      i--
    } else if (b.kind === "backref") {
      const at = b.at
      ops.push(() => {
        w.byte(Opcode.BACKREF)
        w.varint(at)
      })
      i--
    } else {
      const start = b.start
      const extra = b.extra
      const enc = single[start]
      ops.push(() => {
        enc.emit(w)
        w.byte(Opcode.REPEAT)
        w.varint(extra)
      })
      i = start
    }
  }
  for (let j = ops.length - 1; j >= 0; j--) ops[j]()
}

export function encodeSpecialized(model: UrlModel, dictVersion: number): Uint8Array {
  validateModelLimits(model)
  const set = getDictionaries(dictVersion)

  let flags = 0
  if (model.scheme === "http") flags |= FLAG_HTTP
  if (model.port !== undefined) flags |= FLAG_PORT
  if (model.username !== undefined || model.password !== undefined) flags |= FLAG_CREDENTIALS
  if (model.queryPresent) flags |= FLAG_QUERY
  if (model.fragmentPresent) flags |= FLAG_FRAGMENT
  if (dictVersion > 0) flags |= FLAG_DICT_VERSION_EXT

  const body = new ByteWriter()
  cheapest(hostEmissions(model.hostname, set)).emit(body)

  if (flags & FLAG_CREDENTIALS) {
    const ub = utf8.encode(model.username ?? "")
    body.byte(Opcode.USERNAME)
    body.varint(ub.length)
    body.bytes(ub)
    if (model.password !== undefined) {
      const pb = utf8.encode(model.password)
      body.byte(Opcode.PASSWORD)
      body.varint(pb.length)
      body.bytes(pb)
    }
  }

  if (flags & FLAG_PORT) {
    body.byte(Opcode.PORT)
    body.varint(model.port!)
  }

  encodePath(
    model.pathSegments.map((s) => s.text),
    set,
    body,
  )

  if (flags & FLAG_QUERY) {
    body.varint(model.query.length)
    for (const pair of model.query) {
      cheapest(queryKeyEmissions(pair.key, set)).emit(body)
      if (pair.value === null) {
        body.byte(Opcode.EMPTY_VALUE)
      } else if (pair.value === "") {
        body.byte(Opcode.LITERAL_BYTES)
        body.varint(0)
      } else if (pair.value === "true") {
        body.byte(Opcode.BOOLEAN_TRUE)
      } else if (pair.value === "false") {
        body.byte(Opcode.BOOLEAN_FALSE)
      } else {
        cheapest(queryValueEmissions(pair.value, set)).emit(body)
      }
    }
  }

  if (flags & FLAG_FRAGMENT) {
    const fb = utf8.encode(model.fragment ?? "")
    body.byte(Opcode.FRAGMENT)
    body.varint(fb.length)
    body.bytes(fb)
  }

  const w = new ByteWriter()
  w.byte(formatByte("specialized", 0))
  w.byte(flags)
  if (flags & FLAG_DICT_VERSION_EXT) w.varint(dictVersion)
  w.bytes(body.finish())
  return w.finish()
}

type InstructionContext = "path" | "key" | "value"

function resolveContextDict(b: number, set: DictionarySet, ctx: InstructionContext): string {
  const inlineId = b - INLINE_DICTIONARY_BASE
  if (ctx === "path") return pathById(set, inlineId)
  if (ctx === "key") return queryKeyById(set, inlineId)
  return valueById(set, inlineId)
}

function decodeInstruction(b: number, r: ByteReader, set: DictionarySet, ctx: InstructionContext): string {
  if (isInlineDictionaryByte(b)) {
    const inlineId = b - INLINE_DICTIONARY_BASE
    const dict = ctx === "path" ? set.paths : ctx === "key" ? set.queryKeys : set.values
    if (inlineId >= dict.length) throw new DecodeError("INVALID_DICT_ID", `dictionary id out of range: ${inlineId}`)
    return resolveContextDict(b, set, ctx)
  }
  switch (b) {
    case Opcode.PATH_TOKEN:
    case Opcode.QUERY_KEY:
    case Opcode.COMMON_VALUE: {
      const id = r.readVarint()
      if (ctx === "path") {
        if (id >= set.paths.length) throw new DecodeError("INVALID_DICT_ID")
        return pathById(set, id)
      }
      if (ctx === "key") {
        if (id >= set.queryKeys.length) throw new DecodeError("INVALID_DICT_ID")
        return queryKeyById(set, id)
      }
      if (id >= set.values.length) throw new DecodeError("INVALID_DICT_ID")
      return valueById(set, id)
    }
    case Opcode.LITERAL_BYTES: {
      const len = r.readVarint()
      if (len > config.maxSegmentBytes) throw new DecodeError("LIMIT_EXCEEDED", "literal too large")
      return r.readUtf8(len)
    }
    case Opcode.INTEGER:
      return String(r.readZigzag())
    case Opcode.UUID:
      return bytesToUuid(r.readBytes(16))
    case Opcode.HEX_BYTES: {
      const count = r.readVarint()
      if (count > config.maxSegmentBytes) throw new DecodeError("LIMIT_EXCEEDED", "hex run too large")
      return bytesToHex(r.readBytes(count))
    }
    default:
      throw new DecodeError("INVALID_OPCODE", `opcode 0x${b.toString(16)} not allowed in ${ctx} context`)
  }
}

function isInlineIntegerValue(b: number): boolean {
  return isInlineIntegerByte(b)
}

export function decodeSpecialized(r: ByteReader, flags: number, set: DictionarySet): UrlModel {
  let wholeHost: string | null = null
  const labels: string[] = []
  let suffix: string | null = null

  for (;;) {
    const b = r.readByte()
    if (b === Opcode.END) break
    if (labels.length > 16) throw new DecodeError("LIMIT_EXCEEDED", "too many host labels")
    if (isInlineDictionaryByte(b)) {
      if (wholeHost !== null) throw new DecodeError("INVALID_OPCODE", "duplicate host")
      const id = b - INLINE_DICTIONARY_BASE
      if (id >= set.hosts.length) throw new DecodeError("INVALID_DICT_ID")
      wholeHost = hostById(set, id)
    } else if (b === Opcode.HOST_FULL) {
      if (wholeHost !== null) throw new DecodeError("INVALID_OPCODE", "duplicate host")
      const id = r.readVarint()
      if (id >= set.hosts.length) throw new DecodeError("INVALID_DICT_ID")
      wholeHost = hostById(set, id)
    } else if (b === Opcode.HOST_LABEL) {
      const id = r.readVarint()
      if (id >= set.labels.length) throw new DecodeError("INVALID_DICT_ID")
      labels.push(set.labels[id])
    } else if (b === Opcode.LITERAL_BYTES) {
      const len = r.readVarint()
      if (len > 63) throw new DecodeError("LIMIT_EXCEEDED", "host label too long")
      labels.push(r.readUtf8(len))
    } else if (b === Opcode.SUFFIX) {
      if (suffix !== null) throw new DecodeError("INVALID_OPCODE", "duplicate suffix")
      const id = r.readVarint()
      if (id >= set.suffixes.length) throw new DecodeError("INVALID_DICT_ID")
      suffix = suffixById(set, id)
    } else {
      throw new DecodeError("INVALID_OPCODE", `opcode 0x${b.toString(16)} not allowed in host context`)
    }
  }
  if (wholeHost !== null && (labels.length > 0 || suffix !== null)) {
    throw new DecodeError("INVALID_OPCODE", "conflicting host encodings")
  }
  let hostname: string
  if (wholeHost !== null) {
    hostname = wholeHost
  } else if (labels.length > 0) {
    hostname = labels.join(".") + (suffix !== null ? "." + suffix : "")
  } else {
    throw new DecodeError("INVALID_OPCODE", "empty host section")
  }
  if (hostname.length === 0 || hostname.length > 253) {
    throw new DecodeError("VALUE_OUT_OF_RANGE", "invalid hostname length")
  }

  let username: string | undefined
  let password: string | undefined
  if (flags & FLAG_CREDENTIALS) {
    if (r.readByte() !== Opcode.USERNAME) throw new DecodeError("INVALID_OPCODE", "expected USERNAME")
    const len = r.readVarint()
    if (len > 512) throw new DecodeError("LIMIT_EXCEEDED")
    username = r.readUtf8(len)
    if (r.peek() === Opcode.PASSWORD) {
      r.readByte()
      const plen = r.readVarint()
      if (plen > 512) throw new DecodeError("LIMIT_EXCEEDED")
      password = r.readUtf8(plen)
    }
  }

  let port: number | undefined
  if (flags & FLAG_PORT) {
    if (r.readByte() !== Opcode.PORT) throw new DecodeError("INVALID_OPCODE", "expected PORT")
    port = r.readVarint()
    if (port < 1 || port > 65535) throw new DecodeError("VALUE_OUT_OF_RANGE", `invalid port: ${port}`)
  }

  const segCount = r.readVarint()
  if (segCount > config.maxPathSegments) throw new DecodeError("LIMIT_EXCEEDED", "too many path segments")
  const segments: string[] = []
  while (segments.length < segCount) {
    const b = r.readByte()
    if (isInlineIntegerValue(b)) {
      segments.push(String(b - INLINE_INTEGER_BASE))
      continue
    }
    switch (b) {
      case Opcode.REPEAT: {
        const extra = r.readVarint()
        if (extra < 1 || segments.length === 0) throw new DecodeError("INVALID_OPCODE", "invalid REPEAT")
        if (segments.length + extra > segCount) throw new DecodeError("VALUE_OUT_OF_RANGE", "REPEAT overflows segment count")
        const last = segments[segments.length - 1]
        for (let j = 0; j < extra; j++) segments.push(last)
        break
      }
      case Opcode.BACKREF: {
        const idx = r.readVarint()
        if (idx >= segments.length) throw new DecodeError("VALUE_OUT_OF_RANGE", "BACKREF index out of range")
        segments.push(segments[idx])
        break
      }
      case Opcode.EMPTY_VALUE:
      case Opcode.BOOLEAN_TRUE:
      case Opcode.BOOLEAN_FALSE:
        throw new DecodeError("INVALID_OPCODE", "opcode not allowed in path context")
      default:
        segments.push(decodeInstruction(b, r, set, "path"))
    }
  }
  if (segments.length !== segCount) throw new DecodeError("VALUE_OUT_OF_RANGE", "segment count mismatch")

  const query: QueryPair[] = []
  let queryPresent = false
  if (flags & FLAG_QUERY) {
    queryPresent = true
    const pairCount = r.readVarint()
    if (pairCount > config.maxQueryPairs) throw new DecodeError("LIMIT_EXCEEDED", "too many query pairs")
    for (let p = 0; p < pairCount; p++) {
      const kb = r.readByte()
      if (kb === Opcode.EMPTY_VALUE || kb === Opcode.BOOLEAN_TRUE || kb === Opcode.BOOLEAN_FALSE || kb === Opcode.REPEAT || kb === Opcode.BACKREF) {
        throw new DecodeError("INVALID_OPCODE", "opcode not allowed for query key")
      }
      const key = isInlineIntegerByte(kb) ? String(kb - INLINE_INTEGER_BASE) : decodeInstruction(kb, r, set, "key")
      let value: string | null
      const vb = r.readByte()
      if (vb === Opcode.EMPTY_VALUE) value = null
      else if (vb === Opcode.BOOLEAN_TRUE) value = "true"
      else if (vb === Opcode.BOOLEAN_FALSE) value = "false"
      else if (vb === Opcode.REPEAT || vb === Opcode.BACKREF) throw new DecodeError("INVALID_OPCODE", "opcode not allowed for query value")
      else value = isInlineIntegerByte(vb) ? String(vb - INLINE_INTEGER_BASE) : decodeInstruction(vb, r, set, "value")
      query.push({ key, value })
    }
  }

  let fragment: string | undefined
  let fragmentPresent = false
  if (flags & FLAG_FRAGMENT) {
    fragmentPresent = true
    if (r.readByte() !== Opcode.FRAGMENT) throw new DecodeError("INVALID_OPCODE", "expected FRAGMENT")
    const len = r.readVarint()
    if (len > config.maxSegmentBytes) throw new DecodeError("LIMIT_EXCEEDED", "fragment too large")
    fragment = r.readUtf8(len)
  }

  r.expectEnd()

  const model: UrlModel = {
    scheme: flags & FLAG_HTTP ? "http" : "https",
    hostname,
    port,
    username,
    password,
    pathSegments: segments.map((text) => ({ text })),
    query,
    queryPresent,
    fragment,
    fragmentPresent,
  }
  validateModelLimits(model)
  return model
}

export function specializedToUrl(model: UrlModel): string {
  return toUrl(model)
}
