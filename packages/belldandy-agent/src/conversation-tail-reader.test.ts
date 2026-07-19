import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readBoundedTailLines } from "./conversation-tail-reader.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function writeFixture(contents: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-conversation-tail-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, "conversation.jsonl");
  await fs.writeFile(filePath, contents, "utf8");
  return filePath;
}

describe("readBoundedTailLines", () => {
  it("跨越小分块时仍返回最近的完整非空行", async () => {
    const filePath = await writeFixture("first\n\nsecond\nthird\n");

    const result = await readBoundedTailLines(filePath, {
      maxLines: 2,
      maxBytes: 64,
      chunkBytes: 3,
    });

    expect(result).toMatchObject({
      lines: ["second", "third"],
      truncated: false,
    });
  });

  it("字节预算只返回完整尾行，不把截断 JSONL 行交给调用方", async () => {
    const filePath = await writeFixture(`old\n${"x".repeat(256)}\nlast\n`);

    const result = await readBoundedTailLines(filePath, {
      maxLines: 1,
      maxBytes: 32,
      chunkBytes: 8,
    });

    expect(result).toMatchObject({
      lines: ["last"],
      truncated: false,
    });
    expect(result.bytesRead).toBeLessThanOrEqual(32);
  });

  it("预算耗尽且不存在完整行时返回截断诊断而非半行", async () => {
    const filePath = await writeFixture("x".repeat(256));

    const result = await readBoundedTailLines(filePath, {
      maxLines: 1,
      maxBytes: 32,
      chunkBytes: 8,
    });

    expect(result).toEqual({
      lines: [],
      bytesRead: 32,
      truncated: true,
    });
  });
});
