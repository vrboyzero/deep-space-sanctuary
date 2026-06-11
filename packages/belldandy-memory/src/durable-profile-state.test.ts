import { describe, expect, it } from "vitest";

import {
  DURABLE_PROFILE_STATE_PROMPT_BLOCK,
  buildDurableProfileStatePlan,
  isAllowedDurableProfileStatePath,
} from "./durable-profile-state.js";

describe("durable profile state plan", () => {
  it("keeps only low-risk whitelisted profile patches", () => {
    const plan = buildDurableProfileStatePlan({
      sourceConversationId: "conv-1",
      sourceLabel: "conv-1",
      items: [
        {
          type: "偏好",
          category: "preference",
          candidateType: "user",
          content: "用户默认希望先给结论，再展开证据。",
          reason: "稳定输出偏好",
          profilePath: "preferences.response_style",
          profileValue: "先给结论，再展开证据",
        },
        {
          type: "事实",
          category: "fact",
          candidateType: "project",
          content: "项目目前处于 P0。",
          profilePath: "project.phase",
          profileValue: "P0",
        },
      ],
    });

    expect(plan.patches).toHaveLength(1);
    expect(plan.patches[0]).toMatchObject({
      path: "preferences.response_style",
      value: "先给结论，再展开证据",
      confidence: 0.9,
    });
    expect(plan.patches[0].sourceRefs[0]).toMatchObject({
      kind: "conversation",
      id: "conv-1",
    });
    expect(plan.rejected).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "path_not_allowed",
        path: "project.phase",
      }),
    ]));
  });

  it("requires explicit profile values for canonical profile writes", () => {
    const plan = buildDurableProfileStatePlan({
      sourceConversationId: "conv-2",
      sourceLabel: "conv-2",
      items: [{
        type: "偏好",
        category: "preference",
        candidateType: "user",
        content: "用户偏好状态表。",
        profilePath: "preferences.format_preference",
      }],
    });

    expect(plan.patches).toHaveLength(0);
    expect(plan.rejected).toEqual([
      expect.objectContaining({
        code: "value_invalid",
        path: "preferences.format_preference",
      }),
    ]);
  });

  it("exposes the allowed low-risk profile prompt block", () => {
    expect(DURABLE_PROFILE_STATE_PROMPT_BLOCK).toContain("profilePath");
    expect(isAllowedDurableProfileStatePath("identity.name")).toBe(true);
    expect(isAllowedDurableProfileStatePath("project.phase")).toBe(false);
  });
});
