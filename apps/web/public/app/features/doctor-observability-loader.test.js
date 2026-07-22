import fs from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  buildLazyDoctorChatSummary,
  createDoctorObservabilityLoader,
} from "./doctor-observability-loader.js";

describe("Doctor observability lazy owner", () => {
  it("shares one deferred module load across chat summary and Settings cards", async () => {
    const buildDoctorChatSummary = vi.fn(() => ["doctor summary"]);
    const renderDoctorObservabilityCards = vi.fn();
    const disposeDoctorObservabilityCardRendering = vi.fn();
    const loadModule = vi.fn().mockResolvedValue({
      buildDoctorChatSummary,
      disposeDoctorObservabilityCardRendering,
      renderDoctorObservabilityCards,
    });
    const loader = createDoctorObservabilityLoader({ loadModule });

    expect(loadModule).not.toHaveBeenCalled();
    expect(loader.render({}, {}, vi.fn(), {})).toBe(false);
    expect(loader.dispose({})).toBe(false);

    const payload = { checks: [] };
    const t = vi.fn();
    const [lines] = await Promise.all([
      loader.buildChatSummary(payload, t),
      loader.load(),
    ]);
    expect(lines).toEqual(["doctor summary"]);
    expect(loadModule).toHaveBeenCalledTimes(1);
    expect(buildDoctorChatSummary).toHaveBeenCalledWith(payload, t);

    const container = {};
    const handlers = { onOpenContinuationAction: vi.fn() };
    expect(loader.render(container, payload, t, handlers)).toBe(true);
    expect(renderDoctorObservabilityCards).toHaveBeenCalledWith(container, payload, t, handlers);
    expect(loader.dispose(container)).toBe(true);
    expect(disposeDoctorObservabilityCardRendering).toHaveBeenCalledWith(container);
  });

  it("allows a retry after a failed dynamic import", async () => {
    const loadModule = vi.fn()
      .mockRejectedValueOnce(new Error("asset unavailable"))
      .mockResolvedValueOnce({
        buildDoctorChatSummary: vi.fn(() => []),
        disposeDoctorObservabilityCardRendering: vi.fn(),
        renderDoctorObservabilityCards: vi.fn(),
      });
    const loader = createDoctorObservabilityLoader({ loadModule });

    await expect(loader.load()).rejects.toThrow("asset unavailable");
    await expect(loader.load()).resolves.toBeUndefined();
    expect(loadModule).toHaveBeenCalledTimes(2);
  });

  it("returns a bounded chat fallback without exposing the load error", async () => {
    const loader = {
      buildChatSummary: vi.fn().mockRejectedValue(new Error("private asset path")),
    };

    await expect(buildLazyDoctorChatSummary({}, vi.fn(), { loader })).resolves.toEqual({
      ok: false,
      lines: [],
    });
  });

  it("keeps both startup consumers behind the shared lazy owner", () => {
    const appSource = fs.readFileSync(new URL("../../app.js", import.meta.url), "utf8");
    const settingsSource = fs.readFileSync(new URL("./settings.js", import.meta.url), "utf8");
    const from = "from ";

    expect(appSource).not.toContain(`${from}"./app/features/doctor-observability.js"`);
    expect(settingsSource).not.toContain(`${from}"./doctor-observability.js"`);
    expect(appSource).toContain(`${from}"./app/features/doctor-observability-loader.js"`);
    expect(settingsSource).toContain(`${from}"./doctor-observability-loader.js"`);
  });
});
