# URL Compiler

A **stateless URL shortener**. No database, no stored destinations, no lookup table. Every short URL
contains the complete information needed to reconstruct its destination.

```text
https://www.example.com/products/12345?utm_source=google&id=7   (61 chars)
→ http://localhost:3000/AAgnAAIiCPLAAQIjJiFH                    (42 chars)
```

```text
URL parser → semantic normalizer → typed token compiler → dictionary optimizer
→ candidate compressor → shortest safe alphabet → stateless redirect
```

## How it works

1. **Parse** the destination with the platform `URL` parser into a typed model (scheme, host, path
   segments, ordered query pairs, fragment). Malformed URLs are rejected immediately.
2. **Normalize** safely: lowercase host (platform), default-port removal (platform), implicit HTTPS,
   percent-decode of *unreserved* escapes only (`%41` → `A`, UTF-8 text). Reserved escapes
   (`%2F`, `%2B`, `%26`, `%3D`) are preserved verbatim. Query order, duplicate keys, `?flag` vs
   `?flag=`, bare `?`/`#` markers, and trailing slashes all round-trip exactly.
3. **Compile** the model into a compact binary instruction stream with typed opcodes: dictionary
   references (hosts, host labels, effective suffixes, path tokens, query keys, common values),
   inline small integers (0–31 in a single byte), inline dictionary ids 0–31, zigzag varint
   integers, UUIDs (16 bytes), hex byte runs, booleans, empty-value markers, `REPEAT` and
   `BACKREF` for path compression. Path segments are optimized with dynamic programming, not greedy
   matching — a 2-character literal can beat an opcode plus dictionary id, and the encoder knows it.
4. **Compete** multiple candidates — specialized bytecode, Brotli, DEFLATE — verify each one
   round-trips (`decode(encode(url)) === canonical`), and return whichever produces the **shortest
   complete URL** (`origin + "/" + payload`).
5. **Redirect** statelessly: payload → alphabet decode → envelope → bytecode decode → validate →
   302. Decode latency is reported via `Server-Timing`.

A stateless URL cannot always be shorter than the original. Short, random, or
already-compact URLs may grow — the UI and API report an explicit warning with exact
`Original / Shortened / Saved` counts instead of pretending otherwise.

## Binary format

```text
byte 0   format/version:
           00xxxxxx  specialized URL bytecode (version 0)
           01xxxxxx  Brotli-compressed canonical URL
           10xxxxxx  DEFLATE-compressed canonical URL
           11xxxxxx  reserved (encrypted variants)
byte 1   flags:
           bit 0 http (HTTPS implicit)    bit 4 fragment present
           bit 1 custom port              bit 5 dictionary-version varint present
           bit 2 credentials present      bit 6 checksum present (reserved)
           bit 3 query present            bit 7 encryption present (rejected in decode)
[dict version varint]  if bit 5
[instruction stream]
```

Instruction stream: host section (`HOST_FULL` / labels + `SUFFIX` / literal, terminated by `END`),
optional credentials, optional `PORT`, path segment count + DP-optimized segment instructions,
optional query pair count + typed key/value instructions, optional `FRAGMENT`.

Inline ranges: `0x20–0x3F` = context-dependent `DICTIONARY_0..31`, `0x40–0x5F` = `INTEGER_0..31`.
Varints are LEB128, ≤5 bytes, minimal (overlong encodings rejected). All reads are bounds-checked;
truncated streams, invalid opcodes, out-of-range dictionary ids, non-UTF-8 literals, and
decompression output over 64 KiB are rejected with typed `DecodeError`s.

## Modes

- **Ultra** — unpadded Base64URL, case-sensitive, no separators, no checksum. Densest safe
  alphabet for APIs, QR codes, and copy-paste.
- **Human** — case-insensitive Crockford-style Base32 (`0-9` + `abcdefghjkmnpqrstvwxyz`, excluding
  `i l o u`), hyphen groups of 4, Luhn-mod-32 checksum (1 check char ≤16 data chars, 2 above).
  Aliases accepted on decode: `o→0`, `i→1`, `l→1`; only canonical characters are generated. On
  checksum failure the redirect is refused; a correction is suggested only when exactly one
  single-edit candidate validates.
- **Voice** — reserved for later (pronounceable words encoding the same payload).

No Unicode or emoji in the canonical payload, ever. Unicode is permitted in destinations (and
encoded as compact UTF-8 bytes inside literals) but payload alphabets are pure ASCII to avoid
homograph, normalization, and percent-encoding abuse (UTS #39 concerns).

## Dictionaries

`data/dictionaries/v0.json` is **immutable forever**: `hosts`, `labels`, `suffixes` (multi-label
PSL-style: `co.uk`, `github.io`, …), `paths`, `queryKeys`, `values`. IDs never change meaning;
new dictionaries get new version numbers, are selected by an envelope flag + varint, and every old
version stays decodable. `bun tools/analyze-corpus.ts` proposes candidates;
`bun tools/build-dictionary.ts` drafts the *next* version and refuses to touch existing files.

## Security

- Redirect targets must parse as absolute `http:`/`https:` URLs — `javascript:`, `data:`, `file:`,
  `vbscript:`, `about:` and friends are rejected by allowlist. Control characters (CRLF injection)
  rejected. The server never fetches destinations.
- Payload limits: 2048 payload chars, 8192 target chars, 64 path segments, 64 query pairs,
  1024-byte components, 64 KiB decompression cap (zip-bomb guard).
- Headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options`,
  CSP on HTML routes, `X-Robots-Tag: noindex` on redirects.
- Per-IP fixed-window rate limiting in memory (per-instance; no database by design).
- Dictionary-version mismatch, unknown formats, and malformed bitstreams fail closed.

## Project layout

```text
app/                  page, encode API, inspect API, catch-all redirect route
lib/url/              typed model, parser, safe normalizer, limit validation
lib/codec/            opcodes, varint writer/reader, specialized bytecode, brotli,
                      deflate, huffman (stub), candidate selection + verification
lib/dictionaries/     immutable versioned dictionaries + registry
lib/alphabet/         base64url, base32 + grouping + aliases, Luhn-mod-32 checksum
lib/security/         redirect validation, limits, rate limiting
lib/crypto/           encryption stub (private mode disabled by default)
data/                 dictionary versions, corpus, benchmark results
tests/                codec (fixtures + property), normalization, security, corpus
tools/                benchmark, corpus analysis, dictionary builder
```

## Scripts

```bash
bun install
bun run dev          # development
bun run build        # production build
bun run start        # production server
bun run test         # bun test (206 tests)
bun run lint         # eslint (Next 16 removed `next lint`; direct eslint is the successor)
bun run typecheck    # tsc --noEmit
bun run benchmark    # size/latency benchmark across strategies and categories
bun run dict:analyze # frequency analysis → dictionary candidates
bun run dict:build   # draft the next immutable dictionary version
```

## Environment

```text
PUBLIC_ORIGIN=https://x.example      # origin used for generated URLs
ENABLE_PRIVATE_MODE=false            # must stay false; encryption is a stub
ACTIVE_DICTIONARY_VERSION=0
MAX_PAYLOAD_LENGTH=2048
MAX_TARGET_LENGTH=8192
```

## Benchmark highlights

`bun run benchmark` (origin `http://localhost:3000`; payload-level ratio vs raw Base64URL):

```text
category         raw-b64url  specialized  auto-selected
tracking             177          102            102   (0.576)
unicode              145           84             84   (0.579)
uuid                 146           97             97   (0.664)
api                  152          120            106   (0.697, brotli wins some)
long-paths           126          103             98   (0.778)
service-template      89           66             66   (0.742)
```

Full results in `data/benchmarks/benchmark.json`; regression baseline in
`data/benchmarks/baseline.json` (corpus tests fail on >5% category regression).

## Deployment

Two supported targets, same codebase, byte-identical decode behavior:

### Self-hosted (Node / Bun)

```bash
bun run build && bun run start   # next start, Node runtime
```

Set `PUBLIC_ORIGIN` to the public origin serving the app.

### Cloudflare Workers (workerd)

```bash
bun run preview:cloudflare   # build + local workerd preview (miniflare)
bun run deploy:cloudflare    # build + wrangler deploy
```

Uses `@opennextjs/cloudflare` with `nodejs_compat` (see `wrangler.jsonc`, `open-next.config.ts`).
Parity is verified: specialized, Brotli, and DEFLATE payloads all decode identically under
workerd — the compression adapter (`lib/codec/compress.ts`) prefers `node:zlib` and falls back to
Web `DecompressionStream` per format, capability-detected at runtime. `PUBLIC_ORIGIN` and limits
are set as Worker vars.

Also works with Cloudflare as a plain CDN/proxy in front of the self-hosted origin.

## Not yet implemented (deliberately)

Voice mode, Huffman/range coding of the specialized stream, Zstandard, shared-dictionary Brotli,
service templates, and encrypted/server-blind modes are stubs or absent — the foundation is
small, deterministic, versioned, and perfectly reversible first.

## Deployment constraints

- Patched Next.js **16.2.11** (July 2026 security release: 4 high + 5 medium fixes), exact-pinned
  with the lockfile committed.
- Pin runtime versions in deployment and confirm local/production decoders agree (the round-trip
  and golden tests are the contract).
