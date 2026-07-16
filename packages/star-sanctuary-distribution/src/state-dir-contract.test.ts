import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

function workspaceRoot(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(currentDir, "..", "..", "..");
}

test("Distribution runtime entries use the Protocol state-dir contract", () => {
  const root = workspaceRoot();
  const sourceDir = path.join(root, "packages", "star-sanctuary-distribution", "src");

  for (const sourceFile of ["runtime-paths.ts", "portable-entry.ts", "single-exe-entry.ts"]) {
    const source = fs.readFileSync(path.join(sourceDir, sourceFile), "utf-8");
    expect(source, sourceFile).toContain('from "@belldandy/protocol";');
    expect(source, sourceFile).not.toContain('from "./state-dir.js";');
  }

  expect(fs.existsSync(path.join(sourceDir, "state-dir.ts"))).toBe(false);
});
