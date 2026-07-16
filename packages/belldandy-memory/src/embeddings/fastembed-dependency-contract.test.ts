import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

function workspaceRoot(): string {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(currentDir, "..", "..", "..", "..");
}

test("fastembed resolves tar 7 through its ESM compatibility patch", () => {
    const root = workspaceRoot();
    const rootPackage = JSON.parse(
        fs.readFileSync(path.join(root, "package.json"), "utf8"),
    ) as Record<string, any>;
    const lockfile = fs.readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8");
    const patch = fs.readFileSync(
        path.join(root, "patches", "fastembed@2.1.0.patch"),
        "utf8",
    );

    expect(rootPackage.pnpm?.overrides?.["fastembed@2.1.0>tar"]).toBe("7.5.20");
    expect(rootPackage.pnpm?.patchedDependencies?.["fastembed@2.1.0"]).toBe(
        "patches/fastembed@2.1.0.patch",
    );
    expect(lockfile).not.toContain("tar@6.2.1:");
    expect(lockfile).toContain("tar@7.5.20:");
    expect(patch).toContain('-import tar from "tar";');
    expect(patch).toContain('+import * as tar from "tar";');
});
