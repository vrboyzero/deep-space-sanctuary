import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { PROFILE_STATE_SCHEMA_VERSION } from "./profile-state-types.js";
import { MemoryStore } from "./store.js";

describe("profile state store", () => {
  let rootDir: string;
  let dbPath: string;
  let store: MemoryStore;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "belldandy-profile-state-"));
    dbPath = path.join(rootDir, "memory.db");
    store = new MemoryStore(dbPath);
  });

  afterEach(async () => {
    store.close();
    await fs.rm(rootDir, { recursive: true, force: true }).catch(() => {});
  });

  it("upserts profile state entries and records change history", () => {
    expect(store.getMeta("profile_state_schema_version")).toBe(PROFILE_STATE_SCHEMA_VERSION);

    const created = store.upsertProfileStateEntry({
      agentId: "default",
      scope: "user",
      path: "identity.name",
      value: "小星",
      confidence: 0.92,
      createdBy: "test",
      reason: "seed",
    });

    expect(created).toMatchObject({
      agentId: "default",
      scope: "user",
      path: "identity.name",
      value: "小星",
      status: "active",
    });
    expect(store.getMemoryChangeSeq()).toBe(1);

    const updated = store.upsertProfileStateEntry({
      agentId: "default",
      scope: "user",
      path: "identity.name",
      value: "小星星",
      confidence: 0.98,
      sourceRefs: [{
        kind: "manual",
        note: "rename",
      }],
      createdBy: "test",
      reason: "rename",
    });

    expect(updated.id).toBe(created.id);
    expect(updated.value).toBe("小星星");
    expect(updated.confidence).toBe(0.98);
    expect(updated.sourceRefs).toEqual([{
      kind: "manual",
      note: "rename",
      id: undefined,
      sourcePath: undefined,
      excerpt: undefined,
    }]);
    expect(store.getMemoryChangeSeq()).toBe(2);

    const fetched = store.getProfileStateEntry("identity.name", {
      agentId: "default",
      scope: "user",
    });
    expect(fetched).toMatchObject({
      id: created.id,
      value: "小星星",
    });

    const events = store.listProfileStateEvents(10, {
      entryId: created.id,
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      action: "update",
      oldValue: "小星",
      newValue: "小星星",
      createdBy: "test",
      reason: "rename",
    });
    expect(events[1]).toMatchObject({
      action: "create",
      oldValue: null,
      newValue: "小星",
      createdBy: "test",
      reason: "seed",
    });
  });

  it("soft deletes profile state entries without dropping audit history", () => {
    const created = store.upsertProfileStateEntry({
      agentId: "default",
      scope: "user",
      path: "preferences.response_style",
      value: "先结论，后证据",
      createdBy: "test",
    });

    const deleted = store.deleteProfileStateEntry("preferences.response_style", {
      agentId: "default",
      scope: "user",
      createdBy: "test",
      reason: "withdrawn",
    });

    expect(deleted).toMatchObject({
      id: created.id,
      status: "deleted",
    });
    expect(store.getMemoryChangeSeq()).toBe(2);
    expect(store.getProfileStateEntry("preferences.response_style", {
      agentId: "default",
      scope: "user",
    })).toBeNull();
    expect(store.getProfileStateEntry("preferences.response_style", {
      agentId: "default",
      scope: "user",
      status: "deleted",
    })).toMatchObject({
      id: created.id,
      status: "deleted",
      value: "先结论，后证据",
    });

    const events = store.listProfileStateEvents(10, {
      entryId: created.id,
    });
    expect(events[0]).toMatchObject({
      action: "delete",
      oldValue: "先结论，后证据",
      newValue: null,
      reason: "withdrawn",
    });
  });
});
