export const DEFAULT_QQ_REST_JSON_MAX_BYTES = 256 * 1024;

export async function readBoundedQqRestJson(input: {
    response: Pick<Response, "body" | "headers">;
    abortSignal?: AbortSignal;
    maxBytes?: number;
}): Promise<unknown> {
    const maxBytes = normalizeByteLimit(input.maxBytes);
    const declaredLength = input.response.headers.get("content-length");
    if (declaredLength !== null) {
        if (!/^\d+$/u.test(declaredLength.trim())) {
            await cancelResponseBody(input.response);
            throw new Error("QQ REST JSON response has invalid Content-Length");
        }
        if (Number(declaredLength) > maxBytes) {
            await cancelResponseBody(input.response);
            throw new Error(`QQ REST JSON response exceeds ${maxBytes} byte limit`);
        }
    }

    const body = input.response.body;
    if (!body) throw new Error("QQ REST JSON response has no readable body");
    const reader = body.getReader();
    const chunks: Buffer[] = [];
    let byteLength = 0;
    let completed = false;
    try {
        while (true) {
            throwIfAborted(input.abortSignal);
            const next = await raceWithAbort(reader.read(), input.abortSignal);
            if (next.done) {
                completed = true;
                break;
            }
            const chunk = Buffer.from(next.value.buffer, next.value.byteOffset, next.value.byteLength);
            byteLength += chunk.length;
            if (byteLength > maxBytes) {
                throw new Error(`QQ REST JSON response exceeds ${maxBytes} byte limit`);
            }
            chunks.push(chunk);
        }
    } catch (error) {
        if (!completed) await reader.cancel(error).catch(() => undefined);
        throw error;
    } finally {
        reader.releaseLock();
    }

    throwIfAborted(input.abortSignal);
    return JSON.parse(Buffer.concat(chunks, byteLength).toString("utf8"));
}

function normalizeByteLimit(value: number | undefined): number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0
        ? Math.floor(value)
        : DEFAULT_QQ_REST_JSON_MAX_BYTES;
}

function throwIfAborted(signal?: AbortSignal): void {
    if (!signal?.aborted) return;
    if (signal.reason instanceof Error) throw signal.reason;
    const error = new Error("QQ REST JSON response read was aborted.");
    error.name = "AbortError";
    throw error;
}

async function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return await promise;
    throwIfAborted(signal);
    return await new Promise<T>((resolve, reject) => {
        const onAbort = () => {
            signal.removeEventListener("abort", onAbort);
            try {
                throwIfAborted(signal);
            } catch (error) {
                reject(error);
            }
        };
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then(
            (value) => {
                signal.removeEventListener("abort", onAbort);
                resolve(value);
            },
            (error) => {
                signal.removeEventListener("abort", onAbort);
                reject(error);
            },
        );
    });
}

async function cancelResponseBody(response: Pick<Response, "body">): Promise<void> {
    try {
        await response.body?.cancel();
    } catch {
        // 已决定拒绝正文，取消失败不得覆盖原始限界错误。
    }
}
