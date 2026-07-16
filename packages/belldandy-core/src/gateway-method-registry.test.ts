import fs from "node:fs";

import { describe, expect, it } from "vitest";

import {
  getAdvertisedGatewayMethods,
  getGatewayMethodRegistryInventory,
  validateGatewayMethodRegistry,
} from "./gateway-method-registry.js";

describe("GatewayMethodRegistry", () => {
  it("公开目录、授权策略与风险分类共享同一方法来源", () => {
    const inventory = getGatewayMethodRegistryInventory();
    const advertised = getAdvertisedGatewayMethods();

    expect(validateGatewayMethodRegistry()).toEqual([]);
    expect(advertised).toEqual(inventory.map((item) => item.method));
    expect(inventory.find((item) => item.method === "goal.delete")).toMatchObject({
      requiresPairing: true,
      risk: "admin",
    });
    expect(inventory.find((item) => item.method === "workflow.run")).toMatchObject({
      requiresPairing: true,
      risk: "code-execution",
    });
  });

  it("不会把可分发但未在旧目录列出的写方法遗漏为公开未授权能力", () => {
    const methods = getAdvertisedGatewayMethods();
    expect(methods).toEqual(expect.arrayContaining([
      "agent.create",
      "agent.session.ensure",
      "goal.archive",
      "goal.delete",
      "goal.task_graph.create",
      "memory.share.queue",
      "workflow.run",
    ]));
  });

  it("实际 Gateway 分发与 registry 保持一一对应", () => {
    const serverSource = fs.readFileSync(new URL("./server.ts", import.meta.url), "utf-8");
    const dispatchedMethods = [...serverSource.matchAll(/case "([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)"/g)]
      .map((match) => match[1])
      .sort();
    const registeredMethods = getGatewayMethodRegistryInventory()
      .map((entry) => entry.method)
      .sort();

    expect(dispatchedMethods).toEqual(registeredMethods);
  });
});
