import { beforeEach, describe, expect, it, vi } from "vitest";

const nodemailerBoundary = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: nodemailerBoundary.createTransport,
  },
}));

import { normalizeEmailOutboundDraft } from "./email-outbound-contract.js";
import { SmtpEmailOutboundProvider } from "./email-outbound-smtp-provider.js";

describe("SmtpEmailOutboundProvider", () => {
  beforeEach(() => {
    nodemailerBoundary.createTransport.mockReset();
    nodemailerBoundary.sendMail.mockReset();
    nodemailerBoundary.createTransport.mockReturnValue({
      sendMail: nodemailerBoundary.sendMail,
    });
  });

  it("maps the normalized outbound contract to the SMTP transport boundary", async () => {
    nodemailerBoundary.sendMail.mockResolvedValue({ messageId: "smtp-message-001" });
    const provider = new SmtpEmailOutboundProvider({
      accountId: "primary",
      host: "smtp.example.com",
      port: 587,
      secure: false,
      username: "mailer@example.com",
      password: "app-password",
      fromAddress: "mailer@example.com",
      fromName: "Belldandy",
    });
    const normalized = normalizeEmailOutboundDraft({
      accountId: "primary",
      to: [{ address: "alice@example.com", name: "Alice" }],
      cc: [{ address: "bob@example.com" }],
      subject: "Status",
      text: "Ready",
      threadId: "thread-001",
      replyToMessageId: "message-000",
    });
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) {
      throw new Error("expected a normalized SMTP draft");
    }

    const result = await provider.send({ draft: normalized.value });

    expect(nodemailerBoundary.createTransport).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      auth: {
        user: "mailer@example.com",
        pass: "app-password",
      },
    });
    expect(nodemailerBoundary.sendMail).toHaveBeenCalledWith({
      from: '"Belldandy" <mailer@example.com>',
      to: ['"Alice" <alice@example.com>'],
      cc: ["bob@example.com"],
      subject: "Status",
      text: "Ready",
      inReplyTo: "message-000",
      references: ["thread-001", "message-000"],
    });
    expect(result).toMatchObject({
      ok: true,
      providerId: "smtp",
      providerMessageId: "smtp-message-001",
      providerThreadId: "thread-001",
    });
  });
});
