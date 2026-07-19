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

const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";
const SERPAPI_TIMEOUT_MS = 15_000;
const SERPAPI_MAX_REDIRECTS = 0;
const SERPAPI_MAX_RESPONSE_BYTES = 1024 * 1024;

export interface SerpApiProviderOptions {
    outboundRequestPolicy?: Pick<OutboundRequestPolicy, "request">;
}

interface SerpApiResponse {
    organic_results?: Array<{
        title: string;
        link: string;
        snippet: string;
        date?: string;
        source?: string;
    }>;
    error?: string;
}

export class SerpApiProvider implements SearchProvider {
    name = "serpapi";
    private readonly outboundRequestPolicy: Pick<OutboundRequestPolicy, "request">;

    constructor(options: SerpApiProviderOptions = {}) {
        this.outboundRequestPolicy = options.outboundRequestPolicy ?? new OutboundRequestPolicy({
            allowedHosts: ["serpapi.com"],
            maxRedirects: SERPAPI_MAX_REDIRECTS,
        });
    }

    async search(options: WebSearchOptions): Promise<SearchResult[]> {
        const apiKey = options.apiKey || process.env.SERPAPI_API_KEY;
        if (!apiKey) {
            throw new Error("Missing SERPAPI_API_KEY. Please set it in environment variables.");
        }

        const count = Math.min(Math.max(1, options.count || 5), 20);

        const url = new URL(SERPAPI_ENDPOINT);
        url.searchParams.set("engine", "google");
        url.searchParams.set("q", options.query);
        url.searchParams.set("api_key", apiKey);
        url.searchParams.set("num", String(count));
        if (options.country) {
            url.searchParams.set("gl", options.country); // Google uses 'gl' for country
        }

        throwIfAborted(options.abortSignal);
        const linkedAbort = createLinkedAbortController({
            signal: options.abortSignal,
            timeoutMs: SERPAPI_TIMEOUT_MS,
            timeoutReason: `SerpAPI timed out after ${SERPAPI_TIMEOUT_MS}ms.`,
        });

        try {
            const { response: res } = await raceWithAbort(this.outboundRequestPolicy.request({
                url,
                headers: {
                    "Accept": "application/json",
                    "Accept-Encoding": "identity",
                },
                signal: linkedAbort.controller.signal,
                maxRedirects: SERPAPI_MAX_REDIRECTS,
                idleTimeoutMs: SERPAPI_TIMEOUT_MS,
            }), linkedAbort.controller.signal);

            if (!res.ok) {
                await cancelResponseBody(res);
                throw new Error(`SerpAPI error: ${res.status} ${res.statusText}`);
            }

            const data = await readBoundedJsonResponse({
                response: res,
                maxBytes: SERPAPI_MAX_RESPONSE_BYTES,
                responseLabel: "SerpAPI response",
                abortSignal: linkedAbort.controller.signal,
            }) as SerpApiResponse;

            if (data.error) {
                throw new Error(`SerpAPI error: ${data.error}`);
            }

            const results = data.organic_results || [];

            return results.map((item) => ({
                title: item.title,
                url: item.link,
                snippet: item.snippet,
                published: item.date,
                source: item.source,
            }));
        } catch (error) {
            if (isAbortError(error)) {
                if (options.abortSignal?.aborted) {
                    throw new Error(readAbortReason(options.abortSignal));
                }
                throw new Error(`SerpAPI timed out after ${SERPAPI_TIMEOUT_MS}ms.`);
            }
            throw error;
        } finally {
            linkedAbort.cleanup();
        }
    }
}
