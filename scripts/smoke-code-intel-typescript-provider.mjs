import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  CodeIntel,
  TypeScriptLanguageServiceProvider,
} from "../packages/belldandy-skills/dist/code-intel/index.js";

const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "ss-code-intel-smoke-"));
const facade = new CodeIntel({ providers: [new TypeScriptLanguageServiceProvider()] });

try {
  await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
  const definitionSource = "export function platformSymbol(): string { return \"ok\"; }\n";
  const callerSource = [
    "import { platformSymbol } from \"./definition.js\";",
    "export const platformValue = platformSymbol();",
    "",
  ].join("\n");
  await writeFile(path.join(workspaceRoot, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      module: "NodeNext",
      moduleResolution: "NodeNext",
      target: "ES2022",
    },
    include: ["src/**/*.ts"],
  }), "utf-8");
  await writeFile(path.join(workspaceRoot, "src", "definition.ts"), definitionSource, "utf-8");
  await writeFile(path.join(workspaceRoot, "src", "caller.ts"), callerSource, "utf-8");

  const now = Date.now();
  const symbolOutcome = await facade.query({
    workspace: { rootPath: workspaceRoot, revision: "smoke-revision-1" },
    operation: "symbols",
    query: "platformSymbol",
    requiredCapability: "semantic-live",
    deadlineAtMs: now + 10_000,
  });
  const definitionOutcome = await facade.query({
    workspace: { rootPath: workspaceRoot, revision: "smoke-revision-1" },
    operation: "definition",
    location: {
      path: "src/caller.ts",
      ...positionOf(callerSource, "platformSymbol", true),
    },
    requiredCapability: "semantic-live",
    deadlineAtMs: now + 10_000,
  });

  assertOutcome(symbolOutcome, "src/definition.ts");
  assertOutcome(definitionOutcome, "src/definition.ts");
  process.stdout.write(`${JSON.stringify({
    ok: true,
    platform: process.platform,
    providerId: definitionOutcome.result.provenance.providerId,
    providerVersion: definitionOutcome.result.provenance.providerVersion,
    capability: definitionOutcome.result.provenance.capability,
    workspaceRevision: definitionOutcome.result.provenance.workspaceRevision,
  })}\n`);
} finally {
  facade.dispose();
  await rm(workspaceRoot, { recursive: true, force: true });
}

function assertOutcome(outcome, expectedPath) {
  if (!outcome.ok) {
    throw new Error(`CodeIntel smoke failed: ${outcome.error.code}`);
  }
  if (outcome.result.provenance.providerId !== "typescript-language-service"
    || outcome.result.provenance.capability !== "semantic-live"
    || !outcome.result.items.some((item) => item.location.scope === "workspace"
      && item.location.path === expectedPath)) {
    throw new Error("CodeIntel smoke returned unexpected evidence.");
  }
}

function positionOf(source, needle, last = false) {
  const offset = last ? source.lastIndexOf(needle) : source.indexOf(needle);
  if (offset < 0) {
    throw new Error(`Missing smoke fixture text: ${needle}`);
  }
  const before = source.slice(0, offset).split("\n");
  return { line: before.length - 1, column: before.at(-1)?.length ?? 0 };
}
