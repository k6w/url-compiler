#!/usr/bin/env bun
/**
 * Showcase screenshots.
 *
 * Boots a production server with a fixed origin, a fixed demo key and private
 * mode on, then drives the real UI with Playwright and captures the results at
 * 2x into docs/media/. Nothing is mocked: every image is the app running.
 *
 * Chromium comes from the local Playwright cache — this repo does not vendor a
 * browser. If none is cached, install one with `bunx playwright install chromium`.
 *
 *   bun tools/screenshot.ts
 */

import { existsSync, mkdirSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { chromium, type Browser, type Page } from "playwright-core"

const PORT = 4321
const BASE = `http://127.0.0.1:${PORT}`
const OUT = join(import.meta.dir, "..", "docs", "media")

/** Fixed so screenshots are reproducible. Demo only — never deploy this key. */
const DEMO_KEY = "c2NyZWVuc2hvdC1kZW1vLWtleS0zMi1ieXRlcy0wMDE"

const SAMPLE = {
  tracking: "https://www.example.com/products/12345?utm_source=google&id=7",
  github: "https://github.com/anthropics/claude-code/issues/1234",
  api: "https://api.stripe.com/v1/charges?limit=10&starting_after=ch_3Ns8Kd2eZvKYlo2C0abcdefg",
  tiny: "https://ab.co/x",
} as const

function chromiumExecutable(): string {
  const cache = join(homedir(), "Library", "Caches", "ms-playwright")
  const linux = join(homedir(), ".cache", "ms-playwright")
  const root = existsSync(cache) ? cache : linux
  if (!existsSync(root)) throw new Error(`no Playwright cache at ${root} — run: bunx playwright install chromium`)
  const builds = readdirSync(root)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
  for (const build of builds) {
    for (const candidate of [
      join(root, build, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
      join(root, build, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
      join(root, build, "chrome-linux", "chrome"),
    ]) {
      if (existsSync(candidate)) return candidate
    }
  }
  throw new Error("no usable Chromium build in the Playwright cache — run: bunx playwright install chromium")
}

async function waitForServer(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/api/capabilities`)
      if (response.ok) return
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error("server did not become ready in time")
}

interface Scene {
  name: string
  width: number
  height: number
  themes: Array<"dark" | "light">
  /** Returns a locator to clip to, or nothing to capture the viewport. */
  run: (page: Page) => Promise<string | undefined>
}

/** Types into the target field and compiles, then waits for the measure panel. */
async function compile(page: Page, url: string, mode: string): Promise<void> {
  await page.goto(BASE, { waitUntil: "networkidle" })
  await page.getByRole("radio", { name: mode, exact: true }).click()
  await page.getByLabel("Destination URL").fill(url)
  await page.getByRole("button", { name: /compile/i }).click()
  await page.getByRole("heading", { name: "Measure", exact: true }).waitFor()
  await page.waitForTimeout(700)
}

/** Union bounding box of two sections, used to frame result screenshots. */
async function span(page: Page, first: string, last: string) {
  const top = page.locator("section", { has: page.getByRole("heading", { name: first, exact: true }) })
  const bottom = page.locator("section", { has: page.getByRole("heading", { name: last, exact: true }) })
  const a = await top.boundingBox()
  const b = await bottom.boundingBox()
  if (!a || !b) return undefined
  const pad = 28
  return {
    x: Math.max(a.x - pad, 0),
    y: Math.max(a.y - pad, 0),
    width: a.width + pad * 2,
    height: b.y + b.height - a.y + pad * 2,
  }
}

const SCENES: Scene[] = [
  {
    name: "landing",
    width: 1120,
    height: 940,
    themes: ["dark", "light"],
    async run(page) {
      await page.goto(BASE, { waitUntil: "networkidle" })
      await page.waitForTimeout(400)
      return undefined
    },
  },
  {
    name: "compiled-ultra",
    width: 1120,
    height: 1180,
    themes: ["dark", "light"],
    async run(page) {
      await compile(page, SAMPLE.tracking, "Ultra")
      return "span:Measure:Candidates"
    },
  },
  {
    name: "compiled-human",
    width: 1120,
    height: 1180,
    themes: ["dark"],
    async run(page) {
      await compile(page, SAMPLE.github, "Human")
      return "span:Measure:Candidates"
    },
  },
  {
    name: "compiled-voice",
    width: 1120,
    height: 1280,
    themes: ["dark"],
    async run(page) {
      await compile(page, SAMPLE.github, "Voice")
      await page.getByRole("button", { name: "日本語" }).click()
      await page.waitForTimeout(250)
      return "span:Measure:Measure"
    },
  },
  {
    name: "qr",
    width: 1120,
    height: 1280,
    themes: ["dark"],
    async run(page) {
      await compile(page, SAMPLE.tracking, "Ultra")
      await page.getByRole("button", { name: "QR code" }).click()
      await page.waitForTimeout(350)
      return "span:Measure:Measure"
    },
  },
  {
    name: "not-shorter",
    width: 1120,
    height: 1180,
    themes: ["dark"],
    async run(page) {
      await compile(page, SAMPLE.tiny, "Ultra")
      return "span:Measure:Measure"
    },
  },
  {
    name: "blind",
    width: 1120,
    height: 1180,
    themes: ["dark"],
    async run(page) {
      await compile(page, SAMPLE.api, "Blind")
      return "span:Measure:Measure"
    },
  },
  {
    name: "blind-landing",
    width: 1120,
    height: 600,
    themes: ["dark"],
    async run(page) {
      await compile(page, SAMPLE.api, "Blind")
      const shown = await page.locator("p.data").first().innerText()
      const path = shown.slice(shown.indexOf("/p/"))
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" })
      await page.getByRole("button", { name: "Stay here" }).click()
      await page.waitForTimeout(300)
      return undefined
    },
  },
  {
    name: "mobile",
    width: 414,
    height: 900,
    themes: ["dark"],
    async run(page) {
      await compile(page, SAMPLE.tracking, "Ultra")
      await page.evaluate(() => {
        const heading = [...document.querySelectorAll("h2")].find((h) => h.textContent === "Measure")
        heading?.scrollIntoView({ block: "start" })
        window.scrollBy(0, -24)
      })
      await page.waitForTimeout(400)
      return undefined
    },
  },
]

async function capture(browser: Browser, scene: Scene, theme: "dark" | "light") {
  const context = await browser.newContext({
    viewport: { width: scene.width, height: scene.height },
    deviceScaleFactor: 2,
    colorScheme: theme,
    reducedMotion: "no-preference",
  })
  const page = await context.newPage()
  try {
    const target = await scene.run(page)
    const suffix = theme === "dark" ? "" : "-light"
    const file = join(OUT, `${scene.name}${suffix}.png`)
    let clip: { x: number; y: number; width: number; height: number } | undefined
    if (target?.startsWith("span:")) {
      const [, first, last] = target.split(":")
      clip = await span(page, first, last)
    }
    await page.screenshot({ path: file, animations: "disabled", clip, fullPage: clip !== undefined })
    console.log(`  ${scene.name}${suffix}.png`)
  } finally {
    await context.close()
  }
}

async function main(): Promise<number> {
  mkdirSync(OUT, { recursive: true })
  const executablePath = chromiumExecutable()
  console.log(`chromium: ${executablePath}`)

  const server = Bun.spawn(["bunx", "next", "start", "-p", String(PORT)], {
    cwd: join(import.meta.dir, ".."),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PUBLIC_ORIGIN: "https://x.example",
      ENABLE_PRIVATE_MODE: "true",
      PAYLOAD_KEY_CURRENT: DEMO_KEY,
      RATE_LIMIT_ENCODE: "10000",
    },
    stdout: "ignore",
    stderr: "inherit",
  })

  let browser: Browser | undefined
  try {
    await waitForServer()
    browser = await chromium.launch({ executablePath })
    console.log(`writing to ${OUT}`)
    for (const scene of SCENES) {
      for (const theme of scene.themes) {
        await capture(browser, scene, theme)
      }
    }
    return 0
  } finally {
    await browser?.close()
    server.kill()
  }
}

process.exit(await main())
