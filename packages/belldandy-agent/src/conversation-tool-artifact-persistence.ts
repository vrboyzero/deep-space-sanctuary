import * as fsp from "node:fs/promises";

export type ConversationMetaAsyncFs = {
    writeFile(filePath: string, data: string, encoding: BufferEncoding): Promise<void>;
    rename(sourcePath: string, destinationPath: string): Promise<void>;
    unlink(filePath: string): Promise<void>;
};

export type ConversationMetaWriteRequest = {
    conversationId: string;
    filePath: string;
    data: string;
};

export const conversationMetaAsyncFs: ConversationMetaAsyncFs = {
    writeFile(filePath, data, encoding) {
        return fsp.writeFile(filePath, data, encoding);
    },
    rename(sourcePath, destinationPath) {
        return fsp.rename(sourcePath, destinationPath);
    },
    unlink(filePath) {
        return fsp.unlink(filePath);
    },
};

let tempFileCounter = 0;

function createTempPath(filePath: string): string {
    tempFileCounter += 1;
    return `${filePath}.${process.pid}.${Date.now()}.${tempFileCounter.toString(36)}.tmp`;
}

/**
 * Tool artifact meta 使用最新快照合并写；实际串行和 lifecycle fence 由注入的 lane owner 提供。
 */
export class ConversationToolArtifactMetaPersistence {
    private readonly latestWrites = new Map<string, ConversationMetaWriteRequest>();
    private readonly activeWrites = new Map<string, Promise<void>>();
    private readonly asyncFs: ConversationMetaAsyncFs;
    private readonly enqueue: (conversationId: string, task: () => Promise<void>) => Promise<void>;
    private readonly onError: (conversationId: string, error: unknown) => void;

    constructor(options: {
        asyncFs?: ConversationMetaAsyncFs;
        enqueue: (conversationId: string, task: () => Promise<void>) => Promise<void>;
        onError?: (conversationId: string, error: unknown) => void;
    }) {
        this.asyncFs = options.asyncFs ?? conversationMetaAsyncFs;
        this.enqueue = options.enqueue;
        this.onError = options.onError ?? (() => undefined);
    }

    schedule(request: ConversationMetaWriteRequest): void {
        this.latestWrites.set(request.conversationId, request);
        if (this.activeWrites.has(request.conversationId)) return;

        const active = this.enqueue(request.conversationId, () => this.drain(request.conversationId));
        this.activeWrites.set(request.conversationId, active);
        void active.then(
            () => this.finish(request.conversationId, active),
            () => this.finish(request.conversationId, active),
        );
    }

    hasPending(conversationId: string): boolean {
        return this.activeWrites.has(conversationId) || this.latestWrites.has(conversationId);
    }

    private async drain(conversationId: string): Promise<void> {
        while (true) {
            const request = this.latestWrites.get(conversationId);
            if (!request) return;
            this.latestWrites.delete(conversationId);
            await this.writeAtomic(request);
        }
    }

    private async writeAtomic(request: ConversationMetaWriteRequest): Promise<void> {
        const tempPath = createTempPath(request.filePath);
        try {
            await this.asyncFs.writeFile(tempPath, request.data, "utf-8");
            await this.asyncFs.rename(tempPath, request.filePath);
        } catch (error) {
            try {
                await this.asyncFs.unlink(tempPath);
            } catch (cleanupError) {
                const fsError = cleanupError as NodeJS.ErrnoException;
                if (fsError.code !== "ENOENT") {
                    // 原始写错误是本操作的 canonical failure；清理失败不覆盖它。
                }
            }
            this.onError(request.conversationId, error);
        }
    }

    private finish(conversationId: string, settled: Promise<void>): void {
        if (this.activeWrites.get(conversationId) !== settled) return;
        this.activeWrites.delete(conversationId);
        if (this.latestWrites.has(conversationId)) {
            const latest = this.latestWrites.get(conversationId)!;
            this.schedule(latest);
        }
    }
}
