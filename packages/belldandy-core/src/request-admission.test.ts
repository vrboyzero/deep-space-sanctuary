import { describe, expect, it } from "vitest";

import {
  admitGatewayRequest,
  getPairedGatewayCapabilities,
} from "./request-admission.js";
import { getGatewayMethodPolicy } from "./gateway-method-registry.js";

describe("RequestAdmission", () => {
  it("在业务分发前拒绝未知方法", () => {
    expect(admitGatewayRequest({
      method: "gateway.unknown",
      identity: {
        subjectId: "client-a",
        role: "web",
        authenticated: true,
        paired: true,
        capabilities: getPairedGatewayCapabilities(),
      },
    })).toMatchObject({
      allowed: false,
      error: { code: "unknown_method" },
    });
  });

  it("拒绝未配对客户端的高风险写方法", () => {
    expect(admitGatewayRequest({
      method: "goal.delete",
      identity: {
        subjectId: "client-a",
        role: "web",
        authenticated: true,
        paired: false,
        capabilities: [],
      },
    })).toMatchObject({
      allowed: false,
      error: { code: "pairing_required" },
    });
  });

  it("允许已配对客户端调用与其能力匹配的方法", () => {
    expect(admitGatewayRequest({
      method: "workflow.run",
      identity: {
        subjectId: "client-a",
        role: "web",
        authenticated: true,
        paired: true,
        capabilities: getPairedGatewayCapabilities(),
      },
    })).toEqual({ allowed: true });
  });

  it("保留无副作用 discovery/read 方法的未配对兼容入口", () => {
    for (const method of ["models.list", "agents.list", "agents.roster.get", "tools.list"]) {
      expect(admitGatewayRequest({
        method,
        identity: {
          subjectId: "client-a",
          role: "web",
          authenticated: true,
          paired: false,
          capabilities: [],
        },
      })).toEqual({ allowed: true });
    }
  });

  it("为 workflow 和删除操作固定高风险分类", () => {
    expect(getGatewayMethodPolicy("workflow.run")).toMatchObject({
      risk: "code-execution",
      requiresPairing: true,
      requiredCapability: "workflow.execute",
    });
    expect(getGatewayMethodPolicy("goal.delete")).toMatchObject({
      risk: "admin",
      requiresPairing: true,
      requiredCapability: "gateway.admin",
    });
  });
});
