import { render, type Instance } from "ink";

import type { AgentRunEvent } from "../coding-run/contracts.js";
import { CodingTuiApp } from "./app.js";
import { createCodingTuiRuntime } from "./runtime.js";

export async function runCodingTui(input: {
  stateDir: string;
  cwd: string;
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
  stderr?: NodeJS.WriteStream;
}): Promise<number> {
  const stdin = input.stdin ?? process.stdin;
  const stdout = input.stdout ?? process.stdout;
  const stderr = input.stderr ?? process.stderr;
  let eventHandler: (event: AgentRunEvent) => void = () => {};
  let errorHandler: (message: string) => void = () => {};
  const runtime = createCodingTuiRuntime({
    stateDir: input.stateDir,
    cwd: input.cwd,
    onEvent: (event) => eventHandler(event),
    onSubscriptionError: (error) => errorHandler(`${error.code}: ${error.message}`),
    onProtocolError: (error) => errorHandler(`${error.code}: ${error.message}`),
    onBridgeError: (message) => errorHandler(message),
  });
  let instance: Instance | undefined;
  try {
    instance = render(
      <CodingTuiApp
        runtime={runtime}
        onEventRegistration={(handler) => { eventHandler = handler; }}
        onErrorRegistration={(handler) => { errorHandler = handler; }}
      />,
      {
        stdin,
        stdout,
        stderr,
        exitOnCtrlC: false,
        patchConsole: true,
        alternateScreen: true,
        interactive: true,
        maxFps: 30,
      },
    );
    await instance.waitUntilExit();
    return 0;
  } finally {
    instance?.cleanup();
    await runtime.close();
  }
}

export { CodingTuiRuntime, inspectWorkspaceChanges } from "./runtime.js";
export { createInitialTuiState, reduceTuiState } from "./state.js";
