import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ConversationStore } from "./conversation.js";

describe("ConversationStore session artifact inventory", () => {
    const cleanupDirs = new Set<string>();

    afterEach(async () => {
        for (const dir of cleanupDirs) {
            await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
        }
        cleanupDirs.clear();
    });

    it("keeps artifact inventory bound to the store data root", async () => {
        const firstRoot = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-store-inventory-a-"));
        const secondRoot = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-store-inventory-b-"));
        cleanupDirs.add(firstRoot);
        cleanupDirs.add(secondRoot);

        await fs.writeFile(path.join(firstRoot, "agent%3Adefault%3Amain.meta.json"), JSON.stringify({
            conversationId: "agent:default:main",
        }), "utf-8");
        await fs.writeFile(path.join(firstRoot, "agent%3Adefault%3Amain.digest.json"), "{}", "utf-8");
        await fs.writeFile(path.join(secondRoot, "agent%3Ashared%3Amain.meta.json"), JSON.stringify({
            conversationId: "agent:shared:main",
        }), "utf-8");
        await fs.writeFile(path.join(secondRoot, "agent%3Ashared%3Amain.session-memory.json"), "{}", "utf-8");

        const firstStore = new ConversationStore({ dataDir: firstRoot });
        const secondStore = new ConversationStore({ dataDir: secondRoot });

        await expect(firstStore.listSessionArtifactInventoryPage()).resolves.toMatchObject({
            status: "ready",
            items: [{
                conversationId: "agent:default:main",
                safeConversationId: "agent%3Adefault%3Amain",
                digestPath: path.join(firstRoot, "agent%3Adefault%3Amain.digest.json"),
            }],
        });
        await expect(secondStore.listSessionArtifactInventoryPage()).resolves.toMatchObject({
            status: "ready",
            items: [{
                conversationId: "agent:shared:main",
                safeConversationId: "agent%3Ashared%3Amain",
                sessionMemoryPath: path.join(secondRoot, "agent%3Ashared%3Amain.session-memory.json"),
            }],
        });
    });

    it("reports unavailable instead of falling back to an unrelated root", async () => {
        const store = new ConversationStore();

        await expect(store.listSessionArtifactInventoryPage()).resolves.toMatchObject({
            status: "unavailable",
            items: [],
            diagnostics: { unavailableReason: "root_unavailable" },
        });
    });
});
