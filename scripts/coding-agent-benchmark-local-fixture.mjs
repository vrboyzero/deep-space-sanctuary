export const CODING_AGENT_MODEL_EXECUTION_PROVIDER = "provider";
export const CODING_AGENT_MODEL_EXECUTION_LOCAL_FIXTURE = "local_fixture";

const CREDENTIAL_ENV_KEY = /(?:^|_)(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|TOKEN|SECRET|PASSWORD|COOKIE|SESSION)(?:_|$)/i;

export function resolveCodingAgentBenchmarkModelExecution(task, manifestRevision) {
  if (manifestRevision !== "v3") return CODING_AGENT_MODEL_EXECUTION_PROVIDER;
  return task?.modelExecution ?? CODING_AGENT_MODEL_EXECUTION_PROVIDER;
}

export function createCodingAgentLocalFixtureModelFingerprint(task) {
  return {
    provider: CODING_AGENT_MODEL_EXECUTION_LOCAL_FIXTURE,
    id: task.fixture.generatorId,
    credentialsConfigured: false,
  };
}

export function sanitizeCodingAgentLocalFixtureEnvironment(environment = {}) {
  return Object.fromEntries(Object.entries(environment).filter(([key]) => !CREDENTIAL_ENV_KEY.test(key)));
}
