export const CONVERSATION_PERSISTENCE_LANES = [
    "append",
    "compaction_state",
    "session_digest_state",
    "session_memory",
] as const;

export type ConversationPersistenceLane = typeof CONVERSATION_PERSISTENCE_LANES[number];
export type ConversationLifecycleGeneration = symbol;

export type ConversationLifecycleSnapshot = {
    activeGeneration: boolean;
    pendingPersistenceLaneCount: number;
    releasing: boolean;
};

/**
 * 统一管理 ConversationStore 的写链和 release fence。
 * generation 使用不可复用的 Symbol，删除后重新打开同名会话也不会产生 ABA 误判。
 */
export class ConversationLifecycleCoordinator {
    private readonly generations = new Map<string, ConversationLifecycleGeneration>();
    private readonly releases = new Map<string, Promise<void>>();
    private readonly writeChains = new Map<ConversationPersistenceLane, Map<string, Promise<void>>>(
        CONVERSATION_PERSISTENCE_LANES.map((lane) => [lane, new Map<string, Promise<void>>()]),
    );

    captureGeneration(conversationId: string): ConversationLifecycleGeneration {
        const current = this.generations.get(conversationId);
        if (current) return current;
        if (this.releases.has(conversationId)) {
            // release fence 期间的新异步入口不得建立可写 generation；owner 应在 release 后再启动新 run。
            return Symbol(`releasing:${conversationId}`);
        }

        const generation = Symbol(conversationId);
        this.generations.set(conversationId, generation);
        return generation;
    }

    isGenerationCurrent(
        conversationId: string,
        generation: ConversationLifecycleGeneration,
    ): boolean {
        return this.generations.get(conversationId) === generation;
    }

    enqueue(
        lane: ConversationPersistenceLane,
        conversationId: string,
        task: () => Promise<void>,
    ): Promise<void> {
        const chains = this.writeChains.get(lane)!;
        const previous = chains.get(conversationId) ?? Promise.resolve();
        const next = previous
            .catch(() => undefined)
            .then(task);

        chains.set(conversationId, next);
        void next.then(
            () => this.deleteSettledChain(chains, conversationId, next),
            () => this.deleteSettledChain(chains, conversationId, next),
        );
        return next;
    }

    async waitForPendingPersistence(conversationId: string): Promise<void> {
        while (true) {
            const pending = this.getPendingWrites(conversationId);
            if (pending.length === 0) return;

            await Promise.all(pending.map((write) => write.catch(() => undefined)));
        }
    }

    async waitForAllPendingPersistence(): Promise<void> {
        // settlement 期间可能追加下一条写链，因此循环到所有 lane 的 Map 同时为空。
        while (true) {
            const pending = [...this.writeChains.values()]
                .flatMap((chains) => [...chains.values()]);
            if (pending.length === 0) return;

            await Promise.all(pending.map((write) => write.catch(() => undefined)));
        }
    }

    release(conversationId: string, clearState: () => void): Promise<void> {
        const existing = this.releases.get(conversationId);
        if (existing) return existing;

        // 先使长异步操作持有的旧 generation 失效，再等待已经登记的持久化链落盘。
        this.generations.delete(conversationId);
        const release = (async () => {
            await this.waitForPendingPersistence(conversationId);
            clearState();
        })();
        this.releases.set(conversationId, release);
        void release.then(
            () => this.deleteSettledRelease(conversationId, release),
            () => this.deleteSettledRelease(conversationId, release),
        );
        return release;
    }

    getSnapshot(conversationId: string): ConversationLifecycleSnapshot {
        return {
            activeGeneration: this.generations.has(conversationId),
            pendingPersistenceLaneCount: this.getPendingWrites(conversationId).length,
            releasing: this.releases.has(conversationId),
        };
    }

    private getPendingWrites(conversationId: string): Promise<void>[] {
        return CONVERSATION_PERSISTENCE_LANES
            .map((lane) => this.writeChains.get(lane)!.get(conversationId))
            .filter((write): write is Promise<void> => Boolean(write));
    }

    private deleteSettledChain(
        chains: Map<string, Promise<void>>,
        conversationId: string,
        settled: Promise<void>,
    ): void {
        if (chains.get(conversationId) === settled) {
            chains.delete(conversationId);
        }
    }

    private deleteSettledRelease(conversationId: string, settled: Promise<void>): void {
        if (this.releases.get(conversationId) === settled) {
            this.releases.delete(conversationId);
        }
    }
}
