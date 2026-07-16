import crypto from "node:crypto";

const BOOTSTRAP_AUTH_TOKEN_BYTES = 32;

export function generateBootstrapAuthToken(): string {
  // Bearer setup token 需要足够熵，同时保持 URL query 无需额外转义。
  const secret = crypto.randomBytes(BOOTSTRAP_AUTH_TOKEN_BYTES).toString("base64url");
  return `setup-${secret}`;
}
