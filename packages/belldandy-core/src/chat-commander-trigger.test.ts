import { describe, expect, it } from "vitest";

import {
  detectChatCommanderTrigger,
  buildChatCommanderHintText,
} from "./chat-commander-trigger.js";

describe("detectChatCommanderTrigger", () => {
  describe("指挥模式触发关键词", () => {
    it("检测 '用指挥模式'", () => {
      const result = detectChatCommanderTrigger("请用指挥模式来处理这个任务");
      expect(result.triggered).toBe(true);
      expect(result.commanderTriggered).toBe(true);
      expect(result.workflowTriggered).toBe(false);
      expect(result.matchedPhrases).toContain("用指挥模式");
      expect(result.suggestedTools).toContain("delegate_task");
      expect(result.suggestedTools).toContain("delegate_parallel");
      expect(result.suggestedTools).not.toContain("run_workflow");
    });

    it("检测 '使用指挥模式'", () => {
      const result = detectChatCommanderTrigger("请使用指挥模式来处理这个任务");
      expect(result.triggered).toBe(true);
      expect(result.commanderTriggered).toBe(true);
      expect(result.workflowTriggered).toBe(false);
      expect(result.matchedPhrases).toContain("使用指挥模式");
    });

    it("检测 '进指挥模式'", () => {
      const result = detectChatCommanderTrigger("我们进指挥模式吧");
      expect(result.triggered).toBe(true);
      expect(result.commanderTriggered).toBe(true);
      expect(result.workflowTriggered).toBe(false);
    });

    it("检测 '成为指挥官'", () => {
      const result = detectChatCommanderTrigger("你成为指挥官来安排这个任务");
      expect(result.triggered).toBe(true);
      expect(result.commanderTriggered).toBe(true);
    });

    it("检测 'use commander mode'（大小写不敏感）", () => {
      const result = detectChatCommanderTrigger("Please use Commander Mode for this");
      expect(result.triggered).toBe(true);
      expect(result.commanderTriggered).toBe(true);
      expect(result.workflowTriggered).toBe(false);
    });

    it("检测 'enter commander mode'", () => {
      const result = detectChatCommanderTrigger("Let's enter commander mode");
      expect(result.triggered).toBe(true);
      expect(result.commanderTriggered).toBe(true);
    });

    it("检测 'become commander'", () => {
      const result = detectChatCommanderTrigger("You should become commander for this task");
      expect(result.triggered).toBe(true);
      expect(result.commanderTriggered).toBe(true);
    });

    it("检测 'act as commander'", () => {
      const result = detectChatCommanderTrigger("Please act as commander");
      expect(result.triggered).toBe(true);
      expect(result.commanderTriggered).toBe(true);
    });
  });

  describe("动态工作流模式触发关键词", () => {
    it("检测 '用动态工作流'", () => {
      const result = detectChatCommanderTrigger("请用动态工作流来完成这个审计");
      expect(result.triggered).toBe(true);
      expect(result.workflowTriggered).toBe(true);
      expect(result.commanderTriggered).toBe(false);
      expect(result.matchedPhrases).toContain("用动态工作流");
      expect(result.suggestedTools).toContain("run_workflow");
      expect(result.suggestedTools).not.toContain("delegate_task");
    });

    it("检测 '使用动态工作流'", () => {
      const result = detectChatCommanderTrigger("请使用动态工作流来完成这个审计");
      expect(result.triggered).toBe(true);
      expect(result.workflowTriggered).toBe(true);
      expect(result.commanderTriggered).toBe(false);
      expect(result.matchedPhrases).toContain("使用动态工作流");
    });

    it("检测 '进动态工作流'", () => {
      const result = detectChatCommanderTrigger("我们进动态工作流吧");
      expect(result.triggered).toBe(true);
      expect(result.workflowTriggered).toBe(true);
      expect(result.commanderTriggered).toBe(false);
    });

    it("检测 '用动态工作流模式'", () => {
      const result = detectChatCommanderTrigger("用动态工作流模式来做");
      expect(result.triggered).toBe(true);
      expect(result.workflowTriggered).toBe(true);
    });

    it("检测 '进动态工作流模式'", () => {
      const result = detectChatCommanderTrigger("进动态工作流模式处理");
      expect(result.triggered).toBe(true);
      expect(result.workflowTriggered).toBe(true);
    });

    it("检测 '使用动态工作流模式'", () => {
      const result = detectChatCommanderTrigger("请使用动态工作流模式处理");
      expect(result.triggered).toBe(true);
      expect(result.workflowTriggered).toBe(true);
      expect(result.matchedPhrases).toContain("使用动态工作流模式");
    });

    it("检测 '用DW模式'（大小写不敏感）", () => {
      const result = detectChatCommanderTrigger("请用DW模式来完成");
      expect(result.triggered).toBe(true);
      expect(result.workflowTriggered).toBe(true);
    });

    it("检测 '使用DW模式'（大小写不敏感）", () => {
      const result = detectChatCommanderTrigger("请使用DW模式来完成");
      expect(result.triggered).toBe(true);
      expect(result.workflowTriggered).toBe(true);
      expect(result.matchedPhrases).toContain("使用dw模式");
    });

    it("检测 '进DW模式'（大小写不敏感）", () => {
      const result = detectChatCommanderTrigger("我们进DW模式吧");
      expect(result.triggered).toBe(true);
      expect(result.workflowTriggered).toBe(true);
    });

    it("检测 'use dynamic workflow'", () => {
      const result = detectChatCommanderTrigger("Please use dynamic workflow for this");
      expect(result.triggered).toBe(true);
      expect(result.workflowTriggered).toBe(true);
      expect(result.commanderTriggered).toBe(false);
    });

    it("检测 'enter dynamic workflow mode'", () => {
      const result = detectChatCommanderTrigger("Let's enter dynamic workflow mode");
      expect(result.triggered).toBe(true);
      expect(result.workflowTriggered).toBe(true);
    });

    it("检测 'use dw mode'", () => {
      const result = detectChatCommanderTrigger("Please use DW mode");
      expect(result.triggered).toBe(true);
      expect(result.workflowTriggered).toBe(true);
    });

    it("检测 'enter dw mode'", () => {
      const result = detectChatCommanderTrigger("Let's enter DW mode");
      expect(result.triggered).toBe(true);
      expect(result.workflowTriggered).toBe(true);
    });
  });

  describe("两种模式同时触发（兼容）", () => {
    it("同时包含指挥模式和工作流模式关键词", () => {
      const result = detectChatCommanderTrigger("用指挥模式，然后用动态工作流来执行");
      expect(result.triggered).toBe(true);
      expect(result.commanderTriggered).toBe(true);
      expect(result.workflowTriggered).toBe(true);
      expect(result.matchedPhrases.length).toBeGreaterThanOrEqual(2);
      expect(result.suggestedTools).toContain("delegate_task");
      expect(result.suggestedTools).toContain("delegate_parallel");
      expect(result.suggestedTools).toContain("run_workflow");
    });

    it("reason 包含两种模式的原因", () => {
      const result = detectChatCommanderTrigger("用指挥模式，用DW模式");
      expect(result.reason).toContain("指挥模式");
      expect(result.reason).toContain("动态工作流");
    });
  });

  describe("commanderMode === 'on'", () => {
    it("commanderMode=on 时只触发指挥模式，不触发工作流模式", () => {
      const result = detectChatCommanderTrigger("普通消息", "on");
      expect(result.triggered).toBe(true);
      expect(result.commanderTriggered).toBe(true);
      expect(result.workflowTriggered).toBe(false);
      expect(result.reason).toMatch(/settings/i);
      expect(result.suggestedTools).toContain("delegate_task");
      expect(result.suggestedTools).not.toContain("run_workflow");
    });

    it("commanderMode=on 时即使空消息也触发指挥模式", () => {
      const result = detectChatCommanderTrigger("", "on");
      expect(result.triggered).toBe(true);
      expect(result.commanderTriggered).toBe(true);
    });

    it("commanderMode=on 且消息包含工作流关键词时，两种模式都触发", () => {
      const result = detectChatCommanderTrigger("用动态工作流", "on");
      expect(result.triggered).toBe(true);
      expect(result.commanderTriggered).toBe(true);
      expect(result.workflowTriggered).toBe(true);
    });
  });

  describe("非触发场景", () => {
    it("普通闲聊不触发", () => {
      const result = detectChatCommanderTrigger("你好，今天天气怎么样？");
      expect(result.triggered).toBe(false);
      expect(result.commanderTriggered).toBe(false);
      expect(result.workflowTriggered).toBe(false);
      expect(result.matchedPhrases).toEqual([]);
    });

    it("单文件小修不触发", () => {
      const result = detectChatCommanderTrigger("帮我修一下 src/index.ts 里的 typo");
      expect(result.triggered).toBe(false);
    });

    it("问答不触发", () => {
      const result = detectChatCommanderTrigger("什么是 TypeScript 的泛型？");
      expect(result.triggered).toBe(false);
    });

    it("空消息不触发", () => {
      const result = detectChatCommanderTrigger("");
      expect(result.triggered).toBe(false);
    });

    it("commanderMode=auto 时按关键词检测", () => {
      const result = detectChatCommanderTrigger("普通消息", "auto");
      expect(result.triggered).toBe(false);
    });

    it("commanderMode=off 时仍按关键词检测", () => {
      const result = detectChatCommanderTrigger("用指挥模式", "off");
      expect(result.triggered).toBe(true);
      expect(result.commanderTriggered).toBe(true);
    });

    it("旧关键词 '并行审查' 不触发", () => {
      const result = detectChatCommanderTrigger("请并行审查这个方案");
      expect(result.triggered).toBe(false);
    });

    it("旧关键词 '用工作流' 不触发", () => {
      const result = detectChatCommanderTrigger("请用工作流来完成");
      expect(result.triggered).toBe(false);
    });

    it("旧关键词 'multi-agent' 不触发", () => {
      const result = detectChatCommanderTrigger("Let's use multi-agent approach");
      expect(result.triggered).toBe(false);
    });
  });
});

describe("buildChatCommanderHintText", () => {
  it("指挥模式触发时生成指挥模式提示", () => {
    const result = detectChatCommanderTrigger("用指挥模式");
    const text = buildChatCommanderHintText(result);
    expect(text).toContain("Chat Orchestration Hint");
    expect(text).toContain("指挥模式");
    expect(text).toContain("delegate_task");
    expect(text).toContain("delegate_parallel");
    expect(text).not.toContain("动态工作流模式");
  });

  it("动态工作流模式触发时生成工作流提示", () => {
    const result = detectChatCommanderTrigger("用动态工作流");
    const text = buildChatCommanderHintText(result);
    expect(text).toContain("动态工作流模式");
    expect(text).toContain("run_workflow");
    expect(text).not.toContain("指挥模式（Commander Mode）");
  });

  it("两种模式同时触发时生成两段提示", () => {
    const result = detectChatCommanderTrigger("用指挥模式，用动态工作流");
    const text = buildChatCommanderHintText(result);
    expect(text).toContain("指挥模式");
    expect(text).toContain("动态工作流模式");
    expect(text).toContain("delegate_task");
    expect(text).toContain("run_workflow");
    expect(text).toContain("指挥模式适合需要灵活应变的任务；动态工作流适合步骤固定的确定性任务");
  });

  it("commanderMode=on 时生成 settings enabled 提示", () => {
    const result = detectChatCommanderTrigger("普通消息", "on");
    const text = buildChatCommanderHintText(result);
    expect(text).toContain("settings enabled");
    expect(text).toContain("指挥模式");
  });

  it("包含注意事项", () => {
    const result = detectChatCommanderTrigger("用指挥模式");
    const text = buildChatCommanderHintText(result);
    expect(text).toContain("注意事项");
    expect(text).toContain("工具安全矩阵");
  });
});
