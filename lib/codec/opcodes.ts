export const Opcode = {
  END: 0x00,
  LITERAL_BYTES: 0x01,
  HOST_FULL: 0x02,
  HOST_LABEL: 0x03,
  SUFFIX: 0x04,
  PATH_TOKEN: 0x05,
  QUERY_KEY: 0x06,
  COMMON_VALUE: 0x07,
  INTEGER: 0x08,
  UUID: 0x09,
  HEX_BYTES: 0x0a,
  BOOLEAN_TRUE: 0x0b,
  BOOLEAN_FALSE: 0x0c,
  EMPTY_VALUE: 0x0d,
  REPEAT: 0x0e,
  PORT: 0x0f,
  FRAGMENT: 0x10,
  USERNAME: 0x11,
  PASSWORD: 0x12,
  BACKREF: 0x13,
} as const

export const INLINE_DICTIONARY_BASE = 0x20
export const INLINE_DICTIONARY_MAX = 0x3f
export const INLINE_INTEGER_BASE = 0x40
export const INLINE_INTEGER_MAX = 0x5f

export function isInlineDictionaryByte(b: number): boolean {
  return b >= INLINE_DICTIONARY_BASE && b <= INLINE_DICTIONARY_MAX
}

export function isInlineIntegerByte(b: number): boolean {
  return b >= INLINE_INTEGER_BASE && b <= INLINE_INTEGER_MAX
}

export function varintLen(n: number): number {
  if (n < 0) throw new RangeError("varintLen requires n >= 0")
  if (n < 0x80) return 1
  if (n < 0x4000) return 2
  if (n < 0x200000) return 3
  if (n < 0x10000000) return 4
  return 5
}

export function dictionaryRefCost(id: number): number {
  return id < 32 ? 1 : 1 + varintLen(id)
}
