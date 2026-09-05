import { estimateTokens, type TokenEstimateOptions } from "./tokenizer.js";

export function compactWorkspaceMutationReadMetadata(evidence: Record<string, unknown>): Record<string, unknown> {
  const range = evidence.range;
  if (evidence.truncated !== false || evidence.anchor !== undefined
    || evidence.encoding !== "utf-8" || typeof evidence.size !== "number" || !Number.isSafeInteger(evidence.size) || evidence.size < 0
    || evidence.bytesRead !== evidence.size || !range || typeof range !== "object" || Array.isArray(range)
    || (range as Record<string, unknown>).offset !== 0
    || (range as Record<string, unknown>).endOffset !== evidence.size) return evidence;
  // Runtime validation retains these fields in the original read; the model needs only its source projection.
  const { size: _size, bytesRead: _bytesRead, range: _range, encoding: _encoding, revision: _revision, ...projected } = evidence;
  return projected;
}

export function fitWorkspaceMutationSourceContexts(input: {
  metadata: Record<string, unknown>;
  contexts: unknown[];
  maxTokens: number;
  tokenEstimateContext?: TokenEstimateOptions;
}): string {
  const serialize = (contexts: unknown[]) => JSON.stringify({ ...input.metadata, taskRelevantContexts: contexts });
  const fits = (contexts: unknown[]) => estimateTokens(serialize(contexts), input.tokenEstimateContext) <= input.maxTokens;
  if (fits(input.contexts)) return serialize(input.contexts);

  const selected: Array<{ original: Record<string, unknown>; bounded: Record<string, unknown>; sharedLine?: boolean }> = [];
  for (const context of input.contexts) {
    if (!context || typeof context !== "object" || Array.isArray(context)) continue;
    const original = context as Record<string, unknown>;
    const bounded = fitWorkspaceMutationSourceContext({
      ...input, context: original, minimalOnly: true,
      serializeEvidence: (candidate) => serialize([candidate]),
    });
    if (!bounded) continue;
    const duplicateIndex = selected.findIndex((item) => item.bounded.context === bounded.context
      && item.bounded.identifier === bounded.identifier);
    if (duplicateIndex >= 0) {
      const duplicate = selected[duplicateIndex];
      const priorRanges = duplicate.bounded.additionalIdenticalSourceLineRanges;
      const shared = { ...duplicate.bounded, additionalIdenticalSourceLineRanges: [
        ...(Array.isArray(priorRanges) ? priorRanges : []), bounded.lines,
      ] };
      if (fits(selected.map((item, index) => index === duplicateIndex ? shared : item.bounded))) {
        duplicate.bounded = shared;
        duplicate.sharedLine = true;
        continue;
      }
    }
    if (fits([...selected.map((item) => item.bounded), bounded])) selected.push({ original, bounded });
  }
  if (selected.length === 0) return "";

  // Reserve later occurrences before expanding earlier windows within the same file budget.
  for (const [index, item] of selected.entries()) {
    if (item.sharedLine) continue;
    const contextsWith = (candidate: Record<string, unknown>) => selected.map((entry, entryIndex) => (
      entryIndex === index ? candidate : entry.bounded
    ));
    const { leadingDocumentation: _omittedDocumentation, ...sourceOnly } = item.original;
    if (fits(contextsWith(item.original))) {
      item.bounded = item.original;
    } else if (fits(contextsWith(sourceOnly))) {
      item.bounded = sourceOnly;
    } else {
      item.bounded = fitWorkspaceMutationSourceContext({
        ...input, context: item.original,
        serializeEvidence: (candidate) => serialize(contextsWith(candidate)),
      }) ?? item.bounded;
    }
  }
  return serialize(selected.map((item) => item.bounded));
}

function fitWorkspaceMutationSourceContext(input: {
  context: Record<string, unknown>;
  maxTokens: number;
  tokenEstimateContext?: TokenEstimateOptions;
  serializeEvidence: (context: Record<string, unknown>) => string;
  minimalOnly?: boolean;
}): Record<string, unknown> | undefined {
  const { context, identifier, lines } = input.context;
  if (typeof context !== "string" || !context
    || typeof identifier !== "string" || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(identifier)
    || typeof lines !== "string") return undefined;
  const range = /^([1-9]\d*)-([1-9]\d*)$/.exec(lines);
  if (!range) return undefined;
  const firstLine = Number(range[1]);
  const lastLine = Number(range[2]);
  const sourceLines = context.split(/(?<=\n)/);
  if (!Number.isSafeInteger(firstLine) || !Number.isSafeInteger(lastLine)
    || lastLine - firstLine + 1 !== sourceLines.length) return undefined;
  const escapedIdentifier = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?<![A-Za-z0-9_$])${escapedIdentifier}(?![A-Za-z0-9_$])`);
  const target = sourceLines.findIndex((line) => match.test(line));
  if (target < 0) return undefined;

  const { leadingDocumentation: _omittedDocumentation, ...metadata } = input.context;
  const build = (start: number, end: number): Record<string, unknown> => ({
    ...metadata,
    lines: `${firstLine + start}-${firstLine + end}`,
    context: sourceLines.slice(start, end + 1).join(""),
    contextTruncatedForBudget: true,
  });
  const fits = (candidate: Record<string, unknown>) => estimateTokens(
    input.serializeEvidence(candidate), input.tokenEstimateContext,
  ) <= input.maxTokens;
  let start = target;
  let end = target;
  let best = build(start, end);
  if (!fits(best)) return undefined;
  if (input.minimalOnly) return best;

  // Keep the identifier's complete source line, then grow adjacent verbatim context within its quota.
  let growBefore = start > 0;
  let growAfter = end < sourceLines.length - 1;
  while (growBefore || growAfter) {
    if (growAfter) {
      const candidate = build(start, end + 1);
      if (fits(candidate)) {
        best = candidate;
        end++;
        growAfter = end < sourceLines.length - 1;
      } else {
        growAfter = false;
      }
    }
    if (growBefore) {
      const candidate = build(start - 1, end);
      if (fits(candidate)) {
        best = candidate;
        start--;
        growBefore = start > 0;
      } else {
        growBefore = false;
      }
    }
  }
  return best;
}
