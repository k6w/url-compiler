"use client"

import { useMemo } from "react"
import { renderSVG } from "uqr"

/**
 * QR codes are always drawn dark-on-white on their own white card, in both
 * themes. A theme-tinted QR with a transparent quiet zone is a QR that will
 * not scan, so this is one place the palette does not apply.
 */
export function QrPanel({ value, filename }: { value: string; filename: string }) {
  const svg = useMemo(() => {
    try {
      return renderSVG(value, { border: 2, whiteColor: "#ffffff", blackColor: "#14161d" })
    } catch {
      return null
    }
  }, [value])

  if (!svg) {
    return <p className="text-[13px] text-flare-text">This link is too long to fit in a QR code.</p>
  }

  function download(blob: Blob, name: string) {
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = href
    anchor.download = name
    anchor.click()
    URL.revokeObjectURL(href)
  }

  function saveSvg() {
    if (svg) download(new Blob([svg], { type: "image/svg+xml" }), `${filename}.svg`)
  }

  function savePng() {
    if (!svg) return
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement("canvas")
      canvas.width = 512
      canvas.height = 512
      const context = canvas.getContext("2d")
      if (!context) return
      context.imageSmoothingEnabled = false
      context.drawImage(image, 0, 0, 512, 512)
      canvas.toBlob((blob) => {
        if (blob) download(blob, `${filename}.png`)
      }, "image/png")
    }
    image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-rule bg-well p-4">
      <div
        className="w-full max-w-52 rounded bg-white p-2 [&>svg]:h-auto [&>svg]:w-full"
        role="img"
        aria-label={`QR code for ${value}`}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div className="flex gap-2">
        <button type="button" onClick={saveSvg} className="eyebrow rounded border border-rule px-2.5 py-1 text-dim transition-colors hover:border-signal hover:text-bone">
          Save SVG
        </button>
        <button type="button" onClick={savePng} className="eyebrow rounded border border-rule px-2.5 py-1 text-dim transition-colors hover:border-signal hover:text-bone">
          Save PNG
        </button>
      </div>
    </div>
  )
}
