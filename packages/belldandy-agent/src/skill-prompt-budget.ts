import { buildCapabilityRoutingIndexLines, buildCapabilityUsageNotesLines } from "./capability-routing.js";

export const DEFAULT_MAX_SKILL_PROMPT_BYTES = 64 * 1024;

export type SkillPromptInstruction = {
  name: string;
  instructions: string;
  priority?: "high" | "always";
  description?: string;
};

export type SkillPromptBudget = {
  maxBytes: number;
  renderedBytes: number;
  fullInstructionCount: number;
  deferredInstructionCount: number;
  renderedSummaryCount: number;
  omittedSummaryCount: number;
  routingOmitted: boolean;
};

export type BoundedSkillPrompt = {
  text?: string;
  budget: SkillPromptBudget;
};

function formatHighPrioritySkillSummary(skill: Pick<SkillPromptInstruction, "name" | "description">): string {
  const description = skill.description?.trim();
  return description
    ? `- \`${skill.name}\` - ${description}`
    : `- \`${skill.name}\` - summary only; use \`skill_get\` to open the full instructions when needed.`;
}

function normalizeBudget(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_MAX_SKILL_PROMPT_BYTES;
  }
  return Math.max(1, Math.floor(value));
}

/** Builds the skills section without ever retaining more rendered UTF-8 bytes than the configured budget. */
export function buildBoundedSkillPrompt(input: {
  skillInstructions?: SkillPromptInstruction[];
  hasSearchableSkills?: boolean;
  maxBytes?: number;
}): BoundedSkillPrompt {
  const maxBytes = normalizeBudget(input.maxBytes);
  const lines: string[] = [];
  let renderedBytes = 0;
  let fullInstructionCount = 0;
  let renderedSummaryCount = 0;
  let omittedSummaryCount = 0;
  let routingOmitted = false;

  const appendLines = (nextLines: string[]): boolean => {
    const block = nextLines.join("\n");
    const separator = lines.length > 0 ? "\n" : "";
    const addedBytes = Buffer.byteLength(separator, "utf-8") + Buffer.byteLength(block, "utf-8");
    if (renderedBytes + addedBytes > maxBytes) {
      return false;
    }
    lines.push(...nextLines);
    renderedBytes += addedBytes;
    return true;
  };

  const skills = input.skillInstructions ?? [];
  if (skills.length === 0) {
    if (input.hasSearchableSkills) {
      const routingLines = [
        "# Skills",
        "",
        ...buildCapabilityRoutingIndexLines(),
        "",
        ...buildCapabilityUsageNotesLines(),
        "",
      ];
      routingOmitted = !appendLines(routingLines);
    }
    return {
      ...(lines.length > 0 ? { text: lines.join("\n") } : {}),
      budget: {
        maxBytes,
        renderedBytes,
        fullInstructionCount,
        deferredInstructionCount: 0,
        renderedSummaryCount,
        omittedSummaryCount,
        routingOmitted,
      },
    };
  }

  appendLines(["# Active Skills", ""]);
  const alwaysSkills = skills.filter((skill) => skill.priority === "always");
  const highSkills = skills.filter((skill) => skill.priority !== "always");
  const deferredAlwaysSkills: SkillPromptInstruction[] = [];

  for (const skill of alwaysSkills) {
    const instructions = skill.instructions.trim();
    if (!instructions) continue;
    if (appendLines([`## [${skill.name}]`, "", instructions, ""])) {
      fullInstructionCount += 1;
    } else {
      deferredAlwaysSkills.push(skill);
    }
  }

  const summarySkills = [...highSkills, ...deferredAlwaysSkills];
  let summaryHeaderRendered = false;
  for (const skill of summarySkills) {
    const summary = formatHighPrioritySkillSummary(skill);
    const summaryLines = summaryHeaderRendered
      ? [summary]
      : [
          ...(fullInstructionCount > 0 ? [""] : []),
          "## High-Priority Skill Summaries",
          "",
          "These skills remain visible as summaries. Open the exact one with `skill_get` once you decide to adopt it.",
          "",
          summary,
          "",
        ];
    if (appendLines(summaryLines)) {
      summaryHeaderRendered = true;
      renderedSummaryCount += 1;
    } else {
      omittedSummaryCount += 1;
    }
  }

  const needsRouting = Boolean(input.hasSearchableSkills)
    || highSkills.length > 0
    || deferredAlwaysSkills.length > 0;
  if (needsRouting) {
    routingOmitted = !appendLines([
      ...buildCapabilityRoutingIndexLines(),
      "",
      ...buildCapabilityUsageNotesLines(),
      "",
    ]);
  }

  const hasUsefulContent = fullInstructionCount > 0
    || renderedSummaryCount > 0
    || (needsRouting && !routingOmitted);
  return {
    ...(hasUsefulContent ? { text: lines.join("\n") } : {}),
    budget: {
      maxBytes,
      renderedBytes: hasUsefulContent ? renderedBytes : 0,
      fullInstructionCount,
      deferredInstructionCount: deferredAlwaysSkills.length,
      renderedSummaryCount,
      omittedSummaryCount,
      routingOmitted,
    },
  };
}
