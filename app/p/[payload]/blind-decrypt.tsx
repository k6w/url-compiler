"use client"

import { useCallback, useEffect, useRef, useState } from "react"

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const normalized = s.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

type State =
  | { status: "waiting" }
  | { status: "decoding" }
  | { status: "error"; message: string }
  | { status: "ready"; target: string; countdown: number }

export default function BlindDecrypt({ payload }: { payload: string }) {
  const [state, setState] = useState<State>({ status: "waiting" })
  const [held, setHeld] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  const hold = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    setHeld(true)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function run() {
      setState({ status: "decoding" })
      try {
        const hash = window.location.hash.replace(/^#/, "")
        if (hash.length === 0) {
          setState({
            status: "error",
            message: "This link is missing its key — the part after #. Ask the sender for the whole link.",
          })
          return
        }
        const keyBytes = b64urlDecode(hash)
        const envelope = b64urlDecode(decodeURIComponent(payload))
        if (keyBytes.length !== 32 || envelope.length <= 28) {
          setState({ status: "error", message: "This link is malformed and cannot be decrypted." })
          return
        }
        const nonce = envelope.subarray(0, 12)
        const ct = envelope.subarray(12)
        const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"])
        const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, cryptoKey, ct)
        const target = new TextDecoder().decode(plaintext)
        const parsed = new URL(target)
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          setState({ status: "error", message: "The decrypted destination is not an http or https address." })
          return
        }
        if (cancelled) return
        let countdown = 3
        setState({ status: "ready", target, countdown })
        intervalRef.current = setInterval(() => {
          countdown -= 1
          if (cancelled) return
          if (countdown <= 0) {
            if (intervalRef.current) clearInterval(intervalRef.current)
            window.location.replace(target)
          } else {
            setState({ status: "ready", target, countdown })
          }
        }, 1000)
      } catch {
        if (!cancelled) {
          setState({ status: "error", message: "Decryption failed. The key or the ciphertext is wrong." })
        }
      }
    }
    void run()
    return () => {
      cancelled = true
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [payload])

  return (
    <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-xl flex-col px-5 sm:px-8">
      <header className="flex items-center gap-4 border-b border-rule py-5">
        <span className="wordmark">URL&middot;COMPILER</span>
        <span aria-hidden className="hidden h-3 w-px bg-rule sm:block" />
        <p className="eyebrow">server-blind link</p>
      </header>

      <main className="flex flex-1 flex-col justify-center gap-6 py-12" aria-live="polite">
        <div className="flex flex-col gap-3">
          <h1 className="font-display text-[22px] leading-tight font-semibold">
            Decrypted in your browser.
          </h1>
          <p className="text-[14px] text-dim">
            The key travelled in this page&rsquo;s <code className="data">#</code> fragment, which browsers
            never send to a server. This server did not see it and cannot tell where you are going.
          </p>
        </div>

        {(state.status === "waiting" || state.status === "decoding") && (
          <p className="eyebrow">Decrypting…</p>
        )}

        {state.status === "error" && (
          <p
            className="rounded-md border px-3 py-2.5 text-[13px]"
            style={{ borderColor: "var(--flare)", background: "var(--flare-wash)", color: "var(--flare-text)" }}
          >
            {state.message}
          </p>
        )}

        {state.status === "ready" && (
          <div className="flex flex-col gap-4 rounded-md border border-rule bg-panel p-5 shadow-[var(--shadow)]">
            <div className="flex flex-col gap-1.5">
              <p className="eyebrow">Destination</p>
              <p className="data text-[13px] leading-relaxed break-all">{state.target}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={state.target}
                className="rounded-md bg-signal px-5 py-2.5 font-display text-[11px] font-bold tracking-[0.14em] text-signal-ink uppercase transition-opacity hover:opacity-90"
              >
                {held ? "Continue" : `Continue (${state.countdown})`}
              </a>
              {!held && (
                <button
                  type="button"
                  onClick={hold}
                  className="eyebrow rounded border border-rule px-3 py-2 text-dim transition-colors hover:border-signal hover:text-bone"
                >
                  Stay here
                </button>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
