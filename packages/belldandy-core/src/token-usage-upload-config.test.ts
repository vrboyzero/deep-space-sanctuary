import { describe, expect, it } from "vitest";

import { readTokenUsageUploadConfig } from "./token-usage-upload-config.js";

describe("token usage upload config", () => {
  it("falls back to fail-closed defaults when trusted-private settings are missing or invalid", () => {
    expect(readTokenUsageUploadConfig((name) => ({
      BELLDANDY_TOKEN_USAGE_UPLOAD_ENABLED: "unexpected",
      BELLDANDY_TOKEN_USAGE_UPLOAD_URL: "   ",
      BELLDANDY_TOKEN_USAGE_UPLOAD_TIMEOUT_MS: "-1",
      BELLDANDY_TOKEN_USAGE_UPLOAD_TRUSTED_PRIVATE_ENDPOINT: "yes",
    })[name])).toEqual({
      enabled: false,
      url: undefined,
      token: undefined,
      timeoutMs: 3_000,
      trustedPrivateEndpoint: false,
    });
  });

  it("reads the explicit trusted-private endpoint profile without changing credential precedence", () => {
    expect(readTokenUsageUploadConfig((name) => ({
      BELLDANDY_TOKEN_USAGE_UPLOAD_ENABLED: "true",
      BELLDANDY_TOKEN_USAGE_UPLOAD_URL: " http://127.0.0.1:3001/api/internal/token-usage ",
      BELLDANDY_TOKEN_USAGE_UPLOAD_APIKEY: " api-key ",
      BELLDANDY_TOKEN_USAGE_UPLOAD_TOKEN: " legacy-token ",
      BELLDANDY_TOKEN_USAGE_UPLOAD_TIMEOUT_MS: "15000",
      BELLDANDY_TOKEN_USAGE_UPLOAD_TRUSTED_PRIVATE_ENDPOINT: "true",
    })[name])).toEqual({
      enabled: true,
      url: "http://127.0.0.1:3001/api/internal/token-usage",
      token: "api-key",
      timeoutMs: 15_000,
      trustedPrivateEndpoint: true,
    });
  });
});
