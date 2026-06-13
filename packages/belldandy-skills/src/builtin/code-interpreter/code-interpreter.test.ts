import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { codeInterpreterTool } from "./index.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// Helper to check python availability
const hasPython = await new Promise<boolean>(resolve => {
    // We assume python3 is available in dev environment for tests
    import('child_process').then(cp => {
        cp.exec('python3 --version', (err) => resolve(!err));
    });
});

describe("Code Interpreter Tool", () => {
    // Use a temporary workspace root for tests
    const testWorkspaceRoot = path.join(os.tmpdir(), "belldandy_test_ci_" + Date.now());

    beforeEach(async () => {
        await fs.mkdir(testWorkspaceRoot, { recursive: true });
    });

    afterEach(async () => {
        await fs.rm(testWorkspaceRoot, { recursive: true, force: true }).catch(() => { });
    });

    const context: any = {
        workspaceRoot: testWorkspaceRoot,
    };

    it("should execute Node.js code", async () => {
        const result = await codeInterpreterTool.execute({
            language: "javascript",
            code: 'console.log("Hello Node Output");'
        }, context);

        expect(result.success).toBe(true);
        expect(result.output).toContain("Hello Node Output");
    });

    it("should execute Python code", async () => {
        if (!hasPython) {
            return;
        }

        const result = await codeInterpreterTool.execute({
            language: "python",
            code: 'print("Hello Python Output")'
        }, context);

        expect(result.success).toBe(true);
        expect(result.output).toContain("Hello Python Output");
    });

    it("should capture stderr", async () => {
        const result = await codeInterpreterTool.execute({
            language: "javascript",
            code: 'console.error("This is error");'
        }, context);

        // stderr 非空时 success=false（实现逻辑：stderr.length === 0 才算成功）
        expect(result.success).toBe(false);
        expect(result.output).toContain("[STDERR]");
        expect(result.output).toContain("This is error");
    });

    it("should handle syntax errors gracefully", async () => {
        const result = await codeInterpreterTool.execute({
            language: "javascript",
            code: 'console.log("missing paren"'
        }, context);

        // It depends on how we define success. 
        // If process code != 0, it might be failing or success=false?
        // In our implementation: 
        // child.on("close") => success is implicitly true if no spawn error? 
        // Wait, in index.ts: success: result.stderr.length === 0

        expect(result.success).toBe(false);
        expect(result.output).toContain("SyntaxError");
    });

    it("should abort a running javascript script when abortSignal is triggered", async () => {
        const controller = new AbortController();
        const resultPromise = codeInterpreterTool.execute({
            language: "javascript",
            code: 'setTimeout(() => console.log("too-late"), 5000);'
        }, {
            ...context,
            abortSignal: controller.signal,
        });

        await new Promise((resolve) => setTimeout(resolve, 120));
        controller.abort("Stopped by user.");
        const result = await resultPromise;

        expect(result.success).toBe(false);
        expect(result.error).toBe("Stopped by user.");
        expect(result.output).toBe("");
    });
});
