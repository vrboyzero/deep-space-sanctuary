import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("CronStore file lock wiring", () => {
  it("keeps cross-process lock policy in the adjacent owner", () => {
    const storeSource = readSource("packages/belldandy-core/src/cron/store.ts");
    const queueSource = readSource("packages/belldandy-core/src/cron/store-mutation-queue.ts");
    const gatewaySource = readSource("packages/belldandy-core/src/bin/gateway-main.ts");

    expect(storeSource).toContain('from "./store-mutation-queue.js"');
    expect(storeSource).not.toContain("store-file-lock");
    expect(queueSource).toContain('from "./store-file-lock.js"');
    expect(queueSource).toContain("withCronStoreFileLock(filePath, mutation)");
    expect(gatewaySource).not.toContain("withCronStoreFileLock");
    expect(gatewaySource).not.toContain("CronStoreLockTimeoutError");
  });
});
