/**
 * Skill Eligibility Gating 引擎
 *
 * 检查 5 个维度：env / bin / mcp / tools / files
 * 不满足条件的 skill 不注入 prompt，避免浪费 token。
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { SkillDefinition, EligibilityContext, EligibilityResult } from "./skill-types.js";

const isWindows = process.platform === "win32";

/**
 * 检查单个 skill 的准入条件
 */
export async function checkEligibility(
  skill: SkillDefinition,
  ctx: EligibilityContext,
): Promise<EligibilityResult> {
  const elig = skill.eligibility;
  if (!elig) return { eligible: true, reasons: [] };

  const reasons: string[] = [];

  // 1. env — 环境变量需存在且非空
  if (elig.env) {
    for (const key of elig.env) {
      if (!process.env[key]) {
        reasons.push(`missing env: ${key}`);
      }
    }
  }

  // 2. bin — PATH 上的可执行文件
  if (elig.bin) {
    for (const bin of elig.bin) {
      const found = await checkBinExists(bin);
      if (!found) {
        reasons.push(`missing bin: ${bin}`);
      }
    }
  }

  // 3. mcp — MCP 服务器需在线
  if (elig.mcp) {
    const activeSet = new Set(ctx.activeMcpServers);
    for (const server of elig.mcp) {
      if (!activeSet.has(server)) {
        reasons.push(`missing mcp server: ${server}`);
      }
    }
  }

  // 4. tools — 已注册的 tool 名称
  if (elig.tools) {
    const toolSet = new Set(ctx.registeredTools);
    for (const tool of elig.tools) {
      if (!toolSet.has(tool)) {
        reasons.push(`missing tool: ${tool}`);
      }
    }
  }

  // 5. files — workspace 中需存在的文件
  if (elig.files) {
    for (const file of elig.files) {
      const filePath = path.resolve(ctx.workspaceRoot, file);
      try {
        await fs.access(filePath);
      } catch {
        reasons.push(`missing file: ${file}`);
      }
    }
  }

  return { eligible: reasons.length === 0, reasons };
}

/**
 * 批量检查多个 skills
 */
export async function checkEligibilityBatch(
  skills: SkillDefinition[],
  ctx: EligibilityContext,
  keyForSkill: (skill: SkillDefinition) => string = (skill) => skill.name,
): Promise<Map<string, EligibilityResult>> {
  const results = new Map<string, EligibilityResult>();

  // bin 检查有 I/O，先收集所有需要检查的 bin 做一次性检查
  const allBins = new Set<string>();
  for (const skill of skills) {
    if (skill.eligibility?.bin) {
      for (const bin of skill.eligibility.bin) allBins.add(bin);
    }
  }
  const binCache = new Map<string, boolean>();
  await Promise.all(
    [...allBins].map(async (bin) => {
      binCache.set(bin, await checkBinExists(bin));
    }),
  );

  // 逐个检查（bin 用缓存）
  for (const skill of skills) {
    const elig = skill.eligibility;
    if (!elig) {
      results.set(keyForSkill(skill), { eligible: true, reasons: [] });
      continue;
    }

    const reasons: string[] = [];

    if (elig.env) {
      for (const key of elig.env) {
        if (!process.env[key]) reasons.push(`missing env: ${key}`);
      }
    }
    if (elig.bin) {
      for (const bin of elig.bin) {
        if (!binCache.get(bin)) reasons.push(`missing bin: ${bin}`);
      }
    }
    if (elig.mcp) {
      const activeSet = new Set(ctx.activeMcpServers);
      for (const server of elig.mcp) {
        if (!activeSet.has(server)) reasons.push(`missing mcp server: ${server}`);
      }
    }
    if (elig.tools) {
      const toolSet = new Set(ctx.registeredTools);
      for (const tool of elig.tools) {
        if (!toolSet.has(tool)) reasons.push(`missing tool: ${tool}`);
      }
    }
    if (elig.files) {
      for (const file of elig.files) {
        const filePath = path.resolve(ctx.workspaceRoot, file);
        try {
          await fs.access(filePath);
        } catch {
          reasons.push(`missing file: ${file}`);
        }
      }
    }

    results.set(keyForSkill(skill), { eligible: reasons.length === 0, reasons });
  }

  return results;
}

// ============================================================================
// 内部辅助
// ============================================================================

function checkBinExists(bin: string): Promise<boolean> {
  const cmd = isWindows ? "where" : "which";
  return new Promise((resolve) => {
    try {
      execFile(cmd, [bin], { timeout: 3000 }, (err) => {
        resolve(!err);
      });
    } catch {
      resolve(false);
    }
  });
}
