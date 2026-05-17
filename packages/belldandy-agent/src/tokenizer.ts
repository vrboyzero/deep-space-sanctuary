export type TokenEstimateProfileId = "generic" | "deepseek" | "openai" | "anthropic";

export type TokenEstimateOptions = {
  profile?: TokenEstimateProfileId;
  model?: string;
  provider?: string;
};

type TokenEstimateProfile = {
  asciiWordDivisor: number;
  digitDivisor: number;
  cjkPerChar: number;
  asciiSymbolPerChar: number;
  newlineWeight: number;
  otherUnicodeByteDivisor: number;
};

const TOKEN_SEGMENT_RE =
  /([\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af])|([A-Za-z]+(?:['_-][A-Za-z0-9]+)*)|(\d+(?:[.,:_/-]\d+)*)|(\s+)|([^\sA-Za-z0-9\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]+)/gu;
const ASCII_SYMBOL_RUN_RE = /^[\x21-\x7e]+$/;

const TOKEN_ESTIMATE_PROFILES: Record<TokenEstimateProfileId, TokenEstimateProfile> = {
  generic: {
    asciiWordDivisor: 5,
    digitDivisor: 4,
    cjkPerChar: 1,
    asciiSymbolPerChar: 0.75,
    newlineWeight: 0.35,
    otherUnicodeByteDivisor: 3,
  },
  deepseek: {
    asciiWordDivisor: 5,
    digitDivisor: 4,
    cjkPerChar: 1,
    asciiSymbolPerChar: 0.8,
    newlineWeight: 0.4,
    otherUnicodeByteDivisor: 2.9,
  },
  openai: {
    asciiWordDivisor: 5,
    digitDivisor: 4,
    cjkPerChar: 0.95,
    asciiSymbolPerChar: 0.7,
    newlineWeight: 0.35,
    otherUnicodeByteDivisor: 3.1,
  },
  anthropic: {
    asciiWordDivisor: 5,
    digitDivisor: 4,
    cjkPerChar: 0.95,
    asciiSymbolPerChar: 0.7,
    newlineWeight: 0.35,
    otherUnicodeByteDivisor: 3.1,
  },
};

export function resolveTokenEstimateProfile(input?: {
  profile?: TokenEstimateProfileId;
  model?: string;
  provider?: string;
}): TokenEstimateProfileId {
  if (input?.profile && TOKEN_ESTIMATE_PROFILES[input.profile]) {
    return input.profile;
  }
  const model = `${input?.model ?? ""}`.trim().toLowerCase();
  const provider = `${input?.provider ?? ""}`.trim().toLowerCase();
  const source = `${provider} ${model}`.trim();
  if (!source) {
    return "generic";
  }
  if (source.includes("deepseek")) {
    return "deepseek";
  }
  if (
    source.includes("gpt")
    || source.includes("o1")
    || source.includes("o3")
    || source.includes("o4")
    || source.includes("openai")
  ) {
    return "openai";
  }
  if (source.includes("claude") || source.includes("anthropic")) {
    return "anthropic";
  }
  return "generic";
}

export function estimateTokens(text: string, options?: TokenEstimateOptions): number {
  if (!text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;

  const profileId = resolveTokenEstimateProfile(options);
  const profile = TOKEN_ESTIMATE_PROFILES[profileId];
  let estimate = 0;

  for (const match of trimmed.matchAll(TOKEN_SEGMENT_RE)) {
    const cjk = match[1];
    if (cjk) {
      estimate += profile.cjkPerChar;
      continue;
    }

    const asciiWord = match[2];
    if (asciiWord) {
      estimate += Math.ceil(asciiWord.length / profile.asciiWordDivisor);
      continue;
    }

    const digits = match[3];
    if (digits) {
      estimate += Math.ceil(digits.length / profile.digitDivisor);
      continue;
    }

    const whitespace = match[4];
    if (whitespace) {
      const newlineCount = (whitespace.match(/\n/g) || []).length;
      estimate += newlineCount * profile.newlineWeight;
      continue;
    }

    const other = match[5];
    if (!other) {
      continue;
    }

    if (ASCII_SYMBOL_RUN_RE.test(other)) {
      estimate += other.length * profile.asciiSymbolPerChar;
      continue;
    }

    estimate += Math.ceil(Buffer.byteLength(other, "utf8") / profile.otherUnicodeByteDivisor);
  }

  return Math.max(1, Math.ceil(estimate));
}
