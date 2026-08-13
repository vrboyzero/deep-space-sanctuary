import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(currentDir, "..", "..", "..");

function readJson(relativePath: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(workspaceRoot, relativePath), "utf-8"));
}

test("dependency contract removes the unused QQ SDK and keeps direct ws consumers on the fixed line", () => {
  const channelsPackage = readJson("packages/belldandy-channels/package.json");
  expect(channelsPackage.dependencies?.["qq-guild-bot"]).toBeUndefined();

  for (const relativePath of [
    "package.json",
    "packages/belldandy-browser/package.json",
    "packages/belldandy-channels/package.json",
    "packages/belldandy-core/package.json",
    "packages/belldandy-skills/package.json",
  ]) {
    const packageJson = readJson(relativePath);
    const wsRange = packageJson.dependencies?.ws ?? packageJson.devDependencies?.ws;
    expect(wsRange, relativePath).toBe("^8.21.1");
  }

  const lockfile = fs.readFileSync(path.join(workspaceRoot, "pnpm-lock.yaml"), "utf-8");
  expect(lockfile).not.toContain("qq-guild-bot@2.9.5");
  expect(lockfile).not.toContain("ws@7.5.10");
  expect(lockfile).toContain("ws@8.21.1");
});

test("dependency contract keeps Feishu on the audited same-major SDK line", () => {
  const channelsPackage = readJson("packages/belldandy-channels/package.json");
  expect(channelsPackage.dependencies?.["@larksuiteoapi/node-sdk"]).toBe("^1.71.1");

  const lockfile = fs.readFileSync(path.join(workspaceRoot, "pnpm-lock.yaml"), "utf-8");
  expect(lockfile).toContain("'@larksuiteoapi/node-sdk@1.71.1':");
  expect(lockfile).not.toContain("'@larksuiteoapi/node-sdk@1.58.0':");
});

test("dependency contract keeps Discord on the upstream Undici-fixed same-major SDK line", () => {
  const rootPackage = readJson("package.json");
  const channelsPackage = readJson("packages/belldandy-channels/package.json");
  expect(channelsPackage.dependencies?.["discord.js"]).toBe("^14.27.0");

  const lockfile = fs.readFileSync(path.join(workspaceRoot, "pnpm-lock.yaml"), "utf-8");
  expect(lockfile).toContain("discord.js@14.27.0");
  expect(lockfile).not.toContain("discord.js@14.26.5");
  expect(lockfile).toContain("'@discordjs/rest@2.6.2':");
  expect(lockfile).not.toContain("'@discordjs/rest@2.6.1':");
  expect(rootPackage.pnpm?.overrides?.["undici@6.27.0"]).toBe("6.28.0");
  expect(lockfile).toContain("undici@6.28.0:");
  expect(lockfile).not.toMatch(/^  undici@6\.27\.0:$/m);
});

test("dependency contract keeps MCP consumers on the audited same-major SDK line", () => {
  const rootPackage = readJson("package.json");
  const mcpPackage = readJson("packages/belldandy-mcp/package.json");
  expect(rootPackage.devDependencies?.["@modelcontextprotocol/sdk"]).toBe("^1.29.0");
  expect(mcpPackage.dependencies?.["@modelcontextprotocol/sdk"]).toBe("^1.29.0");

  const lockfile = fs.readFileSync(path.join(workspaceRoot, "pnpm-lock.yaml"), "utf-8");
  expect(lockfile).toContain("'@modelcontextprotocol/sdk@1.29.0'");
  expect(lockfile).not.toContain("'@modelcontextprotocol/sdk@1.26.0'");
});

test("dependency contract keeps Puppeteer consumers on the audited 25 line without extract-zip", () => {
  const rootPackage = readJson("package.json");
  const skillsPackage = readJson("packages/belldandy-skills/package.json");
  expect(rootPackage.devDependencies?.["puppeteer-core"]).toBe("^25.7.0");
  expect(skillsPackage.dependencies?.["puppeteer-core"]).toBe("^25.7.0");

  const lockfile = fs.readFileSync(path.join(workspaceRoot, "pnpm-lock.yaml"), "utf-8");
  expect(lockfile).toContain("puppeteer-core@25.7.0");
  expect(lockfile).toContain("'@puppeteer/browsers@3.2.0'");
  expect(lockfile).toContain("modern-tar@");
  expect(lockfile).not.toContain("puppeteer-core@24.");
  expect(lockfile).not.toContain("'@puppeteer/browsers@2.");
  expect(lockfile).not.toContain("extract-zip@");
});

test("dependency contract deduplicates vulnerable transitive versions within consumer ranges", () => {
  const lockfile = fs.readFileSync(path.join(workspaceRoot, "pnpm-lock.yaml"), "utf-8");
  expect(lockfile).toContain("form-data@4.0.6");
  expect(lockfile).not.toContain("form-data@4.0.5");
  expect(lockfile).toContain("qs@6.15.3");
  expect(lockfile).not.toContain("qs@6.14.1");
});

test("dependency contract keeps Readability on the fixed 0.6 line", () => {
  const skillsPackage = readJson("packages/belldandy-skills/package.json");
  expect(skillsPackage.dependencies?.["@mozilla/readability"]).toBe("^0.6.0");

  const lockfile = fs.readFileSync(path.join(workspaceRoot, "pnpm-lock.yaml"), "utf-8");
  expect(lockfile).toContain("'@mozilla/readability@0.6.0':");
  expect(lockfile).not.toContain("'@mozilla/readability@0.5.0':");
});

test("dependency contract keeps the SMTP provider on the audited Nodemailer 9 line", () => {
  const corePackage = readJson("packages/belldandy-core/package.json");
  expect(corePackage.dependencies?.nodemailer).toBe("^9.0.3");

  const lockfile = fs.readFileSync(path.join(workspaceRoot, "pnpm-lock.yaml"), "utf-8");
  expect(lockfile).toContain("nodemailer@9.0.3:");
  expect(lockfile).not.toContain("nodemailer@6.10.1:");
});

test("dependency contract keeps all Vitest consumers on the audited 3.2 line", () => {
  const rootPackage = readJson("package.json");
  for (const relativePath of [
    "package.json",
    "packages/belldandy-memory/package.json",
    "packages/belldandy-mcp/package.json",
    "packages/belldandy-skills/package.json",
  ]) {
    const packageJson = readJson(relativePath);
    expect(packageJson.devDependencies?.vitest, relativePath).toBe("^3.2.6");
  }
  expect(rootPackage.devDependencies?.vite).toBe("^6.4.3");
  expect(rootPackage.pnpm?.overrides?.vite).toBe("6.4.3");

  const lockfile = fs.readFileSync(path.join(workspaceRoot, "pnpm-lock.yaml"), "utf-8");
  expect(lockfile).toContain("vitest@3.2.7");
  expect(lockfile).not.toContain("vitest@2.1.9");
  expect(lockfile).toContain("vite@6.4.3");
  expect(lockfile).not.toContain("vite@5.4.21");
  expect(lockfile).not.toContain("esbuild@0.21.5");
});

test("dependency contract keeps the optional local embedding backend on Fastembed 2", () => {
  const memoryPackage = readJson("packages/belldandy-memory/package.json");
  expect(memoryPackage.optionalDependencies?.fastembed).toBe("^2.1.0");

  const lockfile = fs.readFileSync(path.join(workspaceRoot, "pnpm-lock.yaml"), "utf-8");
  expect(lockfile).toContain("fastembed@2.1.0:");
  expect(lockfile).not.toContain("fastembed@1.14.4:");
});

test("dependency contract refreshes path-to-regexp within the Router declaration", () => {
  const lockfile = fs.readFileSync(path.join(workspaceRoot, "pnpm-lock.yaml"), "utf-8");
  expect(lockfile).toContain("path-to-regexp@8.4.2:");
  expect(lockfile).not.toContain("path-to-regexp@8.3.0:");
});

test("dependency contract refreshes PostCSS and Nano ID within the Vite declaration", () => {
  const rootPackage = readJson("package.json");
  expect(rootPackage.pnpm?.overrides?.["vite@6.4.3>postcss"]).toBe("8.5.26");
  expect(rootPackage.pnpm?.overrides?.["nanoid@3.3.16"]).toBe("3.3.18");

  const lockfile = fs.readFileSync(path.join(workspaceRoot, "pnpm-lock.yaml"), "utf-8");
  expect(lockfile).toContain("postcss@8.5.26:");
  expect(lockfile).toContain("nanoid@3.3.18:");
  expect(lockfile).not.toContain("postcss@8.5.19:");
  expect(lockfile).not.toMatch(/^  nanoid@3\.3\.16:$/m);
});

test("dependency contract refreshes Rollup within the Vite declaration", () => {
  const rootPackage = readJson("package.json");
  expect(rootPackage.pnpm?.overrides?.["vite@6.4.3>rollup"]).toBe("4.62.2");

  const lockfile = fs.readFileSync(path.join(workspaceRoot, "pnpm-lock.yaml"), "utf-8");
  expect(lockfile).toContain("rollup@4.62.2:");
  expect(lockfile).not.toContain("rollup@4.57.1:");
});

test("dependency contract refreshes Tar 7 within optional native consumer declarations", () => {
  const rootPackage = readJson("package.json");
  expect(rootPackage.pnpm?.overrides?.["fastembed@2.1.0>tar"]).toBe("7.5.21");
  expect(rootPackage.pnpm?.overrides?.["onnxruntime-node@1.21.0>tar"]).toBe("7.5.21");

  const lockfile = fs.readFileSync(path.join(workspaceRoot, "pnpm-lock.yaml"), "utf-8");
  expect(lockfile).toContain("tar@7.5.21:");
  expect(lockfile).not.toContain("tar@7.5.20:");
  expect(lockfile).not.toContain("tar@7.5.7:");
  expect(lockfile).not.toContain("tar@6.2.1:");
});

test("dependency contract refreshes Undici 7 within the Jsdom declaration", () => {
  const rootPackage = readJson("package.json");
  expect(rootPackage.pnpm?.overrides?.["undici@7.28.0"]).toBe("7.29.0");

  const lockfile = fs.readFileSync(path.join(workspaceRoot, "pnpm-lock.yaml"), "utf-8");
  expect(lockfile).toContain("undici@7.29.0:");
  expect(lockfile).not.toMatch(/^  undici@7\.28\.0:$/m);
  expect(lockfile).not.toContain("undici@7.21.0:");
});

test("dependency contract pins patched transitive security floors", () => {
  const rootPackage = readJson("package.json");
  const overrides = rootPackage.pnpm?.overrides ?? {};

  expect(overrides["@hono/node-server@1.19.14"]).toBe("1.19.17");
  expect(overrides["body-parser@2.2.2"]).toBe("2.3.0");
  expect(overrides["fast-uri@3.1.3"]).toBe("3.1.5");
  expect(overrides["hono@4.12.30"]).toBe("4.13.2");
  expect(overrides["ip-address@10.2.0"]).toBe("10.5.0");

  const lockfile = fs.readFileSync(path.join(workspaceRoot, "pnpm-lock.yaml"), "utf-8");
  for (const fixedVersion of [
    "'@hono/node-server@1.19.17'",
    "body-parser@2.3.0:",
    "fast-uri@3.1.5:",
    "hono@4.13.2:",
    "ip-address@10.5.0:",
  ]) {
    expect(lockfile).toContain(fixedVersion);
  }
  for (const vulnerableSnapshot of [
    /^  '@hono\/node-server@1\.19\.14':$/m,
    /^  body-parser@2\.2\.2:$/m,
    /^  fast-uri@3\.1\.3:$/m,
    /^  hono@4\.12\.30:$/m,
    /^  ip-address@10\.2\.0:$/m,
  ]) {
    expect(lockfile).not.toMatch(vulnerableSnapshot);
  }
});

test("dependency contract keeps DOMPurify on the patched 3.4 line", () => {
  const rootPackage = readJson("package.json");
  expect(rootPackage.devDependencies?.dompurify).toBe("^3.4.13");

  const lockfile = fs.readFileSync(path.join(workspaceRoot, "pnpm-lock.yaml"), "utf-8");
  expect(lockfile).toContain("dompurify@3.4.13:");
  expect(lockfile).not.toContain("dompurify@3.4.12:");
});
