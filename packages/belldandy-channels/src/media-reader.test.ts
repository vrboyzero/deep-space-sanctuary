import { expect, test, vi } from "vitest";

import { readBoundedMediaBuffer } from "./media-reader.js";

test("rejects an oversized Content-Length before consuming a media response body", async () => {
  const readBody = vi.fn(async () => new ArrayBuffer(0));
  const fetchImpl = vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ "content-length": "9" }),
    body: null,
    arrayBuffer: readBody,
  } as unknown as Response));

  await expect(readBoundedMediaBuffer({
    url: "https://multimedia.nt.qq.com.cn/download?id=test",
    label: "QQ voice attachment",
    timeoutMs: 1_000,
    maxBytes: 8,
    fetchImpl,
  })).rejects.toThrow(/exceeds the 8 byte limit/i);
  expect(readBody).not.toHaveBeenCalled();
});

test("aborts a chunked response once the cumulative media byte limit is exceeded", async () => {
  const read = vi.fn()
    .mockResolvedValueOnce({ done: false, value: Uint8Array.from([1, 2, 3, 4]) })
    .mockResolvedValueOnce({ done: false, value: Uint8Array.from([5, 6, 7, 8, 9]) });
  const cancel = vi.fn(async () => undefined);
  const fetchImpl = vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    body: {
      getReader: () => ({ read, cancel, releaseLock: vi.fn() }),
    },
  } as unknown as Response));

  await expect(readBoundedMediaBuffer({
    url: "https://multimedia.nt.qq.com.cn/download?id=test",
    label: "QQ voice attachment",
    timeoutMs: 1_000,
    maxBytes: 8,
    fetchImpl,
  })).rejects.toThrow(/exceeds the 8 byte limit/i);
  expect(cancel).toHaveBeenCalled();
});

test("returns a bounded buffer for a normal streaming media response", async () => {
  const read = vi.fn()
    .mockResolvedValueOnce({ done: false, value: Uint8Array.from([1, 2]) })
    .mockResolvedValueOnce({ done: false, value: Uint8Array.from([3, 4]) })
    .mockResolvedValueOnce({ done: true, value: undefined });
  const fetchImpl = vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ "content-length": "4" }),
    body: {
      getReader: () => ({ read, cancel: vi.fn(), releaseLock: vi.fn() }),
    },
  } as unknown as Response));

  await expect(readBoundedMediaBuffer({
    url: "https://multimedia.nt.qq.com.cn/download?id=test",
    label: "QQ voice attachment",
    timeoutMs: 1_000,
    maxBytes: 8,
    fetchImpl,
  })).resolves.toEqual(Buffer.from([1, 2, 3, 4]));
});
