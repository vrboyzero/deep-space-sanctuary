import { describe, expect, it } from "vitest";

import { SUBTASK_COMMAND_KINDS } from "./subtask-command-claim.js";
import {
  DEFAULT_SUBTASK_PAGE_LIMIT,
  MAX_SUBTASK_PAGE_LIMIT,
} from "./subtask-runtime-pagination.js";
import { DEFAULT_SUBTASK_RETENTION_POLICY } from "./subtask-runtime-retention.js";

describe("subtask runtime owner inventory", () => {
  it("keeps command, pagination, and retention contracts explicit", () => {
    expect({
      commandKinds: SUBTASK_COMMAND_KINDS,
      pagination: {
        defaultLimit: DEFAULT_SUBTASK_PAGE_LIMIT,
        maxLimit: MAX_SUBTASK_PAGE_LIMIT,
      },
      retention: DEFAULT_SUBTASK_RETENTION_POLICY,
    }).toEqual({
      commandKinds: ["steering", "resume", "takeover", "stop"],
      pagination: {
        defaultLimit: 100,
        maxLimit: 200,
      },
      retention: {
        autoCompact: false,
        maxTerminalRecords: 500,
        minTerminalAgeMs: 30 * 24 * 60 * 60 * 1_000,
      },
    });
  });
});
