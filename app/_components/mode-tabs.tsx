"use client"

import { useRef } from "react"

export interface ModeOption<T extends string> {
  id: T
  label: string
  hint: string
}

/**
 * Mutually exclusive encoding modes. Modelled as a radiogroup rather than a
 * tablist: picking one changes what the form produces, it does not swap a
 * visible panel. Roving tabindex, arrow keys wrap, disabled modes are skipped.
 */
export function ModeTabs<T extends string>({
  options,
  value,
  onChange,
  disabled,
  label,
}: {
  options: ModeOption<T>[]
  value: T
  onChange: (next: T) => void
  disabled?: ReadonlySet<T>
  label: string
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const isBlocked = (id: T) => disabled?.has(id) ?? false

  function move(from: number, direction: 1 | -1) {
    const count = options.length
    for (let hop = 1; hop <= count; hop++) {
      const index = (from + direction * hop + count * count) % count
      if (isBlocked(options[index].id)) continue
      onChange(options[index].id)
      refs.current[index]?.focus()
      return
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex flex-wrap gap-1 rounded-md border border-rule bg-well p-1"
    >
      {options.map((option, index) => {
        const active = option.id === value
        const blocked = isBlocked(option.id)
        return (
          <button
            key={option.id}
            ref={(node) => {
              refs.current[index] = node
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-disabled={blocked || undefined}
            tabIndex={active ? 0 : -1}
            title={blocked ? `${option.label} is unavailable on this deployment` : option.hint}
            onClick={() => {
              if (!blocked) onChange(option.id)
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault()
                move(index, 1)
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault()
                move(index, -1)
              }
            }}
            className={[
              "rounded px-3 py-1.5 font-display text-[11px] font-semibold tracking-[0.12em] uppercase transition-colors",
              active
                ? "bg-signal text-signal-ink"
                : blocked
                  ? "cursor-not-allowed text-faint line-through decoration-1"
                  : "text-dim hover:bg-panel hover:text-bone",
            ].join(" ")}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
