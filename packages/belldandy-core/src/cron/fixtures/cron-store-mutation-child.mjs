import fs from "node:fs/promises";
import path from "node:path";

import { CronStore } from "../store.ts";

const [stateDir, jobName] = process.argv.slice(2);
if (!stateDir || !jobName || typeof process.send !== "function") {
  throw new Error("CronStore child fixture requires stateDir, jobName, and IPC.");
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

const storeFile = path.resolve(stateDir, "cron-jobs.json");
const originalReadFile = fs.readFile.bind(fs);
let interceptedStoreRead = false;
fs.readFile = async (...args) => {
  const content = await originalReadFile(...args);
  if (!interceptedStoreRead && path.resolve(String(args[0])) === storeFile) {
    interceptedStoreRead = true;
    process.send({ type: "loaded" });
    await waitForCommand("continue");
  }
  return content;
};

try {
  const store = new CronStore(stateDir);
  process.send({ type: "ready" });
  await waitForCommand("start");
  await store.add({
    name: jobName,
    schedule: { kind: "every", everyMs: 60_000, anchorMs: 1_000 },
    payload: { kind: "systemEvent", text: `run ${jobName}` },
  });
  process.send({ type: "done" });
} catch (error) {
  process.send({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
}
