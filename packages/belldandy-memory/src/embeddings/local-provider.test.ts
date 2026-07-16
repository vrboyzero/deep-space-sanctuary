import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, expect, test, vi } from "vitest";

const fastembedMock = vi.hoisted(() => ({
    embed: vi.fn(),
    init: vi.fn(),
}));

vi.mock("fastembed", () => ({
    FlagEmbedding: {
        init: fastembedMock.init,
    },
}));

import { LocalEmbeddingProvider } from "./local-provider.js";
import { MemoryManager } from "../manager.js";

beforeEach(() => {
    fastembedMock.embed.mockReset();
    fastembedMock.init.mockReset();
    fastembedMock.embed.mockImplementation(async function* (texts: string[]) {
        yield texts.map(() => [0.25, -0.5]);
    });
    fastembedMock.init.mockResolvedValue({ embed: fastembedMock.embed });
});

test("local embedding normalizes a documented model alias for Fastembed", async () => {
    const provider = new LocalEmbeddingProvider("BAAI/bge-small-en-v1.5");

    await expect(provider.embed("hello")).resolves.toEqual([0.25, -0.5]);
    expect(fastembedMock.init).toHaveBeenCalledWith({
        cacheDir: undefined,
        model: "fast-bge-small-en-v1.5",
    });
});

test("local memory uses a Fastembed-supported model when no model is configured", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-local-embedding-"));
    const modelsDir = path.join(rootDir, "models");
    const manager = new MemoryManager({
        workspaceRoot: rootDir,
        stateDir: rootDir,
        storePath: path.join(rootDir, "memory.sqlite"),
        provider: "local",
        modelsDir,
    });

    try {
        await expect(manager.embedRetrievalQuery("hello")).resolves.toEqual([0.25, -0.5]);
        expect(fastembedMock.init).toHaveBeenCalledWith({
            cacheDir: modelsDir,
            model: "fast-bge-small-en-v1.5",
        });
    } finally {
        await manager.close();
        await fs.rm(rootDir, { recursive: true, force: true });
    }
});

test("local embedding rejects an unsupported model before Fastembed initialization", async () => {
    const provider = new LocalEmbeddingProvider("BAAI/bge-m3");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
        await expect(provider.embed("hello")).rejects.toThrow(
            'Unsupported local embedding model "BAAI/bge-m3" for Fastembed 2',
        );
        expect(fastembedMock.init).not.toHaveBeenCalled();
    } finally {
        errorSpy.mockRestore();
    }
});

test("local embedding leaves model cache population to Fastembed", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-fastembed-cache-"));
    const cacheDir = path.join(rootDir, "nested", "models");
    fastembedMock.init.mockImplementation(async ({ model }: { model: string }) => {
        expect((await fs.stat(cacheDir)).isDirectory()).toBe(true);
        await expect(fs.stat(path.join(cacheDir, model))).rejects.toMatchObject({ code: "ENOENT" });
        return { embed: fastembedMock.embed };
    });

    try {
        const provider = new LocalEmbeddingProvider("fast-bge-small-en-v1.5", cacheDir);
        await expect(provider.embed("hello")).resolves.toEqual([0.25, -0.5]);
    } finally {
        await fs.rm(rootDir, { recursive: true, force: true });
    }
});
