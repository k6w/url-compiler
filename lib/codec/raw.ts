import { UrlModel } from "../url/model"
import { parseUrl } from "../url/parse"
import { toUrl } from "../url/model"

export function canonicalUrlString(model: UrlModel): string {
  return toUrl(model)
}

export function modelFromUrlString(url: string): UrlModel {
  return parseUrl(url)
}
