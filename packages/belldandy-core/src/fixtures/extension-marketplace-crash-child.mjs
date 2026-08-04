import fs from "node:fs/promises";
import path from "node:path";

import {
  installMarketplaceExtension,
  uninstallMarketplaceExtension,
  updateMarketplaceExtension,
} from "../extension-marketplace-service.ts";

const [stateDir, sourceDir, confirmationHash, phase, operation = "install", extensionId] = process.argv.slice(2);
if (!stateDir
  || !sourceDir
  || !confirmationHash
  || (phase !== "confirmed" && phase !== "installed" && phase !== "removed")
  || (operation !== "install" && operation !== "update" && operation !== "uninstall")
  || (operation !== "install" && !extensionId)
  || (phase === "installed" && operation === "uninstall")
  || (phase === "removed" && operation !== "uninstall")
  || typeof process.send !== "function") {
  throw new Error("Marketplace crash child requires state, source, confirmation, phase, operation, and IPC arguments.");
}

function holdUntilTerminated() {
  return new Promise(() => {});
}

const originalRename = fs.rename.bind(fs);
fs.rename = async (sourcePath, targetPath) => {
  if (path.basename(path.dirname(String(targetPath))) === "audit") {
    const record = JSON.parse(await fs.readFile(sourcePath, "utf-8"));
    if (phase === "confirmed" && record.operation === operation && record.status === "confirmed") {
      await originalRename(sourcePath, targetPath);
      process.send({ type: "confirmed" });
      return holdUntilTerminated();
    }
    const committedPhase = operation === "uninstall" ? "removed" : "installed";
    if (phase === committedPhase && record.operation === operation && record.status === "completed") {
      process.send({ type: committedPhase });
      return holdUntilTerminated();
    }
  }
  return originalRename(sourcePath, targetPath);
};

try {
  if (operation === "update") {
    await updateMarketplaceExtension({ stateDir, extensionId, confirmationHash });
  } else if (operation === "uninstall") {
    await uninstallMarketplaceExtension({ stateDir, extensionId, confirmationHash });
  } else {
    await installMarketplaceExtension({
      stateDir,
      marketplace: "crash-market",
      source: { source: "directory", path: sourceDir },
      confirmationHash,
    });
  }
  process.send({ type: "error", message: `Marketplace ${operation} passed unexpected ${phase} crash point.` });
} catch (error) {
  process.send({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
}
