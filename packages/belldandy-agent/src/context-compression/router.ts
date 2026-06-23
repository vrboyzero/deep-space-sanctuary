/**
 * 压缩器路由
 *
 * 根据内容类型选择合适的压缩器。
 * 若无匹配压缩器，回退到 passthrough。
 */

import type { CompressionContentType, ContextCompressor } from "./types.js";

export class CompressionRouter {
  private readonly compressors: ContextCompressor[];
  private readonly fallback: ContextCompressor;

  constructor(compressors: ContextCompressor[], fallback: ContextCompressor) {
    this.compressors = compressors;
    this.fallback = fallback;
  }

  select(contentType: CompressionContentType): ContextCompressor {
    for (const compressor of this.compressors) {
      if (compressor.supports(contentType)) {
        return compressor;
      }
    }
    return this.fallback;
  }
}
