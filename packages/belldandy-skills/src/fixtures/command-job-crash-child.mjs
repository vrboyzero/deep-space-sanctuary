import { CommandJobManager, CommandJobStateStore } from "../command-job.ts";
import { createCommandJobProcess } from "../command-job-runtime.ts";

const [stateDir, jobId, containerName, mode, image] = process.argv.slice(2);
if (!stateDir
  || !jobId
  || !containerName
  || (mode !== "pipe" && mode !== "pty")
  || !image
  || typeof process.send !== "function") {
  throw new Error("Command job crash child requires state, job, container, stdin mode, image, and IPC arguments.");
}

function holdUntilTerminated() {
  return new Promise(() => {});
}

async function waitForEcho(manager) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const output = manager.read(jobId, { cursor: 0, maxBytes: 16 * 1024 }).output;
    if (output.includes("ECHO:probe")) return output;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for interactive OCI output.");
}

try {
  const manager = new CommandJobManager({ store: new CommandJobStateStore(stateDir) });
  await manager.initialize();
  const runtimeScript = [
    "process.stdout.write('READY\\n');",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', (chunk) => process.stdout.write('ECHO:' + chunk));",
    "setInterval(() => {}, 1000);",
  ].join(" ");
  const invocation = {
    executable: "docker",
    args: [
      "run",
      "--pull=never",
      "--name", containerName,
      "--network", "none",
      "--cap-drop", "ALL",
      "--pids-limit", "64",
      "--memory", "128m",
      "-i",
      ...(mode === "pty" ? ["-t"] : []),
      image,
      "node", "-e", runtimeScript,
    ],
    cwd: process.cwd(),
    env: process.env,
    stdinMode: mode,
  };
  const started = await manager.start({
    jobId,
    stdinMode: mode,
    timeoutMs: 60_000,
    persistedSandbox: { runtime: "docker", containerName },
    startProcess: () => createCommandJobProcess(invocation),
  });
  if (started.status !== "running") {
    throw new Error(started.error ?? `Command job entered unexpected ${started.status} status.`);
  }
  if (mode === "pty") manager.resize(jobId, 120, 36);
  manager.write(jobId, "probe\n");
  const output = await waitForEcho(manager);
  process.send({
    type: "running",
    mode,
    jobId,
    containerName,
    output,
    processPid: started.pid,
  });
  await holdUntilTerminated();
} catch (error) {
  process.send({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
}
