const TOOL_SECTION_BEGIN = "<|tool_calls_section_begin|>";
const TOOL_SECTION_END = "<|tool_calls_section_end|>";
const TOOL_CALL_BEGIN = "<|tool_call_begin|>";
const TOOL_CALL_END = "<|tool_call_end|>";

export const DEFAULT_MODEL_STREAM_DELIVERY_FLUSH_INTERVAL_MS = 16;
export const DEFAULT_MODEL_STREAM_DELIVERY_MAX_BATCH_CHARS = 96;

export type ModelStreamTextDelivery = {
  readonly deltas: AsyncIterable<string>;
  beginAttempt: () => void;
  push: (delta: string) => Promise<boolean>;
  getText: () => string;
  complete: () => Promise<void>;
  interrupt: () => Promise<void>;
  abort: () => Promise<void>;
};

export function createModelStreamTextDelivery(options: {
  flushIntervalMs?: number;
  maxBatchChars?: number;
} = {}): ModelStreamTextDelivery {
  const flushIntervalMs = normalizePositiveInt(
    options.flushIntervalMs,
    DEFAULT_MODEL_STREAM_DELIVERY_FLUSH_INTERVAL_MS,
  );
  const maxBatchChars = normalizePositiveInt(
    options.maxBatchChars,
    DEFAULT_MODEL_STREAM_DELIVERY_MAX_BATCH_CHARS,
  );
  const queue = new SingleSlotAsyncTextQueue();
  const filter = new ToolProtocolTextFilter();
  let published = false;
  let visibleText = "";
  let pending = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flushPromise: Promise<void> | undefined;
  let closed = false;

  const clearFlushTimer = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };

  const flush = async (): Promise<void> => {
    clearFlushTimer();
    if (flushPromise) {
      await flushPromise;
      if (pending) await flush();
      return;
    }
    if (!pending || closed) return;
    const batch = pending;
    pending = "";
    const currentFlush = queue.push(batch);
    flushPromise = currentFlush;
    try {
      await currentFlush;
    } finally {
      if (flushPromise === currentFlush) flushPromise = undefined;
    }
  };

  const scheduleFlush = () => {
    if (timer || closed) return;
    timer = setTimeout(() => {
      timer = undefined;
      void flush();
    }, flushIntervalMs);
  };

  return {
    deltas: queue,
    beginAttempt() {
      if (published || pending || flushPromise) return;
      filter.reset();
    },
    async push(delta) {
      if (closed) return false;
      const safeText = filter.push(delta);
      if (!safeText) return false;
      visibleText += safeText;

      if (!published) {
        published = true;
        await queue.push(safeText);
        return true;
      }

      pending += safeText;
      if (pending.length >= maxBatchChars) await flush();
      else scheduleFlush();
      return true;
    },
    getText() {
      return visibleText;
    },
    async complete() {
      if (closed) return;
      const tail = filter.complete();
      if (tail) {
        visibleText += tail;
        if (!published) {
          published = true;
          await queue.push(tail);
        } else {
          pending += tail;
        }
      }
      await flush();
      closed = true;
      queue.close();
    },
    async interrupt() {
      if (closed) return;
      filter.discard();
      await flush();
      closed = true;
      queue.close();
    },
    async abort() {
      if (closed) return;
      clearFlushTimer();
      filter.discard();
      pending = "";
      if (flushPromise) await flushPromise;
      closed = true;
      queue.close();
    },
  };
}

class ToolProtocolTextFilter {
  private mode: "visible" | "tool_section" | "tool_call" = "visible";
  private pending = "";

  push(delta: string): string {
    if (!delta) return "";
    this.pending += delta;
    let output = "";

    while (this.pending) {
      if (this.mode === "visible") {
        const match = findFirstMarker(this.pending, [TOOL_SECTION_BEGIN, TOOL_CALL_BEGIN]);
        if (match) {
          output += this.pending.slice(0, match.index);
          this.pending = this.pending.slice(match.index + match.marker.length);
          this.mode = match.marker === TOOL_SECTION_BEGIN ? "tool_section" : "tool_call";
          continue;
        }
        const retainedChars = longestMarkerPrefixSuffix(
          this.pending,
          [TOOL_SECTION_BEGIN, TOOL_CALL_BEGIN],
        );
        output += this.pending.slice(0, this.pending.length - retainedChars);
        this.pending = this.pending.slice(this.pending.length - retainedChars);
        break;
      }

      const endMarker = this.mode === "tool_section" ? TOOL_SECTION_END : TOOL_CALL_END;
      const endIndex = this.pending.indexOf(endMarker);
      if (endIndex >= 0) {
        this.pending = this.pending.slice(endIndex + endMarker.length);
        this.mode = "visible";
        continue;
      }
      const retainedChars = longestMarkerPrefixSuffix(this.pending, [endMarker]);
      this.pending = this.pending.slice(this.pending.length - retainedChars);
      break;
    }

    return output;
  }

  complete(): string {
    const tail = this.mode === "visible" ? this.pending : "";
    this.reset();
    return tail;
  }

  discard(): void {
    this.reset();
  }

  reset(): void {
    this.mode = "visible";
    this.pending = "";
  }
}

class SingleSlotAsyncTextQueue implements AsyncIterable<string> {
  private slot: { value: string; consumed: () => void } | undefined;
  private consumer: ((result: IteratorResult<string>) => void) | undefined;
  private closed = false;

  async push(value: string): Promise<void> {
    if (!value || this.closed) return;
    if (this.consumer) {
      const resolve = this.consumer;
      this.consumer = undefined;
      resolve({ value, done: false });
      return;
    }
    await new Promise<void>((resolve) => {
      this.slot = { value, consumed: resolve };
    });
  }

  close(): void {
    this.closed = true;
    if (this.consumer) {
      const resolve = this.consumer;
      this.consumer = undefined;
      resolve({ value: undefined, done: true });
    }
    if (this.slot) {
      this.slot.consumed();
      this.slot = undefined;
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<string> {
    return {
      next: async () => {
        if (this.slot) {
          const slot = this.slot;
          this.slot = undefined;
          slot.consumed();
          return { value: slot.value, done: false };
        }
        if (this.closed) return { value: undefined, done: true };
        return await new Promise<IteratorResult<string>>((resolve) => {
          this.consumer = resolve;
        });
      },
      return: async () => {
        this.close();
        return { value: undefined, done: true };
      },
    };
  }
}

function findFirstMarker(
  value: string,
  markers: string[],
): { index: number; marker: string } | undefined {
  let result: { index: number; marker: string } | undefined;
  for (const marker of markers) {
    const index = value.indexOf(marker);
    if (index < 0) continue;
    if (!result || index < result.index) result = { index, marker };
  }
  return result;
}

function longestMarkerPrefixSuffix(value: string, markers: string[]): number {
  const maxLength = Math.min(value.length, Math.max(...markers.map((marker) => marker.length - 1)));
  for (let length = maxLength; length > 0; length--) {
    const suffix = value.slice(-length);
    if (markers.some((marker) => marker.startsWith(suffix))) return length;
  }
  return 0;
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}
