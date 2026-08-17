"use client"

import { useEffect, useState } from "react"

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

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let interval: ReturnType<typeof setInterval> | undefined

    async function run() {
      setState({ status: "decoding" })
      try {
        const hash = window.location.hash.replace(/^#/, "")
        if (hash.length === 0) {
          setState({ status: "error", message: "This link is missing its decryption key (the part after #)." })
          return
        }
        const keyBytes = b64urlDecode(hash)
        const envelope = b64urlDecode(decodeURIComponent(payload))
        if (keyBytes.length !== 32 || envelope.length <= 28) {
          setState({ status: "error", message: "Malformed encrypted link." })
          return
        }
        const nonce = envelope.subarray(0, 12)
        const ct = envelope.subarray(12)
        const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"])
        const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, cryptoKey, ct)
        const target = new TextDecoder().decode(plaintext)
        const parsed = new URL(target)
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          setState({ status: "error", message: "Decrypted destination is not an http(s) URL." })
          return
        }
        if (cancelled) return
        let countdown = 3
        setState({ status: "ready", target, countdown })
        interval = setInterval(() => {
          countdown -= 1
          if (cancelled) return
          if (countdown <= 0) {
            if (interval) clearInterval(interval)
            window.location.replace(target)
          } else {
            setState({ status: "ready", target, countdown })
          }
        }, 1000)
      } catch {
        if (!cancelled) setState({ status: "error", message: "Decryption failed — the key or ciphertext is wrong." })
      }
    }
    void run()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      if (interval) clearInterval(interval)
    }
  }, [payload])

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Encrypted link</h1>
      <p className="text-sm opacity-70">
        The destination was encrypted in your browser&apos;s URL fragment. This server never saw the
        key and cannot read where you are going.
      </p>

      {state.status === "waiting" || state.status === "decoding" ? (
        <p className="font-mono text-sm opacity-60">decrypting…</p>
      ) : null}

      {state.status === "error" ? (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {state.message}
        </div>
      ) : null}

      {state.status === "ready" ? (
        <div className="flex w-full flex-col gap-4 rounded-xl border border-black/10 bg-white/70 p-6 shadow-sm dark:border-white/10 dark:bg-white/5">
          <p className="text-xs opacity-60">destination (decrypted locally):</p>
          <p className="break-all font-mono text-sm">{state.target}</p>
          <a
            href={state.target}
            className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500"
          >
            Continue{state.countdown > 0 ? ` (${state.countdown})` : ""}
          </a>
        </div>
      ) : null}
    </main>
  )
}
