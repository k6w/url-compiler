"use client"

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { voiceIndex } from "@/lib/alphabet/wordlist"
import { VOICE_WORDS_VI } from "@/lib/alphabet/wordlist-vi"
import { VOICE_WORDS_JA } from "@/lib/alphabet/wordlist-ja"
import { Measure, MeasureIdle } from "./_components/measure"
import { ModeTabs, type ModeOption } from "./_components/mode-tabs"
import { QrPanel } from "./_components/qr-panel"

type Mode = "ultra" | "human" | "voice" | "private" | "blind"
type VoiceLocale = "en" | "vi" | "ja"

const HISTORY_KEY = "url-compiler-history"
const HISTORY_LIMIT = 15
const EXAMPLE = "https://www.example.com/products/12345?utm_source=google&id=7"

interface HistoryEntry {
  url: string
  mode: Mode
  shortUrl: string
  ts: number
}

interface EncodeResponse {
  originalUrl: string
  canonical: string
  mode: Mode
  format: string
  payload: string
  shortUrl: string
  originalLength: number
  shortenedLength: number
  saved: number
  warning: boolean
  encrypted?: boolean
  blind?: boolean
  candidates: { format: string; version: number; bytes: number }[]
}

interface InspectResponse {
  payload: string
  alphabet: string
  format: string
  formatVersion: number
  dictionaryVersion: number
  target: string
}

interface Capabilities {
  origin: string
  dictionaryVersion: number
  maxTargetLength: number
  privateMode: boolean
  serverKeys: boolean
}

const MODES: ModeOption<Mode>[] = [
  {
    id: "ultra",
    label: "Ultra",
    hint: "Densest form. Case-sensitive Base64URL with no separators — best for QR codes, APIs and copy-paste.",
  },
  {
    id: "human",
    label: "Human",
    hint: "Safe to retype. Base32 without i, l, o or u, grouped in fours, with a checksum that catches single-character typos.",
  },
  {
    id: "voice",
    label: "Voice",
    hint: "Safe to read aloud. One word per byte from a fixed 256-word list, plus a checksum word. Much longer, on purpose.",
  },
  {
    id: "private",
    label: "Private",
    hint: "Encrypted with AES-256-GCM. This server holds the key and can decrypt; anyone watching sees only ciphertext.",
  },
  {
    id: "blind",
    label: "Blind",
    hint: "Encrypted with a key that stays in the # fragment, so it never reaches this server. Your browser decrypts on arrival.",
  },
]

const ERRORS: Record<string, string> = {
  rate_limited: "Too many requests from this address. Wait a minute, then try again.",
  invalid_json: "That request could not be read. Reload the page and try again.",
  missing_url: "Enter a URL to compile.",
  private_mode_disabled:
    "Encrypted modes are turned off on this deployment. Set ENABLE_PRIVATE_MODE=true to switch them on.",
}

function loadHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY)
    const parsed = raw ? (JSON.parse(raw) as HistoryEntry[]) : []
    return Array.isArray(parsed) ? parsed.slice(0, HISTORY_LIMIT) : []
  } catch {
    return []
  }
}

function localizedReading(payload: string, locale: VoiceLocale): string {
  if (locale === "en") return payload
  const table = locale === "vi" ? VOICE_WORDS_VI : VOICE_WORDS_JA
  return payload
    .toLowerCase()
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => {
      const index = voiceIndex(part)
      return index === undefined ? part : (table[index] ?? part)
    })
    .join(locale === "ja" ? "・" : " ")
}

function Section({
  label,
  aside,
  children,
}: {
  label: string
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h2 className="eyebrow shrink-0">{label}</h2>
        <span aria-hidden className="h-px flex-1 bg-rule" />
        {aside}
      </div>
      {children}
    </section>
  )
}

function Notice({
  tone,
  children,
}: {
  tone: "warn" | "info"
  children: React.ReactNode
}) {
  return (
    <p
      className="rounded-md border px-3 py-2.5 text-[13px] leading-relaxed"
      style={
        tone === "warn"
          ? { borderColor: "var(--flare)", background: "var(--flare-wash)", color: "var(--flare-text)" }
          : { borderColor: "var(--signal)", background: "var(--signal-wash)", color: "var(--signal-text)" }
      }
    >
      {children}
    </p>
  )
}

export default function Home() {
  const [url, setUrl] = useState("")
  const [mode, setMode] = useState<Mode>("ultra")
  const [aggressive, setAggressive] = useState(false)
  const [result, setResult] = useState<EncodeResponse | null>(null)
  const [inspect, setInspect] = useState<InspectResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const [locale, setLocale] = useState<VoiceLocale>("en")
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void Promise.resolve().then(() => {
      setHistory(loadHistory())
      setHistoryLoaded(true)
    })
    fetch("/api/capabilities")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: Capabilities | null) => setCaps(data))
      .catch(() => setCaps(null))
  }, [])

  const persistHistory = useCallback((entries: HistoryEntry[]) => {
    setHistory(entries)
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries))
    } catch {
      // storage unavailable (private browsing); keep in-memory only
    }
  }, [])

  const blockedModes = useMemo(() => {
    const blocked = new Set<Mode>()
    if (caps && !caps.privateMode) {
      blocked.add("private")
      blocked.add("blind")
    }
    if (caps?.privateMode && !caps.serverKeys) blocked.add("private")
    return blocked
  }, [caps])

  const modeHint = useMemo(() => {
    const hint = MODES.find((m) => m.id === mode)?.hint ?? ""
    if (!blockedModes.has(mode)) return hint
    return mode === "private" && caps?.privateMode
      ? "Unavailable: this deployment has no PAYLOAD_KEY_CURRENT configured."
      : "Unavailable: encrypted modes are turned off on this deployment."
  }, [mode, blockedModes, caps])

  const canCompile = !busy && url.length > 0 && !blockedModes.has(mode)

  const heaviestCandidate = useMemo(
    () => (result ? Math.max(...result.candidates.map((c) => c.bytes), 1) : 1),
    [result],
  )

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setResult(null)
    setInspect(null)
    setCopied(false)
    setShowQr(false)
    try {
      const response = await fetch("/api/encode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, mode, aggressive }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(ERRORS[data.error as string] ?? data.message ?? "The compiler could not encode that URL.")
        return
      }
      const encoded = data as EncodeResponse
      setResult(encoded)
      persistHistory(
        [
          { url, mode, shortUrl: encoded.shortUrl, ts: Date.now() },
          ...loadHistory().filter((entry) => entry.shortUrl !== encoded.shortUrl),
        ].slice(0, HISTORY_LIMIT),
      )
      if (mode === "ultra" || mode === "human" || mode === "voice") {
        const inspectResponse = await fetch("/api/inspect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payload: encoded.payload }),
        })
        if (inspectResponse.ok) setInspect((await inspectResponse.json()) as InspectResponse)
      }
    } catch {
      setError("Could not reach the compiler. Check your connection and try again.")
    } finally {
      setBusy(false)
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setError("Your browser blocked clipboard access. Select the link and copy it manually.")
    }
  }

  const localHref = result
    ? result.blind
      ? `/p/${result.payload}#${result.shortUrl.split("#")[1] ?? ""}`
      : `/${result.payload}`
    : "#"

  return (
    <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-3xl flex-col px-5 sm:px-8">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule py-5">
        <span className="wordmark">URL&middot;COMPILER</span>
        <span aria-hidden className="hidden h-3 w-px bg-rule sm:block" />
        <p className="eyebrow flex flex-wrap gap-x-3 gap-y-1">
          <span>dict v{caps?.dictionaryVersion ?? 1}</span>
          <span aria-hidden>/</span>
          <span>no database</span>
          <span aria-hidden>/</span>
          <span>302 redirect</span>
        </p>
      </header>

      <main className="flex flex-1 flex-col gap-12 py-12">
        <div className="flex flex-col gap-3">
          <h1 className="max-w-lg font-display text-[19px] leading-[1.35] font-semibold tracking-[-0.01em] sm:text-[22px]">
            Every short link carries its whole destination inside itself.
          </h1>
          <p className="max-w-xl text-[15px] text-dim">
            There is no database and no lookup table. The compiler competes several encoders against
            each other, checks that each one decodes back to exactly what you typed, and keeps the
            shortest survivor.
          </p>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <Section
            label="Target"
            aside={
              <button
                type="button"
                onClick={() => {
                  setUrl(EXAMPLE)
                  inputRef.current?.focus()
                }}
                className="eyebrow transition-colors hover:text-signal-text"
              >
                Use an example
              </button>
            }
          >
            <div className="flex flex-col gap-2">
              <input
                ref={inputRef}
                type="url"
                required
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.currentTarget.form?.requestSubmit()
                  }
                }}
                placeholder={EXAMPLE}
                aria-label="Destination URL"
                spellCheck={false}
                autoComplete="off"
                className="w-full rounded-md border border-rule bg-well px-3.5 py-3 font-mono text-[13px] text-bone shadow-[var(--shadow)] transition-colors outline-none placeholder:text-faint focus:border-signal"
              />
              <div className="flex h-4 justify-between gap-3">
                {url.length > 0 && <p className="eyebrow">{url.length} chars in</p>}
                {caps && url.length > caps.maxTargetLength && (
                  <p className="eyebrow" style={{ color: "var(--flare-text)" }}>
                    over the {caps.maxTargetLength} limit
                  </p>
                )}
              </div>
            </div>
          </Section>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <ModeTabs
                label="Encoding mode"
                options={MODES}
                value={mode}
                onChange={setMode}
                disabled={blockedModes}
              />
              <button
                type="submit"
                disabled={!canCompile}
                className={`ml-auto rounded-md px-5 py-2.5 font-display text-[11px] font-bold tracking-[0.14em] uppercase transition-colors ${
                  canCompile
                    ? "bg-signal text-signal-ink hover:opacity-90"
                    : "cursor-not-allowed border border-rule text-faint"
                }`}
              >
                {busy ? "Compiling…" : "▸ Compile"}
              </button>
            </div>

            <label className="flex w-fit cursor-pointer items-center gap-2 text-[13px] text-dim">
              <input
                type="checkbox"
                checked={aggressive}
                onChange={(event) => setAggressive(event.target.checked)}
                className="size-3.5 accent-[var(--signal)]"
              />
              Strip tracking parameters
            </label>

            <p className="min-h-10 max-w-xl text-[13px] text-faint">{modeHint}</p>
          </div>
        </form>

        {!result && !error && (
          <Section label="Measure">
            <div className="flex flex-col gap-4 rounded-md border border-rule bg-panel p-5 shadow-[var(--shadow)]">
              <MeasureIdle />
              <p className="text-[13px] text-faint">
                Nothing measured yet. Compile a URL and both lengths are drawn on this ruler.
              </p>
            </div>
          </Section>
        )}

        <div aria-live="polite" className="flex flex-col gap-12 empty:hidden">
          {error && <Notice tone="warn">{error}</Notice>}

          {result && (
            <>
              <Section label="Measure">
                <div className="flex flex-col gap-5 rounded-md border border-rule bg-panel p-5 shadow-[var(--shadow)]">
                  <Measure
                    originalLength={result.originalLength}
                    shortenedLength={result.shortenedLength}
                  />

                  <div className="flex flex-col gap-3 border-t border-rule pt-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="eyebrow flex items-center gap-2">
                        <span>format</span>
                        <span className="text-signal-text">{result.format}</span>
                      </p>
                      <div className="ml-auto flex gap-2">
                        <button
                          type="button"
                          onClick={() => setShowQr((visible) => !visible)}
                          aria-expanded={showQr}
                          className="eyebrow rounded border border-rule px-2.5 py-1 text-dim transition-colors hover:border-signal hover:text-bone"
                        >
                          {showQr ? "Hide QR" : "QR code"}
                        </button>
                        <button
                          type="button"
                          onClick={() => copy(result.shortUrl)}
                          className="eyebrow rounded border border-rule px-2.5 py-1 text-dim transition-colors hover:border-signal hover:text-bone"
                        >
                          {copied ? "Copied" : "Copy link"}
                        </button>
                        <a
                          href={localHref}
                          className="eyebrow rounded border border-rule px-2.5 py-1 text-dim transition-colors hover:border-signal hover:text-bone"
                        >
                          Open
                        </a>
                      </div>
                    </div>

                    <p className="data break-all text-[13px] leading-relaxed">
                      {result.blind ? (
                        <>
                          {result.shortUrl.split("#")[0]}
                          <span className="text-signal-text">#{result.shortUrl.split("#")[1]}</span>
                        </>
                      ) : (
                        result.shortUrl
                      )}
                    </p>

                    {showQr && <QrPanel value={result.shortUrl} filename={`urlc-${result.payload.slice(0, 12)}`} />}
                  </div>

                  {result.warning &&
                    (result.mode === "voice" ? (
                      <Notice tone="info">
                        Voice links are longer than what you typed, always. You are trading characters
                        for the ability to read the link down a phone line without spelling anything.
                      </Notice>
                    ) : (
                      <Notice tone="warn">
                        This compiled link is not shorter than what you typed. Stateless encoding cannot
                        always win — short, random or already-compact URLs grow instead.
                      </Notice>
                    ))}

                  {result.blind && (
                    <Notice tone="info">
                      The decryption key is the part after <code className="data">#</code>. Browsers never
                      send it to a server, so this one cannot read the destination — but anyone you send
                      the full link to can. Share it whole or not at all.
                    </Notice>
                  )}

                  {result.encrypted && (
                    <Notice tone="info">
                      Encrypted with AES-256-GCM. Only a server holding the configured key can decode it;
                      anyone watching the link sees ciphertext.
                    </Notice>
                  )}

                  {mode === "voice" && (
                    <div className="flex flex-col gap-2 border-t border-rule pt-4">
                      <div className="flex items-center gap-2">
                        <span className="eyebrow">Reading</span>
                        {(["en", "vi", "ja"] as const).map((code) => (
                          <button
                            key={code}
                            type="button"
                            onClick={() => setLocale(code)}
                            aria-pressed={locale === code}
                            className={`rounded px-2 py-0.5 text-[12px] transition-colors ${
                              locale === code ? "bg-signal-wash text-signal-text" : "text-faint hover:text-bone"
                            }`}
                          >
                            {code === "en" ? "English" : code === "vi" ? "Tiếng Việt" : "日本語"}
                          </button>
                        ))}
                      </div>
                      <p className="data rounded-md bg-well px-3 py-2.5 text-[13px] leading-relaxed break-words">
                        {localizedReading(result.payload, locale)}
                      </p>
                      <p className="text-[12px] text-faint">
                        Vietnamese and Japanese are readings of the same bytes. The link itself stays ASCII.
                      </p>
                    </div>
                  )}
                </div>
              </Section>

              <Section label="Candidates" aside={<p className="eyebrow">shortest verified wins</p>}>
                <ul className="stagger flex flex-col gap-1.5">
                  {[...result.candidates]
                    .sort((a, b) => a.bytes - b.bytes)
                    .map((candidate, index) => {
                      const selected = candidate.format === result.format
                      return (
                        <li
                          key={`${candidate.format}-${candidate.version}`}
                          style={{ "--i": index } as React.CSSProperties}
                          className="flex items-center gap-3 rounded-md border border-rule bg-panel px-3 py-2.5"
                        >
                          <span
                            aria-hidden
                            className="size-1.5 shrink-0 rounded-full"
                            style={{ background: selected ? "var(--signal)" : "var(--faint)" }}
                          />
                          <span className="data w-48 shrink-0 truncate text-[12px]">
                            {candidate.format}
                          </span>
                          <span className="hidden min-w-0 flex-1 sm:block">
                            <span
                              className="block h-1.5 rounded-full"
                              style={{
                                width: `${(candidate.bytes / heaviestCandidate) * 100}%`,
                                background: selected ? "var(--signal)" : "var(--rule)",
                              }}
                            />
                          </span>
                          <span className="num w-14 shrink-0 text-right text-[13px]">
                            {candidate.bytes} B
                          </span>
                          <span
                            className="eyebrow w-16 shrink-0 text-right"
                            style={{ color: selected ? "var(--signal-text)" : undefined }}
                          >
                            {selected ? "selected" : "verified"}
                          </span>
                        </li>
                      )
                    })}
                </ul>

                <details className="group rounded-md border border-rule bg-panel">
                  <summary className="eyebrow cursor-pointer list-none px-3 py-2.5 transition-colors hover:text-bone">
                    <span className="group-open:hidden">▸ </span>
                    <span className="hidden group-open:inline">▾ </span>
                    What it decodes back to
                  </summary>
                  <div className="flex flex-col gap-3 border-t border-rule px-3 py-3">
                    <div className="flex flex-col gap-1">
                      <p className="eyebrow">Canonical target</p>
                      <p className="data text-[12px] break-all text-dim">{result.canonical}</p>
                    </div>
                    {inspect && (
                      <div className="flex flex-col gap-1">
                        <p className="eyebrow">Decode check</p>
                        <p className="data text-[12px] text-dim">
                          alphabet {inspect.alphabet} &middot; format {inspect.format} &middot; dictionary v
                          {inspect.dictionaryVersion} &middot;{" "}
                          <span style={{ color: "var(--signal-text)" }}>reconstructs the target</span>
                        </p>
                      </div>
                    )}
                  </div>
                </details>
              </Section>
            </>
          )}
        </div>

        {historyLoaded && history.length > 0 && (
          <Section
            label="Recent"
            aside={
              <button
                type="button"
                onClick={() => persistHistory([])}
                className="eyebrow transition-colors hover:text-signal-text"
              >
                Clear
              </button>
            }
          >
            <p className="-mt-2 text-[12px] text-faint">
              Kept in this browser only. The server stores nothing.
            </p>
            <ul className="flex flex-col gap-1.5">
              {history.map((entry) => (
                <li
                  key={entry.shortUrl}
                  className="flex items-center gap-3 rounded-md border border-rule bg-panel px-3 py-2"
                >
                  <span className="eyebrow w-14 shrink-0">{entry.mode}</span>
                  <a href={entry.shortUrl} className="data min-w-0 flex-1 truncate text-[12px] hover:text-signal-text">
                    {entry.shortUrl}
                  </a>
                  <span className="hidden max-w-48 truncate text-[12px] text-faint md:inline">
                    {entry.url}
                  </span>
                  <button
                    type="button"
                    onClick={() => copy(entry.shortUrl)}
                    className="eyebrow shrink-0 text-dim transition-colors hover:text-bone"
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    onClick={() => persistHistory(history.filter((h) => h.shortUrl !== entry.shortUrl))}
                    className="shrink-0 text-faint transition-colors hover:text-flare-text"
                    aria-label={`Remove ${entry.shortUrl}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </main>

      <footer className="border-t border-rule py-6 text-[12px] text-faint">
        Payloads are self-contained: version, flags, dictionary references, typed tokens. Dictionary
        versions are immutable, so a link compiled today still decodes years from now.
      </footer>
    </div>
  )
}
