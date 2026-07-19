import { raceWithAbort, throwIfAborted } from "../../abort-utils.js";

export interface BoundedJsonResponseOptions {
    response: Pick<Response, "body" | "headers">;
    maxBytes: number;
    responseLabel: string;
    abortSignal?: AbortSignal;
}

/**
 * 对 provider JSON 正文同时执行声明长度和实际累计字节限额，避免 `response.json()`
 * 在校验前无界聚合；任何中断路径都主动取消 reader。
 */
export async function readBoundedJsonResponse(options: BoundedJsonResponseOptions): Promise<unknown> {
    const { response, maxBytes, responseLabel, abortSignal } = options;
    const body = response.body;
    if (!body) throw new Error(`${responseLabel} has no readable body`);

    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null) {
        if (!/^\d+$/u.test(declaredLength.trim())) {
            await cancelResponseBody(response);
            throw new Error(`${responseLabel} has invalid Content-Length`);
        }
        if (Number(declaredLength) > maxBytes) {
            await cancelResponseBody(response);
            throw new Error(`${responseLabel} exceeds ${maxBytes} byte limit`);
        }
    }

    const reader = body.getReader();
    const chunks: Buffer[] = [];
    let byteLength = 0;
    let completed = false;
    try {
        while (true) {
            throwIfAborted(abortSignal);
            const next = await raceWithAbort(reader.read(), abortSignal);
            if (next.done) {
                completed = true;
                break;
            }
            const chunk = Buffer.from(next.value.buffer, next.value.byteOffset, next.value.byteLength);
            byteLength += chunk.length;
            if (byteLength > maxBytes) {
                throw new Error(`${responseLabel} exceeds ${maxBytes} byte limit`);
            }
            chunks.push(chunk);
        }
    } catch (error) {
        if (!completed) {
            await reader.cancel(error).catch(() => undefined);
        }
        throw error;
    } finally {
        reader.releaseLock();
    }

    throwIfAborted(abortSignal);
    return JSON.parse(Buffer.concat(chunks, byteLength).toString("utf8"));
}

export async function cancelResponseBody(response: Pick<Response, "body">): Promise<void> {
    try {
        await response.body?.cancel();
    } catch {
        // 正文已决定不再消费，取消失败不得覆盖原始状态或字节限额错误。
    }
}
