import { afterEach, describe, expect, it, vi } from "vitest";

import { startStarweaverActiveNotifyRuntime } from "./starweaver-active-notify-runtime.js";

describe("starweaver active notify runtime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_ENABLED;
    delete process.env.BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_POLL_INTERVAL_MS;
  });

  it("triggers resident auto-run once for a new notification batch", async () => {
    process.env.BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_ENABLED = "true";
    process.env.BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_POLL_INTERVAL_MS = "20";

    const execute = vi.fn()
      .mockResolvedValueOnce({
        success: true,
        output: JSON.stringify({
          items: [
            {
              notificationId: "notification-first",
              signalKind: "command_available",
              recommendedPeek: "command_peek",
              actorId: "npc-1",
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        success: true,
        output: JSON.stringify({
          items: [],
          ack: {
            matched: 1,
            acknowledged: 1,
          },
        }),
      })
      .mockResolvedValue({
        success: true,
        output: JSON.stringify({
          items: [
            {
              notificationId: "notification-first",
              signalKind: "command_available",
              recommendedPeek: "command_peek",
              actorId: "npc-1",
            },
          ],
        }),
      });
    const autoRunResidentAgent = vi.fn().mockResolvedValue({
      conversationId: "agent:default:main",
      runId: "run-1",
    });

    const handle = await startStarweaverActiveNotifyRuntime({
      toolExecutor: {
        execute,
      } as any,
      isBusy: () => false,
      autoRunResidentAgent,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });

    expect(handle).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 60));
    handle?.close();

    expect(autoRunResidentAgent).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        name: "mcp_starweaver_central_agent_wake_notifications",
        arguments: expect.objectContaining({
          notificationIds: ["notification-first"],
          ackMatched: true,
          includeAcked: true,
          includeExpired: true,
        }),
      }),
      "agent:default:main",
      "default",
      undefined,
      undefined,
      undefined,
      expect.any(Object),
    );
    expect(autoRunResidentAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "default",
        text: expect.stringContaining("StarWeaver wake signal"),
        visibleReminder: expect.stringContaining("StarWeaver 提醒"),
      }),
    );
  });

  it("accepts structured notification payloads wrapped by upper runtime layers", async () => {
    process.env.BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_ENABLED = "true";
    process.env.BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_POLL_INTERVAL_MS = "20";

    const execute = vi.fn()
      .mockResolvedValueOnce({
        success: true,
        output: JSON.stringify({
          structuredContent: {
            items: [
              {
                notificationId: "notification-structured",
                signalKind: "command_available",
                recommendedPeek: "command_peek",
                actorId: "actor.player",
                sessionId: "session-actor.player",
              },
            ],
          },
        }),
      })
      .mockResolvedValue({
        success: true,
        output: JSON.stringify({
          items: [],
          ack: {
            matched: 1,
            acknowledged: 1,
          },
        }),
      });
    const autoRunResidentAgent = vi.fn().mockResolvedValue({
      conversationId: "agent:default:main",
      runId: "run-structured",
    });

    const handle = await startStarweaverActiveNotifyRuntime({
      toolExecutor: {
        execute,
      } as any,
      isBusy: () => false,
      autoRunResidentAgent,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    handle?.close();

    expect(autoRunResidentAgent).toHaveBeenCalledTimes(1);
    expect(autoRunResidentAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        visibleReminder: expect.stringContaining("command_peek"),
      }),
    );
  });

  it("accepts nested output wrappers used by bridge layers", async () => {
    process.env.BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_ENABLED = "true";
    process.env.BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_POLL_INTERVAL_MS = "20";

    const execute = vi.fn()
      .mockResolvedValueOnce({
        success: true,
        output: JSON.stringify({
          output: JSON.stringify({
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  items: [
                    {
                      notificationId: "notification-nested",
                      signalKind: "command_available",
                      recommendedPeek: "command_peek",
                      actorId: "actor.player",
                      sessionId: "session-actor.player",
                      sourceMessageId: "command-message-nested",
                      createdAt: "2026-06-01T13:53:45.819Z",
                    },
                  ],
                }),
              },
            ],
          }),
        }),
      })
      .mockResolvedValue({
        success: true,
        output: JSON.stringify({
          items: [],
          ack: {
            matched: 1,
            acknowledged: 1,
          },
        }),
      });
    const autoRunResidentAgent = vi.fn().mockResolvedValue({
      conversationId: "agent:default:main",
      runId: "run-nested",
    });

    const handle = await startStarweaverActiveNotifyRuntime({
      toolExecutor: {
        execute,
      } as any,
      isBusy: () => false,
      autoRunResidentAgent,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    handle?.close();

    expect(autoRunResidentAgent).toHaveBeenCalledTimes(1);
  });

  it("treats later notifications for the same actor as new batches when source message changes", async () => {
    process.env.BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_ENABLED = "true";
    process.env.BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_POLL_INTERVAL_MS = "20";

    const execute = vi.fn()
      .mockResolvedValueOnce({
        success: true,
        output: JSON.stringify({
          items: [
            {
              notificationId: "notification-1",
              signalKind: "command_available",
              recommendedPeek: "command_peek",
              actorId: "actor.player",
              sessionId: "session-actor.player",
              sourceMessageId: "command-message-1",
              createdAt: "2026-06-01T13:42:06.912Z",
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        success: true,
        output: JSON.stringify({
          items: [],
          ack: {
            matched: 1,
            acknowledged: 1,
          },
        }),
      })
      .mockResolvedValueOnce({
        success: true,
        output: JSON.stringify({
          items: [
            {
              notificationId: "notification-2",
              signalKind: "command_available",
              recommendedPeek: "command_peek",
              actorId: "actor.player",
              sessionId: "session-actor.player",
              sourceMessageId: "command-message-2",
              createdAt: "2026-06-01T13:43:06.912Z",
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        success: true,
        output: JSON.stringify({
          items: [],
          ack: {
            matched: 1,
            acknowledged: 1,
          },
        }),
      })
      .mockResolvedValue({
        success: true,
        output: JSON.stringify({
          items: [
            {
              notificationId: "notification-2",
              signalKind: "command_available",
              recommendedPeek: "command_peek",
              actorId: "actor.player",
              sessionId: "session-actor.player",
              sourceMessageId: "command-message-2",
              createdAt: "2026-06-01T13:43:06.912Z",
            },
          ],
        }),
      });
    const autoRunResidentAgent = vi.fn().mockResolvedValue({
      conversationId: "agent:default:main",
      runId: "run-repeat",
    });

    const handle = await startStarweaverActiveNotifyRuntime({
      toolExecutor: {
        execute,
      } as any,
      isBusy: () => false,
      autoRunResidentAgent,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 75));
    handle?.close();

    expect(autoRunResidentAgent).toHaveBeenCalledTimes(2);
  });

  it("does not rely on fingerprint when the previous notification batch has been acknowledged", async () => {
    process.env.BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_ENABLED = "true";
    process.env.BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_POLL_INTERVAL_MS = "20";

    const execute = vi.fn()
      .mockResolvedValueOnce({
        success: true,
        output: JSON.stringify({
          items: [
            {
              notificationId: "notification-ack-flow",
              signalKind: "command_available",
              recommendedPeek: "command_peek",
              actorId: "actor.player",
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        success: true,
        output: JSON.stringify({
          items: [],
          ack: {
            matched: 1,
            acknowledged: 1,
          },
        }),
      })
      .mockResolvedValue({
        success: true,
        output: JSON.stringify({
          items: [],
        }),
      });
    const autoRunResidentAgent = vi.fn().mockResolvedValue({
      conversationId: "agent:default:main",
      runId: "run-ack-flow",
    });

    const handle = await startStarweaverActiveNotifyRuntime({
      toolExecutor: {
        execute,
      } as any,
      isBusy: () => false,
      autoRunResidentAgent,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 60));
    handle?.close();

    expect(autoRunResidentAgent).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "mcp_starweaver_central_agent_wake_notifications",
        arguments: expect.objectContaining({
          notificationIds: ["notification-ack-flow"],
          ackMatched: true,
        }),
      }),
      "agent:default:main",
      "default",
      undefined,
      undefined,
      undefined,
      expect.any(Object),
    );
  });

  it("logs unusable polling output at debug level instead of info", async () => {
    process.env.BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_ENABLED = "true";
    process.env.BELLDANDY_STARWEAVER_ACTIVE_NOTIFY_POLL_INTERVAL_MS = "20";

    const execute = vi.fn().mockResolvedValue({
      success: false,
      output: undefined,
    });
    const autoRunResidentAgent = vi.fn();
    const debug = vi.fn();
    const info = vi.fn();

    const handle = await startStarweaverActiveNotifyRuntime({
      toolExecutor: {
        execute,
      } as any,
      isBusy: () => false,
      autoRunResidentAgent,
      logger: {
        debug,
        info,
        warn: () => {},
        error: () => {},
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 35));
    handle?.close();

    expect(
      debug.mock.calls.some(([module, message]) => (
        module === "starweaver-active-notify"
        && message === "Notification poll returned no usable output."
      )),
    ).toBe(true);
    expect(
      info.mock.calls.some(([module, message]) => (
        module === "starweaver-active-notify"
        && message === "Notification poll returned no usable output."
      )),
    ).toBe(false);
    expect(autoRunResidentAgent).not.toHaveBeenCalled();
  });

  it("does not start when the feature switch is disabled", async () => {
    const execute = vi.fn();
    const autoRunResidentAgent = vi.fn();

    const handle = await startStarweaverActiveNotifyRuntime({
      toolExecutor: {
        execute,
      } as any,
      isBusy: () => false,
      autoRunResidentAgent,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });

    expect(handle).toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
    expect(autoRunResidentAgent).not.toHaveBeenCalled();
  });
});
