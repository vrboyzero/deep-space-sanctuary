const DEFAULT_MAX_STREAM_CHARS = 32_000;

/**
 * 单独输出模型增量，保持工具参数和工具输出不进入编辑器可见流；固定上限避免长运行无限占用 OutputChannel。
 */
function createCodingRunStreamOutput(channel, options = {}) {
  const maxChars = normalizeMaxChars(options.maxChars);
  let writtenChars = 0;
  let truncated = false;

  return {
    reset() {
      writtenChars = 0;
      truncated = false;
      channel.clear();
    },
    appendEvent(event) {
      if (event?.type !== "message.delta" || typeof event?.payload?.delta !== "string") return false;
      const delta = event.payload.delta.replace(/\u0000/g, "");
      if (!delta) return true;
      const remaining = maxChars - writtenChars;
      if (remaining > 0) {
        const visible = delta.slice(0, remaining);
        channel.append(visible);
        writtenChars += visible.length;
      }
      if (writtenChars >= maxChars && !truncated) {
        truncated = true;
        channel.appendLine("\n[coding-run stream truncated]");
      }
      return true;
    },
  };
}

function normalizeMaxChars(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_MAX_STREAM_CHARS;
}

module.exports = { createCodingRunStreamOutput };
