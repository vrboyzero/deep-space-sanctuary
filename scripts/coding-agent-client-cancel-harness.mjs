import {
  sanitizeCodingAgentLocalFixtureEnvironment,
} from "./coding-agent-benchmark-local-fixture.mjs";
import {
  startGatewayProcessRestartSupervisor,
} from "./coding-agent-process-restart-harness.mjs";

export async function executeGatewayClientCancellationCodingCi(input) {
  const supervisor = await startGatewayProcessRestartSupervisor({
    stateDir: input.stateDir,
    workspace: input.workspace,
    sourceRoot: input.sourceRoot,
    manifestRevision: input.manifestRevision,
  });
  let runner;
  let failure;
  try {
    const target = supervisor.getTarget();
    runner = await input.executeCodingCi({
      ...input,
      gatewayWorkspace: input.workspace,
      modelId: undefined,
      maxCostUsd: undefined,
      childEnv: {
        ...sanitizeCodingAgentLocalFixtureEnvironment(input.childEnv),
        BELLDANDY_HOST: target.host,
        BELLDANDY_PORT: String(target.port),
        BELLDANDY_AUTH_MODE: "none",
      },
    });
  } catch (error) {
    failure = error;
  }

  const cleanup = await supervisor.close();
  if (failure) throw failure;
  if (cleanup.managedGatewayProcessCount !== 0) {
    return {
      ...runner,
      exitCode: runner?.exitCode === 0 ? 4 : runner?.exitCode ?? 4,
      stderr: [runner?.stderr, "Client cancellation fixture Gateway cleanup did not converge."]
        .filter(Boolean).join("\n"),
    };
  }
  return runner;
}
