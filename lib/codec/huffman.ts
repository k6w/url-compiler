import { UrlModel } from "../url/model"
import { NotImplemented } from "./types"

export function encodeSpecializedWithHuffman(_model: UrlModel, _dictVersion: number): Uint8Array {
  throw new NotImplemented("huffman-coded specialized bytecode")
}

export function decodeSpecializedWithHuffman(): never {
  throw new NotImplemented("huffman-coded specialized bytecode")
}
