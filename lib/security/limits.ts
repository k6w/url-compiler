import { config } from "../config"
import { DecodeError } from "../codec/types"

export function assertPayloadLength(payload: string): void {
  if (payload.length > config.maxPayloadLength) {
    throw new DecodeError("OVERSIZED_PAYLOAD", `payload exceeds ${config.maxPayloadLength} characters`)
  }
}

export function targetLengthLimit(): number {
  return config.maxTargetLength
}

export const limits = {
  maxPayloadLength: () => config.maxPayloadLength,
  maxTargetLength: () => config.maxTargetLength,
  maxQueryPairs: () => config.maxQueryPairs,
  maxPathSegments: () => config.maxPathSegments,
  maxSegmentBytes: () => config.maxSegmentBytes,
  maxDecompressedBytes: () => config.maxDecompressedBytes,
} as const
