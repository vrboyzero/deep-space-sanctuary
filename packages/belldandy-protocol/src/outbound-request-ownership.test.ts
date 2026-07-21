import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const PACKAGE_SOURCE_ROOT = path.resolve(process.cwd(), "packages");
const TOKEN_USAGE_UPLOAD_SOURCE = "packages/belldandy-protocol/src/token-usage-upload.ts";
const OUTBOUND_POLICY_SOURCE = "packages/belldandy-protocol/src/outbound-request-policy.ts";
const OPAQUE_HTTP_SDK_OWNERS: ReadonlyArray<{
  source: string;
  owner: "OPT-S04";
  relatedOwner?: "OPT-C07";
}> = [];
const PINNED_HTTP_SDK_OWNERS = [
  {
    source: "packages/belldandy-memory/src/embeddings/openai.ts",
    owner: "OPT-S04",
    transportOwner: "packages/belldandy-memory/src/embeddings/openai-embedding-transport.ts",
    sourceMarker: "createOpenAIEmbeddingFetch",
    responseLimitMarker: "OPENAI_EMBEDDING_MAX_RESPONSE_BYTES",
  },
  {
    source: "packages/belldandy-skills/src/builtin/multimedia/understand-shared.ts",
    owner: "OPT-S04",
    transportOwner: "packages/belldandy-skills/src/builtin/multimedia/understand-openai-transport.ts",
    sourceMarker: "createUnderstandingOpenAIFetch",
    responseLimitMarker: "UNDERSTANDING_OPENAI_MAX_RESPONSE_BYTES",
  },
  {
    source: "packages/belldandy-skills/src/builtin/multimedia/tts-synthesize.ts",
    owner: "OPT-S04",
    transportOwner: "packages/belldandy-skills/src/builtin/multimedia/tts-openai-transport.ts",
    sourceMarker: "createTtsOpenAIFetch",
    responseLimitMarker: "TTS_OPENAI_MAX_ERROR_RESPONSE_BYTES",
    sourceResponseLimitMarkers: ["DEFAULT_TTS_MAX_OUTPUT_BYTES", "persistBoundedResponseToFile"],
  },
  {
    source: "packages/belldandy-skills/src/builtin/multimedia/image.ts",
    owner: "OPT-S04",
    transportOwner: "packages/belldandy-skills/src/builtin/multimedia/image-openai-transport.ts",
    sourceMarker: "createImageOpenAIFetch",
    responseLimitMarker: "IMAGE_OPENAI_RESPONSE_ENVELOPE_BYTES",
    sourceResponseLimitMarkers: ["DEFAULT_MAX_OUTPUT_BYTES", "persistBoundedResponseToFile"],
  },
  {
    source: "packages/belldandy-skills/src/builtin/multimedia/stt-transcribe.ts",
    owner: "OPT-S04",
    transportOwner: "packages/belldandy-skills/src/builtin/multimedia/stt-openai-transport.ts",
    sourceMarker: "createSttOpenAIFetch",
    responseLimitMarker: "STT_OPENAI_MAX_RESPONSE_BYTES",
  },
  {
    source: "packages/belldandy-channels/src/feishu.ts",
    owner: "OPT-S04",
    transportOwner: "packages/belldandy-channels/src/feishu-http-transport.ts",
    sourceMarker: "createFeishuHttpInstance",
    responseLimitMarker: "FEISHU_JSON_MAX_RESPONSE_BYTES",
    transportResponseLimitMarkers: ["FEISHU_RESOURCE_MAX_RESPONSE_BYTES"],
  },
  {
    source: "packages/belldandy-channels/src/discord.ts",
    owner: "OPT-S04",
    transportOwner: "packages/belldandy-channels/src/discord-rest-transport.ts",
    sourceMarker: "createDiscordRestClientOptions",
    responseLimitMarker: "DISCORD_REST_MAX_RESPONSE_BYTES",
  },
] as const;
const PINNED_HTTP_SDK_TRANSPORT_IMPORTS = [
  "packages/belldandy-channels/src/discord-rest-transport.ts",
  "packages/belldandy-channels/src/feishu-http-transport.ts",
] as const;

function listProductionSourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "dist" || entry.name === "fixtures" || entry.name === "templates") continue;
      files.push(...listProductionSourceFiles(absolutePath));
      continue;
    }
    if (!entry.isFile() || !/\.(?:[cm]?js|ts)$/u.test(entry.name)) continue;
    if (/\.(?:test|spec)\.[^.]+$/u.test(entry.name) || entry.name.endsWith(".d.ts")) continue;
    files.push(absolutePath);
  }
  return files;
}

function relativeSourcePath(absolutePath: string): string {
  return path.relative(process.cwd(), absolutePath).replaceAll(path.sep, "/");
}

function findMatchingFiles(pattern: RegExp): string[] {
  const sourceRoots = fs.readdirSync(PACKAGE_SOURCE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(PACKAGE_SOURCE_ROOT, entry.name, "src"))
    .filter((sourceRoot) => fs.existsSync(sourceRoot));

  return sourceRoots.flatMap(listProductionSourceFiles)
    .filter((absolutePath) => pattern.test(fs.readFileSync(absolutePath, "utf8")))
    .map(relativeSourcePath)
    .sort();
}

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("outbound request owner inventory", () => {
  it("keeps raw fetch calls behind an explicit cross-OPT owner", () => {
    expect(findMatchingFiles(/(?:\bglobalThis\.fetch|(?<![.\w$])fetch)\s*\(/u)).toEqual([
      TOKEN_USAGE_UPLOAD_SOURCE,
    ]);

    const source = readSource(TOKEN_USAGE_UPLOAD_SOURCE);
    expect(source).toContain("P02");
    expect(source).toContain("trusted-private");
    expect(source.match(/(?<![.\w$])fetch\s*\(/gu)).toHaveLength(1);
  });

  it("keeps direct Node HTTP client calls inside OutboundRequestPolicy", () => {
    expect(findMatchingFiles(/\b(?:client|http|https)\.request\s*\(/u)).toEqual([
      OUTBOUND_POLICY_SOURCE,
    ]);
    expect(findMatchingFiles(
      /import\s*\{[^}]*\b(?:get|request)\b[^}]*\}\s*from\s*["']node:https?["']/u,
    )).toEqual([]);
  });

  it("rejects direct imports of alternative HTTP client transports", () => {
    expect(findMatchingFiles(
      /(?:from\s*|import\s*\()\s*["'](?:axios|got|node-fetch|superagent|undici)["']/u,
    )).toEqual([]);

    const modelTransportSource = readSource(
      "packages/belldandy-agent/src/model-request-transport.ts",
    );
    expect(modelTransportSource).toContain('const moduleName = ["undici"].join("")');
    expect(modelTransportSource).toContain("new OutboundRequestPolicy");
    expect(modelTransportSource).toContain("ProxyAgentCtor");
  });

  it("keeps opaque SDK transports assigned to an explicit migration owner", () => {
    expect(findMatchingFiles(
      /(?:from\s*|require\s*\(\s*)["'](?:@larksuiteoapi\/node-sdk|discord\.js|openai)["']/u,
    )).toEqual([
      ...OPAQUE_HTTP_SDK_OWNERS.map((entry) => entry.source),
      ...PINNED_HTTP_SDK_OWNERS.map((entry) => entry.source),
      ...PINNED_HTTP_SDK_TRANSPORT_IMPORTS,
    ].sort());

    expect(OPAQUE_HTTP_SDK_OWNERS).toHaveLength(0);

    for (const entry of PINNED_HTTP_SDK_OWNERS) {
      const source = readSource(entry.source);
      const transportOwner = readSource(entry.transportOwner);
      expect(entry.owner).toBe("OPT-S04");
      expect(source).toContain(entry.sourceMarker);
      expect(transportOwner).toContain("new OutboundRequestPolicy");
      expect(transportOwner).toContain("maxRedirects: 0");
      expect(transportOwner).toContain(entry.responseLimitMarker);
      if ("transportResponseLimitMarkers" in entry) {
        for (const marker of entry.transportResponseLimitMarkers) {
          expect(transportOwner).toContain(marker);
        }
      }
      if ("sourceResponseLimitMarkers" in entry) {
        for (const marker of entry.sourceResponseLimitMarkers) {
          expect(source).toContain(marker);
        }
      }
    }
  });
});
