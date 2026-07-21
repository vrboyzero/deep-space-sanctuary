import { describe, expect, it } from "vitest";

import {
  decodeSubTaskPageCursor,
  paginateSubTaskRecords,
  SubTaskPageInputError,
} from "./subtask-runtime-pagination.js";

describe("paginateSubTaskRecords", () => {
  it("walks equal-timestamp records without duplicates or omissions", () => {
    const records = [
      { id: "task-a", createdAt: 200, content: "not-in-cursor-a" },
      { id: "task-c", createdAt: 200, content: "not-in-cursor-c" },
      { id: "task-b", createdAt: 200, content: "not-in-cursor-b" },
      { id: "task-old", createdAt: 100, content: "not-in-cursor-old" },
    ];

    const first = paginateSubTaskRecords(records, { limit: 2 });
    const second = paginateSubTaskRecords(records, {
      limit: 2,
      cursor: first.nextCursor,
    });

    expect(first.items.map((item) => item.id)).toEqual(["task-c", "task-b"]);
    expect(second.items.map((item) => item.id)).toEqual(["task-a", "task-old"]);
    expect(new Set([...first.items, ...second.items].map((item) => item.id))).toEqual(new Set(records.map((item) => item.id)));
    expect(first.hasMore).toBe(true);
    expect(second.hasMore).toBe(false);
    expect(second).not.toHaveProperty("nextCursor");
  });

  it("keeps cursor payload limited to version, timestamp, and task id", () => {
    const page = paginateSubTaskRecords([
      { id: "task-2", createdAt: 2, secret: "must-not-leak" },
      { id: "task-1", createdAt: 1, secret: "must-not-leak" },
    ], { limit: 1 });

    expect(decodeSubTaskPageCursor(String(page.nextCursor))).toEqual({
      createdAt: 2,
      taskId: "task-2",
    });
    const decodedText = Buffer.from(String(page.nextCursor), "base64url").toString("utf-8");
    expect(decodedText).not.toContain("must-not-leak");
  });

  it("rejects malformed cursors and out-of-range limits", () => {
    expect(() => paginateSubTaskRecords([], { cursor: "not-json" })).toThrow(SubTaskPageInputError);
    expect(() => paginateSubTaskRecords([], { limit: 0 })).toThrow("limit must be an integer between 1 and 200");
    expect(() => paginateSubTaskRecords([], { limit: 201 })).toThrow("limit must be an integer between 1 and 200");
  });
});
