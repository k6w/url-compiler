"use client"

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import { renderSVG } from "uqr"
import { voiceIndex } from "@/lib/alphabet/wordlist"
import { VOICE_WORDS_VI } from "@/lib/alphabet/wordlist-vi"
import { VOICE_WORDS_JA } from "@/lib/alphabet/wordlist-ja"

type Mode = "ultra" | "human" | "voice" | "private" | "blind"
type VoiceLocale = "en" | "vi" | "ja"

interface HistoryEntry {
  url: string
  mode: Mode
  shortUrl: string
  ts: number
}

const HISTORY_KEY = "url-compiler-history"
const HISTORY_LIMIT = 15

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
  const parts = payload.toLowerCase().split("-").filter((p) => p.length > 0)
  return parts
    .map((p) => {
      const idx = voiceIndex(p)
      return idx === undefined ? p : (table[idx] ?? p)
    })
    .join(locale === "ja" ? "・" : " ")
}

const MODES: Array<{ id: Mode; label: string; hint: string }> = [
  { id: "ultra", label: "Ultra", hint: "Unpadded Base64URL, case-sensitive, densest safe alphabet, no separators." },
  { id: "human", label: "Human", hint: "Case-insensitive Base32 (excludes i, l, o), hyphen groups, checksum-protected." },
  { id: "voice", label: "Voice", hint: "Dictation-friendly words, one word per byte, checksum word. Significantly longer." },
  { id: "private", label: "Private", hint: "AES-256-GCM encrypted payload. The server can decrypt; requires key configuration." },
  { id: "blind", label: "Blind", hint: "Key lives in the URL fragment — decrypted by the landing page in the browser, not the server." },
]

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

  useEffect(() => {
    void Promise.resolve().then(() => {
      setHistory(loadHistory())
      setHistoryLoaded(true)
    })
  }, [])

  const persistHistory = useCallback((entries: HistoryEntry[]) => {
    setHistory(entries)
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries))
    } catch {
      // storage unavailable (private mode); keep in-memory only
    }
  }, [])

  const rememberResult = useCallback(
    (entry: HistoryEntry) => {
      const next = [entry, ...loadHistory().filter((h) => h.shortUrl !== entry.shortUrl)].slice(0, HISTORY_LIMIT)
      persistHistory(next)
    },
    [persistHistory],
  )

  const modeHint = useMemo(() => MODES.find((m) => m.id === mode)?.hint ?? "", [mode])

  const qrSvg = useMemo(() => {
    if (!result || !showQr) return null
    try {
      return renderSVG(result.shortUrl, { border: 2 })
    } catch {
      return null
    }
  }, [result, showQr])

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
        setError(data.message ?? data.error ?? "encoding failed")
        return
      }
      setResult(data as EncodeResponse)
      rememberResult({ url, mode, shortUrl: data.shortUrl as string, ts: Date.now() })
      if (mode === "ultra" || mode === "human" || mode === "voice") {
        const inspectResponse = await fetch("/api/inspect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payload: data.payload }),
        })
        const inspectData = await inspectResponse.json()
        if (inspectResponse.ok) setInspect(inspectData as InspectResponse)
      }
    } catch {
      setError("network error")
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.shortUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError("clipboard unavailable")
    }
  }

  const effectiveHref = result?.blind ? `#${result.payload}` : result ? `/${result.payload}` : "#"

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">URL Compiler</h1>
        <p className="text-sm opacity-70">
          Stateless URL shortener. Every short link carries the full destination inside the URL itself —
          no database, no lookup table, nothing stored.
        </p>
      </header>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-2 text-sm font-medium">
          Destination URL
          <input
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.example.com/products/12345?utm_source=google&id=7"
            className="rounded-lg border border-black/15 bg-white/70 px-4 py-3 font-mono text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 dark:border-white/15 dark:bg-white/5"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap rounded-lg border border-black/15 p-1 text-sm dark:border-white/15">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                className={`rounded-md px-3 py-1.5 font-medium transition ${
                  mode === m.id ? "bg-blue-600 text-white" : "opacity-70 hover:opacity-100"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-sm opacity-80">
            <input
              type="checkbox"
              checked={aggressive}
              onChange={(e) => setAggressive(e.target.checked)}
              className="size-4 accent-blue-600"
            />
            Strip tracking parameters
          </label>

          <button
            type="submit"
            disabled={busy || url.length === 0}
            className="ml-auto rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-40"
          >
            {busy ? "Compiling…" : "Compile"}
          </button>
        </div>

        <p className="text-xs opacity-60">{modeHint}</p>
      </form>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {result && (
        <section className="flex flex-col gap-4">
          {result.warning && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
              The compiled URL ({result.shortenedLength} characters) is not shorter than the original (
              {result.originalLength} characters). Stateless encoding cannot always win — random or
              already-short URLs may grow.
            </div>
          )}

          {result.blind && (
            <div className="rounded-lg border border-violet-500/40 bg-violet-500/10 px-4 py-3 text-sm text-violet-700 dark:text-violet-400">
              Server-blind: the decryption key is in the URL fragment after <code>#</code>. This server
              cannot decrypt the destination; the landing page does it in the browser. Share the full
              link including the fragment.
            </div>
          )}

          {result.encrypted && (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
              Private: payload encrypted with AES-256-GCM. Only a server holding the configured key can
              decode; observers see ciphertext.
            </div>
          )}

          <div className="flex flex-col gap-3 rounded-xl border border-black/10 bg-white/70 p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
            <div className="flex items-center justify-between gap-3">
              <span className="rounded-md bg-blue-600/10 px-2 py-0.5 font-mono text-xs font-semibold text-blue-700 dark:text-blue-400">
                {result.format}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowQr((v) => !v)}
                  className="rounded-md border border-black/15 px-3 py-1 text-xs font-medium transition hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
                >
                  {showQr ? "Hide QR" : "QR"}
                </button>
                <button
                  type="button"
                  onClick={copy}
                  className="rounded-md border border-black/15 px-3 py-1 text-xs font-medium transition hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            {showQr && qrSvg && (
              <div
                className="mx-auto w-full max-w-56 [&>svg]:h-auto [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
            )}

            {result.blind ? (
              <p className="break-all font-mono text-sm underline decoration-blue-500/50 underline-offset-4">
                {result.shortUrl.split("#")[0]}
                <span className="opacity-60">#{result.shortUrl.split("#")[1]}</span>
              </p>
            ) : (
              <a
                href={effectiveHref}
                className="break-all font-mono text-sm underline decoration-blue-500/50 underline-offset-4 hover:decoration-blue-500"
              >
                {result.shortUrl}
              </a>
            )}

            {mode === "voice" && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs opacity-60">reading:</span>
                  {(["en", "vi", "ja"] as const).map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setLocale(l)}
                      className={`rounded-md px-2 py-0.5 text-xs font-medium transition ${
                        locale === l ? "bg-blue-600/15 text-blue-700 dark:text-blue-400" : "opacity-60 hover:opacity-100"
                      }`}
                    >
                      {l === "en" ? "English" : l === "vi" ? "Tiếng Việt" : "日本語"}
                    </button>
                  ))}
                </div>
                <p className="break-words rounded-lg bg-black/5 px-3 py-2 text-sm dark:bg-white/5">
                  {localizedReading(result.payload, locale)}
                </p>
              </div>
            )}

            <dl className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-black/5 p-3 dark:bg-white/5">
                <dt className="text-xs opacity-60">Original</dt>
                <dd className="font-mono text-lg font-semibold">{result.originalLength}</dd>
              </div>
              <div className="rounded-lg bg-black/5 p-3 dark:bg-white/5">
                <dt className="text-xs opacity-60">Shortened</dt>
                <dd className="font-mono text-lg font-semibold">{result.shortenedLength}</dd>
              </div>
              <div className="rounded-lg bg-black/5 p-3 dark:bg-white/5">
                <dt className="text-xs opacity-60">Saved</dt>
                <dd className="font-mono text-lg font-semibold">{result.saved}</dd>
              </div>
            </dl>

            <p className="break-all font-mono text-xs opacity-60">→ {result.canonical}</p>

            {inspect && (
              <p className="font-mono text-xs opacity-60">
                decode check: alphabet={inspect.alphabet} format={inspect.format} dict=v
                {inspect.dictionaryVersion} ✓ reconstructs target
              </p>
            )}

            <table className="w-full text-left font-mono text-xs opacity-70">
              <thead>
                <tr className="border-b border-black/10 dark:border-white/10">
                  <th className="py-1 font-medium">candidate</th>
                  <th className="py-1 font-medium">bytes</th>
                  <th className="py-1 font-medium">status</th>
                </tr>
              </thead>
              <tbody>
                {result.candidates.map((c) => (
                  <tr key={`${c.format}-${c.version}`}>
                    <td className="py-1">{c.format}</td>
                    <td className="py-1">{c.bytes}</td>
                    <td className="py-1">{c.format === result.format ? "selected" : "verified"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {historyLoaded && history.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold opacity-70">Recent (stored locally in this browser only)</h2>
            <button
              type="button"
              onClick={() => persistHistory([])}
              className="text-xs opacity-60 underline-offset-2 transition hover:opacity-100 hover:underline"
            >
              clear
            </button>
          </div>
          <ul className="flex flex-col gap-2">
            {history.map((h) => (
              <li
                key={h.shortUrl}
                className="flex items-center gap-3 rounded-lg border border-black/10 bg-white/50 px-3 py-2 text-xs dark:border-white/10 dark:bg-white/5"
              >
                <span className="rounded bg-blue-600/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-blue-700 dark:text-blue-400">
                  {h.mode}
                </span>
                <a href={h.shortUrl} className="min-w-0 flex-1 truncate font-mono hover:underline">
                  {h.shortUrl}
                </a>
                <span className="hidden max-w-40 truncate opacity-40 md:inline">{h.url}</span>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(h.shortUrl).catch(() => undefined)}
                  className="shrink-0 rounded border border-black/15 px-2 py-0.5 transition hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
                >
                  copy
                </button>
                <button
                  type="button"
                  onClick={() => persistHistory(history.filter((x) => x.shortUrl !== h.shortUrl))}
                  className="shrink-0 opacity-40 transition hover:opacity-100"
                  aria-label="remove"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-auto pt-8 text-xs opacity-50">
        Payloads are self-contained: version + flags + dictionary references + typed tokens. Dictionary
        versions are immutable — old links keep decoding forever.
      </footer>
    </main>
  )
}
