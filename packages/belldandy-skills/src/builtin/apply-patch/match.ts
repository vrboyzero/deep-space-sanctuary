import * as fs from "node:fs/promises";
import type { UpdateFileChunk } from "./dsl.js";

export class ApplyPatchMatchError extends Error {
    override readonly name = "ApplyPatchMatchError";
}

// 规范化标点符号，用于最宽容的匹配模式
function normalizePunctuation(value: string): string {
    return Array.from(value)
        .map((char) => {
            switch (char) {
                case "\u2010":
                case "\u2011":
                case "\u2012":
                case "\u2013":
                case "\u2014":
                case "\u2015":
                case "\u2212":
                    return "-";
                case "\u2018":
                case "\u2019":
                case "\u201A":
                case "\u201B":
                    return "'";
                case "\u201C":
                case "\u201D":
                case "\u201E":
                case "\u201F":
                    return '"';
                case "\u00A0":
                case "\u2002":
                case "\u2003":
                case "\u2004":
                case "\u2005":
                case "\u2006":
                case "\u2007":
                case "\u2008":
                case "\u2009":
                case "\u200A":
                case "\u202F":
                case "\u205F":
                case "\u3000":
                    return " ";
                default:
                    return char;
            }
        })
        .join("");
}

// 检查行是否匹配
function linesMatch(
    lines: string[],
    pattern: string[],
    start: number,
    normalize: (value: string) => string
): boolean {
    for (let idx = 0; idx < pattern.length; idx += 1) {
        if (start + idx >= lines.length) return false;
        if (normalize(lines[start + idx]!) !== normalize(pattern[idx]!)) {
            return false;
        }
    }
    return true;
}

// 寻找序列（支持 4 级降级匹配）
function seekSequence(
    lines: string[],
    pattern: string[],
    start: number,
    eof: boolean
): number | null {
    if (pattern.length === 0) return start;
    if (pattern.length > lines.length) return null;

    const maxStart = lines.length - pattern.length;
    // 如果是 EOF 模式，优先检查文件末尾
    const searchStart = eof && lines.length >= pattern.length ? maxStart : start;

    if (searchStart > maxStart) return null;

    // Level 1: 精确匹配 (Exact match)
    for (let i = searchStart; i <= maxStart; i += 1) {
        if (linesMatch(lines, pattern, i, (value) => value)) return i;
    }

    // Level 2: 忽略行尾空白 (Trim End)
    for (let i = searchStart; i <= maxStart; i += 1) {
        if (linesMatch(lines, pattern, i, (value) => value.trimEnd())) return i;
    }

    // Level 3: 忽略首尾空白 (Trim)
    for (let i = searchStart; i <= maxStart; i += 1) {
        if (linesMatch(lines, pattern, i, (value) => value.trim())) return i;
    }

    // Level 4: 规范化标点符号 (Normalize Punctuation)
    for (let i = searchStart; i <= maxStart; i += 1) {
        if (linesMatch(lines, pattern, i, (value) => normalizePunctuation(value.trim()))) {
            return i;
        }
    }

    return null;
}

function stripEscapedCarriageReturn(value: string): string {
    return value.endsWith("\\r") ? value.slice(0, -2) : value;
}

function normalizeModelEscapedCarriageReturns(
    originalLines: string[],
    chunk: UpdateFileChunk,
): UpdateFileChunk {
    const nonEmptyOldLines = chunk.oldLines.filter((line) => line.length > 0);
    if (nonEmptyOldLines.length === 0 || nonEmptyOldLines.some((line) => !line.endsWith("\\r"))) {
        return chunk;
    }

    const normalizedOldLines = chunk.oldLines.map(stripEscapedCarriageReturn);
    if (seekSequence(originalLines, normalizedOldLines, 0, chunk.isEndOfFile) === null) {
        return chunk;
    }

    // file_read 的 JSON 内容会把 CRLF 表示为 \r\n；模型有时会把其中的 \r 当成补丁正文。
    // 只有旧行去掉该标记后确实匹配目标文件时，才同步归一化新增行。
    return {
        ...chunk,
        ...(chunk.changeContext?.endsWith("\\r")
            ? { changeContext: stripEscapedCarriageReturn(chunk.changeContext) }
            : {}),
        oldLines: normalizedOldLines,
        newLines: chunk.newLines.map(stripEscapedCarriageReturn),
    };
}

// 计算替换操作
function computeReplacements(
    originalLines: string[],
    filePath: string,
    chunks: UpdateFileChunk[]
): Array<[number, number, string[]]> {
    const replacements: Array<[number, number, string[]]> = [];
    let lineIndex = 0;

    for (const chunk of chunks) {
        // 1. 如果有 changeContext，先定位上下文
        if (chunk.changeContext) {
            const ctxIndex = seekSequence(originalLines, [chunk.changeContext], lineIndex, false);
            if (ctxIndex === null) {
                throw new ApplyPatchMatchError(`Failed to find context '${chunk.changeContext}' in ${filePath}`);
            }
            lineIndex = ctxIndex + 1;
        }

        // 2. 如果 oldLines 为空，说明是插入操作
        if (chunk.oldLines.length === 0) {
            const insertionIndex =
                originalLines.length > 0 && originalLines[originalLines.length - 1] === ""
                    ? originalLines.length - 1
                    : originalLines.length;
            replacements.push([insertionIndex, 0, chunk.newLines]);
            continue;
        }

        // 3. 寻找要替换的 oldLines 块
        let pattern = chunk.oldLines;
        let newSlice = chunk.newLines;
        let found = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile);

        // 尝试容错：如果找不到且 pattern 最后一行是空行，尝试去掉它再找
        if (found === null && pattern.length > 0 && pattern[pattern.length - 1] === "") {
            pattern = pattern.slice(0, -1);
            // 对应的 newSlice 如果末尾也是空行，也尽量保持一致去掉
            if (newSlice.length > 0 && newSlice[newSlice.length - 1] === "") {
                newSlice = newSlice.slice(0, -1);
            }
            found = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile);
        }

        if (found === null) {
            throw new ApplyPatchMatchError(
                `Failed to find expected lines in ${filePath}:\n${chunk.oldLines.join("\n")}`
            );
        }

        replacements.push([found, pattern.length, newSlice]);
        lineIndex = found + pattern.length;
    }

    // 按起始位置排序，确保替换顺序
    replacements.sort((a, b) => a[0] - b[0]);
    return replacements;
}

// 应用替换并生成最终内容
function applyReplacements(
    lines: string[],
    replacements: Array<[number, number, string[]]>
): string[] {
    const result = [...lines];
    // 倒序应用替换，这样前面的替换不会影响后面替换的索引
    for (const [startIndex, oldLen, newLines] of [...replacements].reverse()) {
        // 删除旧行
        if (startIndex < result.length) {
            result.splice(startIndex, oldLen);
        }
        // 插入新行
        result.splice(startIndex, 0, ...newLines);
    }
    return result;
}

/**
 * 将一系列 UpdateFileChunk 应用到文件
 */
export async function applyUpdateChunks(
    filePath: string,
    chunks: UpdateFileChunk[]
): Promise<{ originalContent: string; newContent: string }> {
    const originalContents = await fs.readFile(filePath, "utf8").catch((err) => {
        throw new Error(`Failed to read file to update ${filePath}: ${err}`);
    });
    const newline = originalContents.includes("\r\n") ? "\r\n" : "\n";

    const originalLines = originalContents.split(/\r?\n/);
    // 移除文件末尾可能的单一空行（Split 产生的副作用），以便于处理
    if (originalLines.length > 0 && originalLines[originalLines.length - 1] === "") {
        originalLines.pop();
    }

    const normalizedChunks = newline === "\r\n"
        ? chunks.map((chunk) => normalizeModelEscapedCarriageReturns(originalLines, chunk))
        : chunks;
    const replacements = computeReplacements(originalLines, filePath, normalizedChunks);
    let newLines = applyReplacements(originalLines, replacements);

    // 确保文件以换行符结尾（POSIX 标准）
    if (newLines.length === 0 || newLines[newLines.length - 1] !== "") {
        newLines.push("");
    }

    return {
        originalContent: originalContents,
        newContent: newLines.join(newline),
    };
}
