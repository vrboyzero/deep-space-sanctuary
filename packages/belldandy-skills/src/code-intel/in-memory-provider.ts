import type {
  CodeIntelOperation,
  CodeIntelProvider,
  CodeIntelProviderContext,
  CodeIntelProviderProfile,
  CodeIntelProviderRequest,
  CodeIntelProviderResult,
} from "./types.js";

interface InMemoryCodeIntelResponseBase {
  delayMs?: number;
}

type InMemoryCodeIntelResponseMatch =
  | { match: { operation: "symbols"; query: string } }
  | {
      match: {
        operation: Exclude<CodeIntelOperation, "symbols">;
        path: string;
        line: number;
        column: number;
      };
    };

export type InMemoryCodeIntelResponse = InMemoryCodeIntelResponseBase
& InMemoryCodeIntelResponseMatch & (
  | { result: CodeIntelProviderResult; errorMessage?: never }
  | { result?: never; errorMessage: string }
);

export interface InMemoryCodeIntelProviderOptions {
  profile: CodeIntelProviderProfile;
  responses: InMemoryCodeIntelResponse[];
}

export class InMemoryCodeIntelProvider implements CodeIntelProvider {
  readonly profile: CodeIntelProviderProfile;
  private readonly responses: InMemoryCodeIntelResponse[];

  constructor(options: InMemoryCodeIntelProviderOptions) {
    this.profile = structuredClone(options.profile);
    this.responses = structuredClone(options.responses);
  }

  async query(
    request: CodeIntelProviderRequest,
    context: CodeIntelProviderContext,
  ): Promise<CodeIntelProviderResult> {
    const response = this.responses.find(({ match }) => matchesRequest(match, request));
    if (!response) {
      throw new Error("No in-memory CodeIntel response matched the query.");
    }
    if (response.delayMs !== undefined && response.delayMs > 0) {
      await abortableDelay(response.delayMs, context.signal);
    }
    if (context.signal.aborted) {
      throw new DOMException("CodeIntel query was aborted.", "AbortError");
    }
    if (response.errorMessage !== undefined) {
      throw new Error(response.errorMessage);
    }
    return structuredClone(response.result);
  }
}

function matchesRequest(
  match: InMemoryCodeIntelResponse["match"],
  request: CodeIntelProviderRequest,
): boolean {
  if (match.operation !== request.operation) {
    return false;
  }
  if (match.operation === "symbols" && request.operation === "symbols") {
    return match.query === request.query;
  }
  if (match.operation !== "symbols" && request.operation !== "symbols") {
    return match.path === request.location.path
      && match.line === request.location.line
      && match.column === request.location.column;
  }
  return false;
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("CodeIntel query was aborted.", "AbortError"));
      return;
    }

    const handle = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(handle);
      reject(new DOMException("CodeIntel query was aborted.", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
