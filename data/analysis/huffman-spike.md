# Huffman spike report

Measured on the full corpus with dictionary v1 (specialized bytecode only,
emitted literals only — exploration costs excluded).

| metric | value |
|---|---|
| total specialized bytes | 2081 |
| literal (LITERAL_BYTES) content bytes | 1199 (57.6% of stream) |
| distinct literal byte values | 110 |
| Shannon-optimal static Huffman length | 886 bytes vs 1199 raw (26.1% smaller literals) |
| estimated total payload saving | 15.0% |

## Interpretation

Static canonical Huffman over literal bytes would shrink the literal portion by
26.1%, but literals are only 57.6% of the
bytecode stream — the rest is opcodes, varints, and typed values (already compact).
Net effect on final payload length: ~15.0%.

Threshold from the plan: implement only if the ceiling is >8% on literal-heavy
categories. Measured ceiling across the whole corpus: 15.0%.

**Decision: PROCEED — ceiling exceeds 8%**

Note: base64url expands bytes by 4/3, so the URL-level effect is the same
percentage as the byte-level effect. UTF-8 literal content (unicode category)
is multi-byte and partially incompressible by byte-level Huffman; a
script-aware model would be needed for more.
