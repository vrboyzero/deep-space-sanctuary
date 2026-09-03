const PTY_CURSOR_POSITION_QUERY = "\u001b[6n";

export const PTY_CURSOR_POSITION_RESPONSE = "\u001b[1;1R";

export type PtyTerminalResponseFilter = {
  consume(data: string): { output: string; responses: string[] };
  flush(): string;
};

function findPendingQueryPrefixLength(value: string): number {
  const maximum = Math.min(value.length, PTY_CURSOR_POSITION_QUERY.length - 1);
  for (let length = maximum; length > 0; length -= 1) {
    if (PTY_CURSOR_POSITION_QUERY.startsWith(value.slice(-length))) return length;
  }
  return 0;
}

export function createPtyTerminalResponseFilter(): PtyTerminalResponseFilter {
  let pending = "";

  return {
    consume(data) {
      const input = pending + data;
      const responses: string[] = [];
      let output = "";
      let cursor = 0;
      pending = "";

      for (;;) {
        const queryIndex = input.indexOf(PTY_CURSOR_POSITION_QUERY, cursor);
        if (queryIndex < 0) break;
        output += input.slice(cursor, queryIndex);
        responses.push(PTY_CURSOR_POSITION_RESPONSE);
        cursor = queryIndex + PTY_CURSOR_POSITION_QUERY.length;
      }

      const remainder = input.slice(cursor);
      const pendingLength = findPendingQueryPrefixLength(remainder);
      output += remainder.slice(0, remainder.length - pendingLength);
      pending = pendingLength > 0 ? remainder.slice(-pendingLength) : "";
      return { output, responses };
    },
    flush() {
      const output = pending;
      pending = "";
      return output;
    },
  };
}
