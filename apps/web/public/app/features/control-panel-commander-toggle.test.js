// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createControlPanelCommanderToggleController } from "./control-panel-commander-toggle.js";

function createTranslator() {
  return (_key, _params, fallback) => fallback ?? "";
}

function flushTasks() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function createRefs() {
  document.body.innerHTML = `
    <div class="control-panel-commander-card">
      <label for="commanderQuickToggle">
        <input id="commanderQuickToggle" type="checkbox" />
      </label>
      <span id="commanderQuickToggleState"></span>
    </div>
  `;
  const cfgCommanderMode = document.createElement("select");
  cfgCommanderMode.innerHTML = '<option value="auto">auto</option><option value="off">off</option><option value="on">on</option>';
  const cfgGoalExecutionMode = document.createElement("select");
  cfgGoalExecutionMode.innerHTML = '<option value="auto">auto</option><option value="single_agent">single_agent</option><option value="multi_agent_parallel">multi_agent_parallel</option>';
  const cfgGoalGovernanceMode = document.createElement("select");
  cfgGoalGovernanceMode.innerHTML = '<option value="auto">auto</option><option value="direct">direct</option><option value="commander">commander</option>';
  return {
    commanderQuickToggleEl: document.getElementById("commanderQuickToggle"),
    commanderQuickToggleStateEl: document.getElementById("commanderQuickToggleState"),
    cfgCommanderMode,
    cfgGoalExecutionMode,
    cfgGoalGovernanceMode,
  };
}

describe("control panel commander toggle controller", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("syncs the quick toggle from an active commander preset", async () => {
    const refs = createRefs();
    const controller = createControlPanelCommanderToggleController({
      refs,
      isConnected: () => true,
      sendReq: vi.fn(),
      makeId: () => "req-1",
      loadServerConfig: vi.fn(),
      invalidateServerConfigCache: vi.fn(),
      showNotice: vi.fn(),
      t: createTranslator(),
    });

    await controller.syncFromConfig({
      BELLDANDY_COMMANDER_MODE: "on",
      BELLDANDY_GOAL_EXECUTION_MODE: "multi_agent_parallel",
      BELLDANDY_GOAL_GOVERNANCE_MODE: "commander",
    });

    expect(refs.commanderQuickToggleEl.checked).toBe(true);
    expect(refs.commanderQuickToggleStateEl.textContent).toBe("On");
    expect(refs.cfgCommanderMode.value).toBe("on");
    expect(refs.cfgGoalExecutionMode.value).toBe("multi_agent_parallel");
    expect(refs.cfgGoalGovernanceMode.value).toBe("commander");
  });

  it("enables commander preset and caches the previous non-commander settings", async () => {
    const refs = createRefs();
    const sendReq = vi.fn().mockResolvedValue({ ok: true, payload: { restartRequired: false } });
    const invalidateServerConfigCache = vi.fn();
    const showNotice = vi.fn();
    createControlPanelCommanderToggleController({
      refs,
      isConnected: () => true,
      sendReq,
      makeId: () => "req-enable",
      loadServerConfig: vi.fn().mockResolvedValue({
        BELLDANDY_COMMANDER_MODE: "off",
        BELLDANDY_GOAL_EXECUTION_MODE: "single_agent",
        BELLDANDY_GOAL_GOVERNANCE_MODE: "direct",
      }),
      invalidateServerConfigCache,
      showNotice,
      t: createTranslator(),
    });

    refs.commanderQuickToggleEl.click();
    await flushTasks();

    expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({
      method: "config.update",
      params: {
        updates: {
          BELLDANDY_COMMANDER_MODE: "on",
          BELLDANDY_GOAL_EXECUTION_MODE: "multi_agent_parallel",
          BELLDANDY_GOAL_GOVERNANCE_MODE: "commander",
        },
      },
    }));
    expect(invalidateServerConfigCache).toHaveBeenCalledTimes(1);
    expect(JSON.parse(window.localStorage.getItem("ss-webchat-commander-restore-v1"))).toEqual({
      BELLDANDY_COMMANDER_MODE: "off",
      BELLDANDY_GOAL_EXECUTION_MODE: "single_agent",
      BELLDANDY_GOAL_GOVERNANCE_MODE: "direct",
    });
    expect(refs.cfgCommanderMode.value).toBe("on");
    expect(refs.cfgGoalExecutionMode.value).toBe("multi_agent_parallel");
    expect(refs.cfgGoalGovernanceMode.value).toBe("commander");
    expect(showNotice).toHaveBeenCalledWith(
      "Commander mode updated",
      "Commander governance preset is enabled. New long-running tasks will default to parallel specialists, and no restart is required.",
      "success",
      4200,
    );
  });

  it("restores the cached non-commander settings when the toggle is turned off", async () => {
    const refs = createRefs();
    window.localStorage.setItem("ss-webchat-commander-restore-v1", JSON.stringify({
      BELLDANDY_COMMANDER_MODE: "off",
      BELLDANDY_GOAL_EXECUTION_MODE: "single_agent",
      BELLDANDY_GOAL_GOVERNANCE_MODE: "direct",
    }));
    const sendReq = vi.fn().mockResolvedValue({ ok: true, payload: { restartRequired: false } });
    const controller = createControlPanelCommanderToggleController({
      refs,
      isConnected: () => true,
      sendReq,
      makeId: () => "req-disable",
      loadServerConfig: vi.fn().mockResolvedValue({
        BELLDANDY_COMMANDER_MODE: "on",
        BELLDANDY_GOAL_EXECUTION_MODE: "multi_agent_parallel",
        BELLDANDY_GOAL_GOVERNANCE_MODE: "commander",
      }),
      invalidateServerConfigCache: vi.fn(),
      showNotice: vi.fn(),
      t: createTranslator(),
    });

    await controller.syncFromConfig({
      BELLDANDY_COMMANDER_MODE: "on",
      BELLDANDY_GOAL_EXECUTION_MODE: "multi_agent_parallel",
      BELLDANDY_GOAL_GOVERNANCE_MODE: "commander",
    });
    refs.commanderQuickToggleEl.click();
    await flushTasks();

    expect(sendReq).toHaveBeenCalledWith(expect.objectContaining({
      method: "config.update",
      params: {
        updates: {
          BELLDANDY_COMMANDER_MODE: "off",
          BELLDANDY_GOAL_EXECUTION_MODE: "single_agent",
          BELLDANDY_GOAL_GOVERNANCE_MODE: "direct",
        },
      },
    }));
    expect(window.localStorage.getItem("ss-webchat-commander-restore-v1")).toBeNull();
    expect(refs.commanderQuickToggleEl.checked).toBe(false);
    expect(refs.cfgCommanderMode.value).toBe("off");
    expect(refs.cfgGoalExecutionMode.value).toBe("single_agent");
    expect(refs.cfgGoalGovernanceMode.value).toBe("direct");
  });
});
