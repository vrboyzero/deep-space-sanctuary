import { withGoalRegistryMutationLock } from "../goal-registry-mutation-queue.ts";

const [stateDir] = process.argv.slice(2);
if (!stateDir || typeof process.send !== "function") {
  throw new Error("Goal registry lock child fixture requires stateDir and IPC.");
}

function waitForCommand(command) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${command}.`));
    }, 5_000);
    timer.unref?.();

    const onMessage = (message) => {
      if (message !== command) return;
      cleanup();
      resolve();
    };
    const cleanup = () => {
      clearTimeout(timer);
      process.off("message", onMessage);
    };
    process.on("message", onMessage);
  });
}

try {
  process.send({ type: "ready" });
  await waitForCommand("start");
  await withGoalRegistryMutationLock(stateDir, async () => {
    process.send({ type: "entered" });
    await waitForCommand("release");
  });
  process.send({ type: "done" });
} catch (error) {
  process.send({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
}
