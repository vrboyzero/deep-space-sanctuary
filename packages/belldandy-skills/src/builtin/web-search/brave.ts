import { OutboundRequestPolicy } from "@belldandy/protocol";
import type { SearchProvider, SearchResult, WebSearchOptions } from "./types.js";
import {
    createLinkedAbortController,
    isAbortError,
    raceWithAbort,
    readAbortReason,
    throwIfAborted,
} from "../../abort-utils.js";
import { cancelResponseBody, readBoundedJsonResponse } from "./bounded-json-response.js";

const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const BRAVE_SEARCH_TIMEOUT_MS = 10_000;
const BRAVE_SEARCH_MAX_REDIRECTS = 0;
const BRAVE_SEARCH_MAX_RESPONSE_BYTES = 1024 * 1024;

export interface BraveSearchProviderOptions {
    outboundRequestPolicy?: Pick<OutboundRequestPolicy, "request">;
}

interface BraveSearchResponse {
    web?: {
        results?: Array<{
            title: string;
            url: string;
            description: string;
            age?: string;
            profile?: { name: string };
        }>;
    };
}

export class BraveSearchProvider implements SearchProvider {
    name = "brave";
    private readonly outboundRequestPolicy: Pick<OutboundRequestPolicy, "request">;

    constructor(options: BraveSearchProviderOptions = {}) {
        this.outboundRequestPolicy = options.outboundRequestPolicy ?? new OutboundRequestPolicy({
            allowedHosts: ["api.search.brave.com"],
            maxRedirects: BRAVE_SEARCH_MAX_REDIRECTS,
        });
    }

    async search(options: WebSearchOptions): Promise<SearchResult[]> {
        const apiKey = options.apiKey || process.env.BRAVE_API_KEY;
        if (!apiKey) {
            throw new Error("Missing BRAVE_API_KEY. Please set it in environment variables.");
        }

        const count = Math.min(Math.max(1, options.count || 5), 20);

        const url = new URL(BRAVE_SEARCH_ENDPOINT);
        url.searchParams.set("q", options.query);
        url.searchParams.set("count", String(count));
        if (options.country) {
            url.searchParams.set("country", options.country);
        }

        throwIfAborted(options.abortSignal);
        const linkedAbort = createLinkedAbortController({
            signal: options.abortSignal,
            timeoutMs: BRAVE_SEARCH_TIMEOUT_MS,
            timeoutReason: `Brave Search timed out after ${BRAVE_SEARCH_TIMEOUT_MS}ms.`,
        });

        try {
            const { response: res } = await raceWithAbort(this.outboundRequestPolicy.request({
                url,
                headers: {
                    "Accept": "application/json",
                    "Accept-Encoding": "identity",
                    "X-Subscription-Token": apiKey,
                },
                signal: linkedAbort.controller.signal,
                maxRedirects: BRAVE_SEARCH_MAX_REDIRECTS,
                idleTimeoutMs: BRAVE_SEARCH_TIMEOUT_MS,
            }), linkedAbort.controller.signal);

            if (!res.ok) {
                await cancelResponseBody(res);
                throw new Error(`Brave Search API error: ${res.status} ${res.statusText}`);
            }

            const data = await readBoundedJsonResponse({
                response: res,
                maxBytes: BRAVE_SEARCH_MAX_RESPONSE_BYTES,
                responseLabel: "Brave Search response",
                abortSignal: linkedAbort.controller.signal,
            }) as BraveSearchResponse;
            const results = data.web?.results || [];

            return results.map((item) => ({
                title: item.title,
                url: item.url,
                snippet: item.description,
                published: item.age,
                source: item.profile?.name,
            }));
        } catch (error) {
            if (isAbortError(error)) {
                if (options.abortSignal?.aborted) {
                    throw new Error(readAbortReason(options.abortSignal));
                }
                throw new Error(`Brave Search timed out after ${BRAVE_SEARCH_TIMEOUT_MS}ms.`);
            }
            throw error;
        } finally {
            linkedAbort.cleanup();
        }
    }
}
