import { Client } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import { createDiscordRestMakeRequest } from "./discord-rest-transport.js";

describe("Discord SDK REST transport integration", () => {
  it("preserves the real SDK token, JSON, response, and rate-limit header contract", async () => {
    const request = vi.fn(async (input: { url: string | URL }) => ({
      response: new Response(JSON.stringify({
        id: "123456789012345679",
        channel_id: "123456789012345678",
        content: "hello",
      }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-ratelimit-bucket": "bucket-a",
          "x-ratelimit-limit": "50",
          "x-ratelimit-remaining": "49",
          "x-ratelimit-reset-after": "0.01",
        },
      }),
      url: new URL(input.url.toString()),
      addresses: [{ address: "93.184.216.34", family: 4 as const }],
      redirectCount: 0,
    }));
    const client = new Client({
      intents: [],
      rest: {
        makeRequest: createDiscordRestMakeRequest({ outboundRequestPolicy: { request } }),
      },
    });
    client.rest.setToken("discord-token");

    try {
      await expect(client.rest.post("/channels/123456789012345678/messages", {
        body: { content: "hello" },
      })).resolves.toMatchObject({
        id: "123456789012345679",
        channel_id: "123456789012345678",
        content: "hello",
      });

      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith(expect.objectContaining({
        url: new URL("https://discord.com/api/v10/channels/123456789012345678/messages"),
        method: "POST",
        maxRedirects: 0,
        headers: expect.objectContaining({
          Authorization: "Bot discord-token",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ content: "hello" }),
      }));
    } finally {
      await client.destroy();
    }
  });
});
