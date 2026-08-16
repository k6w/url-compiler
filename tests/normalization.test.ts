import { describe, expect, test } from "bun:test"
import { canonicalize } from "@/lib/url/normalize"
import { parseUrl } from "@/lib/url/parse"
import { toUrl } from "@/lib/url/model"

describe("safe normalization", () => {
  test("lowercases hostname", () => {
    expect(canonicalize("https://EXAMPLE.com/Path").canonical).toBe("https://example.com/Path")
  })

  test("removes default ports", () => {
    expect(canonicalize("http://example.com:80/a").canonical).toBe("http://example.com/a")
    expect(canonicalize("https://example.com:443/a").canonical).toBe("https://example.com/a")
  })

  test("keeps custom ports", () => {
    expect(canonicalize("https://example.com:8443/a").canonical).toBe("https://example.com:8443/a")
  })

  test("implicit https via flag, canonical string unchanged", () => {
    const { model } = canonicalize("https://example.com/")
    expect(model.scheme).toBe("https")
  })

  test("preserves query order", () => {
    expect(canonicalize("https://example.com/?b=2&a=1").canonical).toBe("https://example.com/?b=2&a=1")
  })

  test("preserves duplicate keys", () => {
    const { model } = canonicalize("https://example.com/?a=1&a=2")
    expect(model.query).toEqual([
      { key: "a", value: "1" },
      { key: "a", value: "2" },
    ])
  })

  test("preserves bare flags and empty values distinctly", () => {
    const { model } = canonicalize("https://example.com/?flag&empty=")
    expect(model.query).toEqual([
      { key: "flag", value: null },
      { key: "empty", value: "" },
    ])
  })

  test("preserves fragment", () => {
    expect(canonicalize("https://example.com/p#sec").canonical).toBe("https://example.com/p#sec")
    expect(canonicalize("https://example.com/p#").canonical).toBe("https://example.com/p#")
  })

  test("decodes percent-encoded unreserved characters", () => {
    expect(canonicalize("https://example.com/%41%42").canonical).toBe("https://example.com/AB")
    expect(canonicalize("https://example.com/%7Euser").canonical).toBe("https://example.com/~user")
  })

  test("keeps reserved percent-escapes intact", () => {
    expect(canonicalize("https://example.com/a%2Fb").canonical).toBe("https://example.com/a%2Fb")
    expect(canonicalize("https://example.com/a%2Bb").canonical).toBe("https://example.com/a%2Bb")
    expect(canonicalize("https://example.com/?d=a%26b").canonical).toBe("https://example.com/?d=a%26b")
    expect(canonicalize("https://example.com/?d=a%3Db").canonical).toBe("https://example.com/?d=a%3Db")
  })

  test("preserves trailing slash", () => {
    expect(canonicalize("https://example.com/a/b/").canonical).toBe("https://example.com/a/b/")
  })

  test("bare query and fragment markers survive round-trip", () => {
    expect(canonicalize("https://example.com/?").canonical).toBe("https://example.com/?")
    expect(canonicalize("https://example.com/#").canonical).toBe("https://example.com/#")
    expect(canonicalize("https://example.com/?#").canonical).toBe("https://example.com/?#")
  })

  test("internationalized hostnames become punycode", () => {
    const { model } = canonicalize("https://пример.рф/x")
    expect(model.hostname).toBe("xn--e1afmkfd.xn--p1ai")
  })

  test("unicode path segments decode to raw model strings", () => {
    const { model } = canonicalize("https://example.com/%CF%80/%F0%9F%8E%89")
    expect(model.pathSegments.map((s) => s.text)).toEqual(["π", "🎉"])
    expect(toUrl(model)).toBe("https://example.com/%CF%80/%F0%9F%8E%89")
  })
})

describe("aggressive normalization", () => {
  test("strips tracking parameters when enabled", () => {
    const { canonical } = canonicalize(
      "https://example.com/p?id=7&utm_source=google&utm_medium=cpc&gclid=X987y&fbclid=aaa",
      { aggressive: true },
    )
    expect(canonical).toBe("https://example.com/p?id=7")
  })

  test("keeps tracking parameters by default", () => {
    const { canonical } = canonicalize("https://example.com/p?id=7&utm_source=google")
    expect(canonical).toBe("https://example.com/p?id=7&utm_source=google")
  })

  test("drops empty query when only tracking params existed", () => {
    const { canonical } = canonicalize("https://example.com/p?gclid=X", { aggressive: true })
    expect(canonical).toBe("https://example.com/p")
  })
})

describe("parse edge cases", () => {
  test("root path yields zero segments", () => {
    const { model } = canonicalize("https://example.com/")
    expect(model.pathSegments).toEqual([])
  })

  test("empty trailing segment encodes trailing slash", () => {
    const { model } = canonicalize("https://example.com/a/")
    expect(model.pathSegments.map((s) => s.text)).toEqual(["a", ""])
  })

  test("credentials are extracted", () => {
    const { model } = canonicalize("https://u:p@example.com/")
    expect(model.username).toBe("u")
    expect(model.password).toBe("p")
    expect(toUrl(model)).toBe("https://u:p@example.com/")
  })

  test("userinfo without password", () => {
    const { model } = canonicalize("https://u@example.com/")
    expect(model.username).toBe("u")
    expect(model.password).toBeUndefined()
  })

  test("query value with equals sign stays opaque", () => {
    const { model } = canonicalize("https://example.com/?a=b=c")
    expect(model.query).toEqual([{ key: "a", value: "b=c" }])
  })

  test("query key with empty value marker", () => {
    const { model } = canonicalize("https://example.com/?=")
    expect(model.query).toEqual([{ key: "", value: "" }])
  })

  test("non-http schemes are rejected at parse", () => {
    expect(() => parseUrl("ftp://example.com/")).toThrow(/unsupported scheme/)
  })
})
