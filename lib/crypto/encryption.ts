import { config } from "../config"

export class PrivateModeError extends Error {
  constructor(message = "private mode is not implemented in this release") {
    super(message)
    this.name = "PrivateModeError"
  }
}

export function assertPrivateModeDisabled(): void {
  if (config.enablePrivateMode) {
    throw new PrivateModeError()
  }
}

export async function encryptPayload(_plaintext: Uint8Array): Promise<Uint8Array> {
  throw new PrivateModeError()
}

export async function decryptPayload(_ciphertext: Uint8Array): Promise<Uint8Array> {
  throw new PrivateModeError()
}
