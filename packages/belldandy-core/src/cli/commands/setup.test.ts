import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import { buildSetupNextStepNotes, reconcileSetupCommunityApiConflict } from "./setup.js";

const tempDirs = new Set<string>();

async function createEnvDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-setup-"));
  tempDirs.add(dir);
  return {
    dir,
    envPath: path.join(dir, ".env"),
    envLocalPath: path.join(dir, ".env.local"),
  };
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tempDirs.clear();
});

test("bdd setup disables community http api when auth mode is set to none", async () => {
  const { envPath, envLocalPath } = await createEnvDir();
  await fs.writeFile(envPath, "BELLDANDY_COMMUNITY_API_ENABLED=true\n", "utf-8");
  await fs.writeFile(
    envLocalPath,
    [
      "BELLDANDY_COMMUNITY_API_TOKEN=community-secret",
      "BELLDANDY_OPENAI_MODEL=gpt-test",
    ].join("\n"),
    "utf-8",
  );

  const notes = reconcileSetupCommunityApiConflict({
    envPath,
    envLocalPath,
    authMode: "none",
  });

  const envLocalContent = await fs.readFile(envLocalPath, "utf-8");
  expect(notes).toEqual([
    "Detected AUTH_MODE=none during setup; disabled Community HTTP API in .env.local to avoid an invalid auth/community combination.",
  ]);
  expect(envLocalContent).toContain("BELLDANDY_COMMUNITY_API_ENABLED=false");
  expect(envLocalContent).not.toContain("BELLDANDY_COMMUNITY_API_TOKEN=community-secret");
  expect(envLocalContent).toContain("BELLDANDY_OPENAI_MODEL=gpt-test");
});

test("bdd setup keeps existing community config unchanged when auth mode stays authenticated", async () => {
  const { envPath, envLocalPath } = await createEnvDir();
  await fs.writeFile(envPath, "BELLDANDY_COMMUNITY_API_ENABLED=true\n", "utf-8");
  await fs.writeFile(
    envLocalPath,
    [
      "BELLDANDY_COMMUNITY_API_ENABLED=true",
      "BELLDANDY_COMMUNITY_API_TOKEN=community-secret",
    ].join("\n"),
    "utf-8",
  );
  const before = await fs.readFile(envLocalPath, "utf-8");

  const notes = reconcileSetupCommunityApiConflict({
    envPath,
    envLocalPath,
    authMode: "token",
  });

  const after = await fs.readFile(envLocalPath, "utf-8");
  expect(notes).toEqual([]);
  expect(after).toBe(before);
});

test("bdd setup quickstart guidance points users to WebChat settings instead of CLI model prompts", () => {
  const notes = buildSetupNextStepNotes({
    flow: "quickstart",
    interactive: true,
    existedBefore: false,
    starweaverCentralConfigured: true,
  });

  expect(notes[0]).toContain("QuickStart no longer collects provider/API/model in CLI");
  expect(notes).toContain("Then open WebChat Settings to complete provider / API Key / model setup.");
  expect(notes).toContain("Starweaver shared-host routing was written to mcp.json; start Star_Weaver_Engine with 'pnpm host:central' and replace the placeholder SSE API key before connect.");
});

test("bdd setup advanced guidance keeps deployment setup but still hands model config to WebChat", () => {
  const notes = buildSetupNextStepNotes({
    flow: "advanced",
    interactive: true,
    existedBefore: true,
    starweaverCentralConfigured: false,
  });

  expect(notes[0]).toContain("Advanced saved deployment settings only");
  expect(notes).toContain("Run 'bdd doctor' to verify the updated setup.");
  expect(notes).toContain("Run 'bdd configure bridge starweaver-central' to write the recommended Starweaver shared-host routing template.");
});
