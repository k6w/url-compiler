export const BASE32_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"

const CHAR_VALUES = new Map<string, number>()
for (let i = 0; i < BASE32_ALPHABET.length; i++) {
  CHAR_VALUES.set(BASE32_ALPHABET[i], i)
  CHAR_VALUES.set(BASE32_ALPHABET[i].toUpperCase(), i)
}
CHAR_VALUES.set("o", 0)
CHAR_VALUES.set("i", 1)
CHAR_VALUES.set("l", 1)

export function base32ValueOf(c: string): number | undefined {
  return CHAR_VALUES.get(c)
}

export function base32Char(value: number): string {
  return BASE32_ALPHABET[value]
}
