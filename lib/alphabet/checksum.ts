import { BASE32_ALPHABET, base32ValueOf, base32Char } from "./alphabet32"

function luhnCheckChar(data: string): string {
  let factor = 2
  let sum = 0
  for (let i = data.length - 1; i >= 0; i--) {
    const v = base32ValueOf(data[i])
    if (v === undefined) throw new Error(`invalid base32 character: ${data[i]}`)
    const add = v * factor
    sum += Math.floor(add / 32) + (add % 32)
    factor = factor === 2 ? 1 : 2
  }
  return base32Char((32 - (sum % 32)) % 32)
}

export function checkCountFor(dataLength: number): 1 | 2 {
  return dataLength <= 16 ? 1 : 2
}

export function checksumChars(data: string): string {
  const first = luhnCheckChar(data)
  if (data.length <= 16) return first
  return first + luhnCheckChar(data + first)
}

export function verifyChecksum(data: string, provided: string): boolean {
  return checksumChars(data) === provided
}

export const CHECKSUM_ALPHABET = BASE32_ALPHABET
