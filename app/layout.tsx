import type { Metadata, Viewport } from "next"
import { Martian_Mono, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google"
import "./globals.css"

/* Machined display face — used only for the wordmark, section labels and the
   measure numerals. Everything it touches is short and shouty by design. */
const martian = Martian_Mono({
  variable: "--font-martian",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
})

/* Data face: payloads, targets, byte counts. Humanist mono, easy on long
   base64 runs where a machined face would be unreadable. */
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
})

/* Prose face, same family as the data face so the page reads as one voice. */
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
})

export const metadata: Metadata = {
  title: "URL Compiler — stateless URL shortener",
  description:
    "Compiles URLs into self-contained compressed payloads. No database, no stored destinations, every link decodes independently.",
  openGraph: {
    title: "URL Compiler",
    description:
      "A stateless URL shortener. Every short link carries its whole destination inside itself.",
    type: "website",
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f0e9" },
    { media: "(prefers-color-scheme: dark)", color: "#14161d" },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${martian.variable} ${plexMono.variable} ${plexSans.variable} h-full antialiased`}
    >
      <body className="relative min-h-full">{children}</body>
    </html>
  )
}
