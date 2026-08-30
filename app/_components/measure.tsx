/**
 * The measure — this page's signature element.
 *
 * A shortener is a measuring instrument, so both lengths are drawn against one
 * shared ruler. Everything lives in a single three-column grid so the tick rail
 * sits exactly above the bar track: a ruler that does not line up with what it
 * measures is decoration, not instrumentation.
 */

const TICK_STEPS = [10, 20, 50, 100, 200, 500, 1000] as const
const GRID = "4.5rem minmax(0, 1fr) 3.25rem"

function tickStep(span: number): number {
  for (const step of TICK_STEPS) {
    if (span / step <= 16) return step
  }
  return TICK_STEPS[TICK_STEPS.length - 1]
}

function Row({
  label,
  length,
  span,
  tone,
}: {
  label: string
  length: number
  span: number
  tone: "before" | "win" | "loss"
}) {
  const pct = span === 0 ? 0 : Math.max((length / span) * 100, 1.5)
  const fill = tone === "before" ? "var(--rule)" : tone === "win" ? "var(--signal)" : "var(--flare)"
  return (
    <>
      <span className="eyebrow self-center text-right">{label}</span>
      <span className="self-center">
        <span className="bar block" style={{ width: `${pct}%`, background: fill }} />
      </span>
      <span
        className="num self-center text-right text-[15px]"
        style={{ color: tone === "before" ? "var(--dim)" : "var(--bone)" }}
      >
        {length}
      </span>
    </>
  )
}

/** Idle state: the instrument is visible before it has anything to measure. */
export function MeasureIdle() {
  return (
    <div className="grid items-center gap-x-3 gap-y-2.5" style={{ gridTemplateColumns: GRID }}>
      <span />
      <span className="tickrail" style={{ "--tick": "10%" } as React.CSSProperties} />
      <span />
      <span className="eyebrow text-right">target</span>
      <span className="h-2.5 rounded-sm bg-well" />
      <span className="num text-right text-[15px] text-faint">—</span>
      <span className="eyebrow text-right">compiled</span>
      <span className="h-2.5 rounded-sm bg-well" />
      <span className="num text-right text-[15px] text-faint">—</span>
    </div>
  )
}

export function Measure({
  originalLength,
  shortenedLength,
}: {
  originalLength: number
  shortenedLength: number
}) {
  const span = Math.max(originalLength, shortenedLength, 1)
  const step = tickStep(span)
  const saved = originalLength - shortenedLength
  const ratio = originalLength === 0 ? 1 : shortenedLength / originalLength
  const grew = saved <= 0

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-x-3 gap-y-2.5" style={{ gridTemplateColumns: GRID }}>
        <span />
        <span className="tickrail" style={{ "--tick": `${(step / span) * 100}%` } as React.CSSProperties} />
        <span />
        <Row label="target" length={originalLength} span={span} tone="before" />
        <Row label="compiled" length={shortenedLength} span={span} tone={grew ? "loss" : "win"} />
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="eyebrow">1 tick = {step} chars</p>
        <p className="text-[13px] text-dim">
          <span
            className="num text-[15px]"
            style={{ color: grew ? "var(--flare-text)" : "var(--signal-text)" }}
          >
            {grew ? `+${Math.abs(saved)}` : `−${saved}`}
          </span>{" "}
          characters {grew ? "longer" : "saved"} &middot;{" "}
          <span className="num">{(ratio * 100).toFixed(1)}%</span> of the original
        </p>
      </div>
    </div>
  )
}
