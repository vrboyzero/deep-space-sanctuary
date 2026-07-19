import { describe, expect, it, vi } from "vitest";

import { createExperienceWorkbenchSkillFreshnessFeature } from "./experience-workbench-skill-freshness.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createFixture(options = {}) {
  let pendingActionKey = options.initialPendingActionKey || "";
  let generation = 0;
  let ownerCurrent = true;
  const events = [];
  const requestUpdate = vi.fn(options.requestUpdate || (() => Promise.resolve({ ok: true, payload: { stale: true } })));
  const loadCandidateDetail = vi.fn(options.loadCandidateDetail || (async (candidateId) => {
    events.push(`load:${candidateId}`);
  }));
  const renderSelectedCandidate = vi.fn(() => {
    events.push("render");
  });
  const notifyDisconnected = vi.fn(() => {
    events.push("disconnected");
  });
  const notifyFailure = vi.fn((message) => {
    events.push(`failure:${message}`);
  });
  const notifySuccess = vi.fn(() => {
    events.push("success");
  });
  const syncPendingUi = vi.fn(() => {
    events.push(`pending:${pendingActionKey || "none"}`);
  });
  const feature = createExperienceWorkbenchSkillFreshnessFeature({
    getGeneration: () => generation,
    getPendingActionKey: () => pendingActionKey,
    isConnected: () => options.connected !== false,
    isOwnerCurrent: (expectedGeneration) => ownerCurrent && expectedGeneration === generation,
    loadCandidateDetail,
    notifyDisconnected,
    notifyFailure,
    notifySuccess,
    renderSelectedCandidate,
    requestUpdate,
    setPendingActionKey: (nextKey) => {
      pendingActionKey = nextKey || "";
    },
    syncPendingUi,
  });

  return {
    events,
    feature,
    loadCandidateDetail,
    notifyDisconnected,
    notifyFailure,
    notifySuccess,
    renderSelectedCandidate,
    requestUpdate,
    setOwnerCurrent: (next) => {
      ownerCurrent = next;
    },
  };
}

describe("experience workbench skill freshness lifecycle", () => {
  it("reports an active failure, releases its UI pending key, and reloads candidate detail", async () => {
    const fixture = createFixture({
      requestUpdate: () => Promise.resolve({ ok: false, error: { message: "Update unavailable" } }),
    });

    await fixture.feature.updateSkillFreshnessStaleMark({
      sourceCandidateId: " source-1 ",
      skillKey: " skill-a ",
      candidateId: " candidate-1 ",
    });

    expect(fixture.feature.getPendingCount()).toBe(0);
    expect(fixture.requestUpdate).toHaveBeenCalledWith({
      sourceCandidateId: "source-1",
      skillKey: "skill-a",
      stale: true,
    });
    expect(fixture.events).toEqual([
      "pending:skill-freshness:source-1:stale",
      "failure:Update unavailable",
      "pending:none",
      "load:candidate-1",
    ]);
  });

  it("settles an active request rejection and preserves the detail refresh path", async () => {
    const fixture = createFixture({
      requestUpdate: () => Promise.reject(new Error("Freshness transport failed")),
    });

    await fixture.feature.updateSkillFreshnessStaleMark({
      skillKey: "skill-a",
      candidateId: "candidate-1",
    });

    expect(fixture.feature.getPendingCount()).toBe(0);
    expect(fixture.events).toEqual([
      "pending:skill-freshness:skill-a:stale",
      "failure:Freshness transport failed",
      "pending:none",
      "load:candidate-1",
    ]);
  });

  it("applies an active update and redraws the selected candidate when no detail id is present", async () => {
    const fixture = createFixture();

    const payload = await fixture.feature.updateSkillFreshnessStaleMark({
      skillKey: " skill-a ",
      stale: false,
    });

    expect(payload).toEqual({ stale: true });
    expect(fixture.requestUpdate).toHaveBeenCalledWith({
      sourceCandidateId: "",
      skillKey: "skill-a",
      stale: false,
    });
    expect(fixture.events).toEqual([
      "pending:skill-freshness:skill-a:active",
      "success",
      "pending:none",
      "render",
    ]);
  });

  it("keeps the physical token until a stale update response settles", async () => {
    const deferred = createDeferred();
    const fixture = createFixture({ requestUpdate: () => deferred.promise });

    const update = fixture.feature.updateSkillFreshnessStaleMark({
      sourceCandidateId: "source-1",
      candidateId: "candidate-1",
    });
    expect(fixture.feature.getPendingCount()).toBe(1);
    fixture.setOwnerCurrent(false);
    deferred.resolve({ ok: true, payload: { stale: true } });
    await update;

    expect(fixture.feature.getPendingCount()).toBe(0);
    expect(fixture.notifySuccess).not.toHaveBeenCalled();
    expect(fixture.loadCandidateDetail).not.toHaveBeenCalled();
    expect(fixture.renderSelectedCandidate).not.toHaveBeenCalled();
    expect(fixture.events).toEqual(["pending:skill-freshness:source-1:stale"]);
  });

  it("keeps the physical token through detail reload and settles after owner loss", async () => {
    const reloadDeferred = createDeferred();
    const fixture = createFixture({
      loadCandidateDetail: (candidateId) => {
        fixture.events.push(`load:${candidateId}`);
        return reloadDeferred.promise;
      },
    });

    const update = fixture.feature.updateSkillFreshnessStaleMark({
      sourceCandidateId: "source-1",
      candidateId: "candidate-1",
    });
    await vi.waitFor(() => {
      expect(fixture.loadCandidateDetail).toHaveBeenCalledWith("candidate-1");
    });
    expect(fixture.feature.getPendingCount()).toBe(1);

    fixture.setOwnerCurrent(false);
    reloadDeferred.resolve();
    await update;

    expect(fixture.feature.getPendingCount()).toBe(0);
    expect(fixture.events).toEqual([
      "pending:skill-freshness:source-1:stale",
      "success",
      "pending:none",
      "load:candidate-1",
    ]);
  });

  it("does not request an update while disconnected or another action owns the UI", async () => {
    const disconnected = createFixture({ connected: false });
    const busy = createFixture({ initialPendingActionKey: "review:candidate-1" });

    await disconnected.feature.updateSkillFreshnessStaleMark({ skillKey: "skill-a" });
    await busy.feature.updateSkillFreshnessStaleMark({ skillKey: "skill-a" });

    expect(disconnected.requestUpdate).not.toHaveBeenCalled();
    expect(disconnected.notifyDisconnected).toHaveBeenCalledTimes(1);
    expect(busy.requestUpdate).not.toHaveBeenCalled();
    expect(busy.events).toEqual([]);
  });
});
