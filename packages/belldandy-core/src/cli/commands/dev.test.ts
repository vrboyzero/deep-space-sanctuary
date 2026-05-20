import { afterEach, expect, test, vi } from "vitest";

const { startForegroundMock, createCLIContextMock } = vi.hoisted(() => ({
  startForegroundMock: vi.fn(),
  createCLIContextMock: vi.fn(),
}));

vi.mock("../daemon.js", () => ({
  startForeground: startForegroundMock,
}));

vi.mock("../shared/context.js", () => ({
  createCLIContext: createCLIContextMock,
}));

import devCommand from "./dev.js";

afterEach(() => {
  vi.clearAllMocks();
});

test("dev command starts gateway through foreground supervisor", async () => {
  createCLIContextMock.mockReturnValue({ stateDir: "E:/state/dev-supervisor" });

  await devCommand.run?.({
    args: {
      json: true,
      "state-dir": "E:/state/dev-supervisor",
    },
  } as any);

  expect(createCLIContextMock).toHaveBeenCalledWith({
    json: true,
    stateDir: "E:/state/dev-supervisor",
  });
  expect(startForegroundMock).toHaveBeenCalledWith("E:/state/dev-supervisor");
});
