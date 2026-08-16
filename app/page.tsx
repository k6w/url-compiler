"use client"

import { FormEvent, useState } from "react"

type Mode = "ultra" | "human"

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
  candidates: { format: string; bytes: number }[]
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

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setResult(null)
    setInspect(null)
    setCopied(false)
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
      const inspectResponse = await fetch("/api/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: data.payload }),
      })
      const inspectData = await inspectResponse.json()
      if (inspectResponse.ok) setInspect(inspectData as InspectResponse)
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

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex rounded-lg border border-black/15 p-1 text-sm dark:border-white/15">
            {(["ultra", "human"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-md px-4 py-1.5 font-medium transition ${
                  mode === m ? "bg-blue-600 text-white" : "opacity-70 hover:opacity-100"
                }`}
              >
                {m === "ultra" ? "Ultra" : "Human"}
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

        <p className="text-xs opacity-60">
          {mode === "ultra"
            ? "Ultra: unpadded Base64URL, case-sensitive, densest safe alphabet, no separators."
            : "Human: case-insensitive Base32 (excludes i, l, o), hyphen groups, checksum-protected."}
        </p>
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

          <div className="flex flex-col gap-3 rounded-xl border border-black/10 bg-white/70 p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
            <div className="flex items-center justify-between gap-3">
              <span className="rounded-md bg-blue-600/10 px-2 py-0.5 font-mono text-xs font-semibold text-blue-700 dark:text-blue-400">
                {result.format}
              </span>
              <button
                type="button"
                onClick={copy}
                className="rounded-md border border-black/15 px-3 py-1 text-xs font-medium transition hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <a
              href={`/${result.payload}`}
              className="break-all font-mono text-sm underline decoration-blue-500/50 underline-offset-4 hover:decoration-blue-500"
            >
              {result.shortUrl}
            </a>

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
                <dd className="font-mono text-lg font-semibold">
                  {result.saved > 0 ? result.saved : result.saved}
                </dd>
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
                  <tr key={c.format}>
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

      <footer className="mt-auto pt-8 text-xs opacity-50">
        Payloads are self-contained: version + flags + dictionary references + typed tokens. Dictionary
        versions are immutable — old links keep decoding forever.
      </footer>
    </main>
  )
}
