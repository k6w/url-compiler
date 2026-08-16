import { config } from "../config"
import { UrlModel } from "./model"

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ValidationError"
  }
}

const utf8 = new TextEncoder()

export function validateModelLimits(model: UrlModel): void {
  if (model.pathSegments.length > config.maxPathSegments) {
    throw new ValidationError(`too many path segments: ${model.pathSegments.length}`)
  }
  if (model.query.length > config.maxQueryPairs) {
    throw new ValidationError(`too many query pairs: ${model.query.length}`)
  }
  for (const seg of model.pathSegments) {
    const size = utf8.encode(seg.text).length
    if (size > config.maxSegmentBytes) {
      throw new ValidationError(`path segment too large: ${size} bytes`)
    }
  }
  for (const pair of model.query) {
    const keySize = utf8.encode(pair.key).length
    const valueSize = pair.value === null ? 0 : utf8.encode(pair.value).length
    if (keySize > config.maxSegmentBytes || valueSize > config.maxSegmentBytes) {
      throw new ValidationError("query component too large")
    }
  }
  if (model.hostname.length > 253) {
    throw new ValidationError("hostname too long")
  }
  if (model.port !== undefined && (model.port < 1 || model.port > 65535)) {
    throw new ValidationError(`invalid port: ${model.port}`)
  }
}
