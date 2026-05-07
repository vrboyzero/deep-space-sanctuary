/**
 * bdd setup — Onboarding Wizard (interactive) + non-interactive mode via CLI flags.
 *
 * Interactive:  bdd setup
 * Non-interactive: bdd setup --provider openai --base-url ... --api-key ... --model ...
 */
import { defineCommand } from "citty";
import fs from "node:fs";
import pc from "picocolors";
import { ensureDefaultEnvFiles } from "@star-sanctuary/distribution";
import { createCLIContext } from "../shared/context.js";
import { configureStarweaverCentral } from "./configure/bridge-starweaver-central.js";
import {
  parseEnvFile,
  removeEnvValue,
  resolveEnvPath,
  resolveEnvLocalPath,
  updateEnvValue,
} from "../shared/env-loader.js";
import type { OnboardAnswers, SetupFlow, SetupScenario } from "../wizard/onboard-shared.js";
import { answersToEnvPairs, buildAnswersFromFlags, isLocalHost } from "../wizard/onboard-shared.js";

const NON_INTERACTIVE_INPUT_KEYS = [
  "provider",
  "base-url",
  "api-key",
  "model",
  "host",
  "port",
  "auth-mode",
  "auth-secret",
] as const;

const MANAGED_ENV_KEYS = [
  "BELLDANDY_AGENT_PROVIDER",
  "BELLDANDY_OPENAI_BASE_URL",
  "BELLDANDY_OPENAI_API_KEY",
  "BELLDANDY_OPENAI_MODEL",
  "BELLDANDY_HOST",
  "BELLDANDY_PORT",
  "BELLDANDY_AUTH_MODE",
  "BELLDANDY_AUTH_TOKEN",
  "BELLDANDY_AUTH_PASSWORD",
] as const;

const INTERACTIVE_MANAGED_ENV_KEYS = [
  "BELLDANDY_HOST",
  "BELLDANDY_PORT",
  "BELLDANDY_AUTH_MODE",
  "BELLDANDY_AUTH_TOKEN",
  "BELLDANDY_AUTH_PASSWORD",
] as const;

const DEFAULT_STARWEAVER_CENTRAL_URL = "http://127.0.0.1:28767/sse";
const DEFAULT_STARWEAVER_AUTH_HEADER = "Bearer replace-with-your-sse-api-key";

function hasNonInteractiveFlags(args: Record<string, unknown>): boolean {
  return NON_INTERACTIVE_INPUT_KEYS.some((key) => {
    const value = args[key];
    return value !== undefined && value !== false && value !== "";
  });
}

export function buildSetupNextStepNotes(params: {
  flow: SetupFlow;
  interactive: boolean;
  existedBefore: boolean;
  starweaverCentralConfigured: boolean;
}): string[] {
  const doctorLine = params.existedBefore
    ? "Run 'bdd doctor' to verify the updated setup."
    : "Run 'bdd doctor' to verify your setup.";
  const starweaverLine = params.starweaverCentralConfigured
    ? "Starweaver shared-host routing was written to mcp.json; start Star_Weaver_Engine with 'pnpm host:central' and replace the placeholder SSE API key before connect."
    : "Run 'bdd configure bridge starweaver-central' to write the recommended Starweaver shared-host routing template.";

  if (!params.interactive) {
    return [
      doctorLine,
      params.existedBefore
        ? "Run 'bdd start' to relaunch Belldandy with the new config."
        : "Run 'bdd start' to launch Belldandy.",
      starweaverLine,
    ];
  }

  return [
    params.flow === "quickstart"
      ? "QuickStart no longer collects provider/API/model in CLI; finish that in WebChat Settings."
      : "Advanced saved deployment settings only; finish provider/API/model in WebChat Settings.",
    "Next: run your installed start.bat or start.sh (or use 'bdd start' in a dev workspace).",
    "Then open WebChat Settings to complete provider / API Key / model setup.",
    doctorLine,
    starweaverLine,
  ];
}

function readMergedEnvValues(envPath: string, envLocalPath: string): Map<string, string> {
  const merged = new Map<string, string>();
  for (const entry of parseEnvFile(envPath)) {
    merged.set(entry.key, entry.value);
  }
  for (const entry of parseEnvFile(envLocalPath)) {
    merged.set(entry.key, entry.value);
  }
  return merged;
}

export function reconcileSetupCommunityApiConflict(params: {
  envPath: string;
  envLocalPath: string;
  authMode: OnboardAnswers["authMode"];
}): string[] {
  if (params.authMode !== "none") {
    return [];
  }

  const mergedValues = readMergedEnvValues(params.envPath, params.envLocalPath);
  const communityApiEnabled = String(mergedValues.get("BELLDANDY_COMMUNITY_API_ENABLED") ?? "false")
    .trim()
    .toLowerCase() === "true";
  if (!communityApiEnabled) {
    return [];
  }

  updateEnvValue(params.envLocalPath, "BELLDANDY_COMMUNITY_API_ENABLED", "false");
  removeEnvValue(params.envLocalPath, "BELLDANDY_COMMUNITY_API_TOKEN");
  return [
    "Detected AUTH_MODE=none during setup; disabled Community HTTP API in .env.local to avoid an invalid auth/community combination.",
  ];
}

export default defineCommand({
  meta: { name: "setup", description: "Interactive setup wizard (or non-interactive with flags)" },
  args: {
    json: { type: "boolean", description: "JSON output" },
    "state-dir": { type: "string", description: "Override state directory" },
    flow: { type: "string", description: "Setup flow: quickstart | advanced" },
    scenario: { type: "string", description: "Run scenario: local | lan | remote" },
    // Non-interactive flags
    provider: { type: "string", description: "Agent provider: openai | mock" },
    "base-url": { type: "string", description: "OpenAI-compatible API base URL" },
    "api-key": { type: "string", description: "API key" },
    model: { type: "string", description: "Model name" },
    host: { type: "string", description: "Bind address (default: 127.0.0.1)" },
    port: { type: "string", description: "Port (default: 28889)" },
    "auth-mode": { type: "string", description: "Auth mode: none | token | password" },
    "auth-secret": { type: "string", description: "Auth token or password" },
  },
  async run({ args }) {
    const ctx = createCLIContext({ json: args.json, stateDir: args["state-dir"] });
    ensureDefaultEnvFiles(ctx.envDir);
    const projectEnvPath = resolveEnvPath(ctx.envDir);
    const envPath = resolveEnvLocalPath(ctx.envDir);
    const interactiveSetup = !hasNonInteractiveFlags(args);

    let answers: OnboardAnswers;

    if (!interactiveSetup) {
      // Non-interactive mode
      answers = buildAnswersFromFlags(args);

      // Validate required fields for openai provider
      if (answers.provider === "openai") {
        const missing: string[] = [];
        if (!answers.baseUrl) missing.push("--base-url");
        if (!answers.apiKey) missing.push("--api-key");
        if (!answers.model) missing.push("--model");
        if (missing.length > 0) {
          const msg = `OpenAI provider requires: ${missing.join(", ")}`;
          if (ctx.json) ctx.output({ error: msg });
          else ctx.error(msg);
          process.exit(1);
        }
      }

      // Validate LAN + auth
      if (!isLocalHost(answers.host) && answers.authMode === "none") {
        const msg = "Non-local access requires auth-mode token or password";
        if (ctx.json) ctx.output({ error: msg });
        else ctx.error(msg);
        process.exit(1);
      }
    } else {
      // Interactive mode
      const { runOnboardWizard } = await import("../wizard/onboard.js");
      const result = await runOnboardWizard({
        envPath,
        flow: (args.flow as SetupFlow | undefined),
        scenario: (args.scenario as SetupScenario | undefined),
      });
      if (!result) {
        process.exit(0);
      }
      answers = result;
    }

    // Write to .env.local
    const existedBefore = fs.existsSync(envPath);
    const setupNotes = reconcileSetupCommunityApiConflict({
      envPath: projectEnvPath,
      envLocalPath: envPath,
      authMode: answers.authMode,
    });
    const pairs = answersToEnvPairs(answers, {
      includeModelConfig: !interactiveSetup,
    });
    const nextKeys = new Set(pairs.map(([key]) => key));
    const managedEnvKeys = interactiveSetup ? INTERACTIVE_MANAGED_ENV_KEYS : MANAGED_ENV_KEYS;
    for (const key of managedEnvKeys) {
      if (!nextKeys.has(key)) {
        removeEnvValue(envPath, key);
      }
    }
    for (const [key, value] of pairs) {
      updateEnvValue(envPath, key, value);
    }

    const starweaverRouting = await configureStarweaverCentral({
      stateDir: ctx.stateDir,
      workspaceRoot: process.cwd(),
      centralUrl: DEFAULT_STARWEAVER_CENTRAL_URL,
      authorizationHeader: DEFAULT_STARWEAVER_AUTH_HEADER,
      localServerId: "starweaver",
      centralServerId: "starweaver-central",
    });
    const starweaverNotes = [
      starweaverRouting.changed
        ? `Wrote Starweaver shared-host routing to ${starweaverRouting.mcpPath} (starweaver-central primary, local starweaver fallback autoConnect=false).`
        : `Starweaver shared-host routing in ${starweaverRouting.mcpPath} already matched the recommended central-mode template.`,
    ];

    const nextStepNotes = buildSetupNextStepNotes({
      flow: answers.flow,
      interactive: interactiveSetup,
      existedBefore,
      starweaverCentralConfigured: true,
    });

    if (ctx.json) {
      const written: Record<string, string> = {};
      for (const [k, v] of pairs) {
        // Redact secrets in JSON output
        written[k] = /KEY|SECRET|TOKEN|PASSWORD/i.test(k)
          ? "***"
          : v;
      }
      ctx.output({
        path: envPath,
        flow: answers.flow,
        scenario: answers.scenario,
        configuredModules: [],
        notes: [...setupNotes, ...starweaverNotes, ...nextStepNotes],
        starweaverRouting: {
          configured: true,
          changed: starweaverRouting.changed,
          mcpPath: starweaverRouting.mcpPath,
          primaryServerId: starweaverRouting.centralServerId,
          fallbackServerId: starweaverRouting.localServerId,
          centralUrl: starweaverRouting.centralUrl,
        },
        config: written,
      });
    } else {
      console.log(pc.green(`\n✓ Configuration saved to ${envPath}`));
      console.log(`  ${pairs.length} value(s) written.\n`);
      console.log(pc.dim(`  Flow: ${answers.flow}`));
      console.log(pc.dim(`  Scenario: ${answers.scenario}`));
      console.log(pc.dim(`  Bind: ${answers.host}:${answers.port}`));
      console.log(pc.dim(`  Auth: ${answers.authMode}\n`));
      for (const note of setupNotes) {
        console.log(pc.dim(`  ${note}`));
      }
      for (const note of starweaverNotes) {
        console.log(pc.dim(`  ${note}`));
      }
      for (const note of nextStepNotes) {
        console.log(pc.dim(`  ${note}`));
      }
      if (setupNotes.length > 0 || starweaverNotes.length > 0 || nextStepNotes.length > 0) {
        console.log("");
      }
    }
  },
});
