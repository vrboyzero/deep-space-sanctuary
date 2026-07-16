import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

export interface ContentExtractionResult {
    title: string;
    content: string; // Markdown or Text
    excerpt?: string;
    byline?: string;
    siteName?: string;
}

export interface BestContentOptions {
    html: string;
    url: string;
    title?: string;
    bodyText?: string;
}

type StructuredListItem = {
    title: string;
    url?: string;
    meta?: string;
    description?: string;
};

const FOOTER_PATTERNS = [
    /备案/i,
    /增值电信业务经营许可证/i,
    /网络文化经营许可证/i,
    /广播电视节目制作经营许可证/i,
    /营业执照/i,
    /违法和不良信息举报/i,
];

function createTurndownService(): TurndownService {
    return new TurndownService({
        headingStyle: "atx",
        codeBlockStyle: "fenced",
    });
}

function normalizeWhitespace(text: string | undefined): string {
    return (text ?? "").replace(/\u00a0/g, " ").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
}

function normalizeMultilineText(text: string | undefined): string {
    return (text ?? "")
        .replace(/\u00a0/g, " ")
        .replace(/\r/g, "")
        .split("\n")
        .map(line => normalizeWhitespace(line))
        .filter(Boolean)
        .join("\n");
}

function markdownToPlainText(markdown: string): string {
    return normalizeWhitespace(
        markdown
            .replace(/```[\s\S]*?```/g, " ")
            .replace(/`([^`]+)`/g, "$1")
            .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
            .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
            .replace(/[#>*_\-]+/g, " ")
    );
}

function stripCommonFooter(text: string | undefined): string {
    const normalized = normalizeMultilineText(text);
    if (!normalized) {
        return "";
    }

    const footerIndexes = FOOTER_PATTERNS
        .map(pattern => normalized.search(pattern))
        .filter(index => index >= 0);

    if (footerIndexes.length === 0) {
        return normalized;
    }

    return normalized.slice(0, Math.min(...footerIndexes)).trim();
}

function extractTextFromHtml(html: string, url: string): string {
    const dom = new JSDOM(html, { url });
    return normalizeMultilineText(dom.window.document.body?.textContent ?? "");
}

function getComparableUrl(url: string | undefined): string {
    if (!url) return "";
    try {
        const parsed = new URL(url);
        parsed.hash = "";
        return parsed.toString();
    } catch {
        return url.trim();
    }
}

function getHost(url: string): string {
    try {
        return new URL(url).hostname.toLowerCase();
    } catch {
        return "";
    }
}

function getTextFromElement(el: Element | null | undefined): string {
    if (!el) return "";
    const nodeText = normalizeWhitespace(el.textContent ?? "");
    const attrTitle = normalizeWhitespace(el.getAttribute("title") ?? "");
    return attrTitle.length > nodeText.length ? attrTitle : nodeText;
}

function getFirstText(root: ParentNode, selectors: string[]): string {
    for (const selector of selectors) {
        const text = getTextFromElement(root.querySelector(selector));
        if (text) return text;
    }
    return "";
}

function getFirstLink(root: ParentNode, selectors: string[], baseUrl: string): string | undefined {
    for (const selector of selectors) {
        const anchor = root.querySelector(selector) as HTMLAnchorElement | null;
        const href = normalizeWhitespace(anchor?.getAttribute("href") ?? anchor?.href ?? "");
        if (!href || href.startsWith("javascript:") || href.startsWith("#")) continue;
        try {
            return new URL(href, baseUrl).toString();
        } catch {
            continue;
        }
    }
    return undefined;
}

function buildStructuredListContent(title: string, items: StructuredListItem[], siteName?: string): ContentExtractionResult | null {
    const uniqueItems = items.filter((item, index, arr) => {
        const key = `${item.title}::${item.url ?? ""}`;
        return arr.findIndex(candidate => `${candidate.title}::${candidate.url ?? ""}` === key) === index;
    });

    if (uniqueItems.length === 0) {
        return null;
    }

    const lines = uniqueItems.slice(0, 10).map((item, index) => {
        const header = item.url
            ? `${index + 1}. [${item.title}](${item.url})`
            : `${index + 1}. ${item.title}`;
        const meta = item.meta ? `   ${item.meta}` : "";
        const description = item.description ? `   ${item.description}` : "";
        return [header, meta, description].filter(Boolean).join("\n");
    });

    return {
        title,
        content: `## Search Results\n\n${lines.join("\n\n")}`,
        siteName,
    };
}

export function extractReadabilityContent(html: string, url: string): ContentExtractionResult | null {
    const doc = new JSDOM(html, { url });
    const reader = new Readability(doc.window.document);
    const article = reader.parse();

    // Readability 0.6 exposes nullable fields; keep this Adapter's stable result contract at the boundary.
    if (!article?.content) return null;

    const markdown = createTurndownService().turndown(article.content);

    return {
        title: article.title ?? "",
        content: markdown,
        excerpt: article.excerpt ?? undefined,
        byline: article.byline ?? undefined,
        siteName: article.siteName ?? undefined,
    };
}

export function isReadabilityContentUsable(result: ContentExtractionResult | null, bodyText?: string): boolean {
    if (!result) {
        return false;
    }

    const extractedText = markdownToPlainText(result.content);
    const body = normalizeWhitespace(bodyText);

    if (!extractedText) {
        return false;
    }

    const footerHeavy = FOOTER_PATTERNS.some(pattern => pattern.test(extractedText));
    if (footerHeavy && extractedText.length < 500) {
        return false;
    }

    if (body.length > 600 && extractedText.length < 220) {
        return false;
    }

    if (body.length > 800 && extractedText.length / body.length < 0.18) {
        return false;
    }

    return true;
}

export function extractBilibiliSearchContent(html: string, url: string): ContentExtractionResult | null {
    const host = getHost(url);
    if (!host.includes("bilibili.com")) {
        return null;
    }

    const dom = new JSDOM(html, { url });
    const doc = dom.window.document;
    const isSearchPage = host.startsWith("search.") || /[?&]keyword=/i.test(url) || doc.title.includes("搜索");
    if (!isSearchPage) {
        return null;
    }

    const cardSelectors = [
        ".bili-video-card",
        ".video-list-item",
        ".search-all-list .video-item",
        ".search-page .video-item",
        ".search-page .bili-video-card",
    ];

    const cards = Array.from(doc.querySelectorAll(cardSelectors.join(", ")));
    if (cards.length === 0) {
        return null;
    }

    const items: StructuredListItem[] = cards.map((card) => {
        const title = getFirstText(card, [
            ".bili-video-card__info--tit",
            ".bili-video-card__info--title",
            ".title",
            "h3",
            "a[title]",
            "a",
        ]);
        const href = getFirstLink(card, [
            "a[href*=\"/video/\"]",
            "a[href*=\"www.bilibili.com/video/\"]",
            "a[href]",
        ], url);
        const author = getFirstText(card, [
            ".bili-video-card__info--author",
            ".up-name",
            ".bili-video-card__info--owner",
            ".author",
        ]);
        const meta = getFirstText(card, [
            ".bili-video-card__stats",
            ".bili-video-card__info--bottom",
            ".meta",
            ".bili-video-card__info--date",
        ]);
        const description = getFirstText(card, [
            ".bili-video-card__info--desc",
            ".desc",
            ".bili-video-card__info--subtitle",
        ]);

        const mergedMeta = [author, meta].filter(Boolean).join(" | ");

        return {
            title,
            url: href,
            meta: mergedMeta || undefined,
            description: description || undefined,
        };
    }).filter(item => item.title);

    if (items.length < 3) {
        return null;
    }

    return buildStructuredListContent(doc.title || "Bilibili Search", items, "bilibili");
}

export function extractGenericListContent(html: string, url: string): ContentExtractionResult | null {
    const dom = new JSDOM(html, { url });
    const doc = dom.window.document;

    const items = Array.from(doc.querySelectorAll([
        "main article a[href]",
        "main li a[href]",
        "[role=\"main\"] article a[href]",
        "[role=\"main\"] li a[href]",
        ".results a[href]",
        ".result-list a[href]",
        ".search-result a[href]",
        ".card a[href]",
        ".item a[href]",
    ].join(", "))).map((anchor) => {
        const title = getTextFromElement(anchor);
        const href = getFirstLink(anchor, [":scope"], url);
        const meta = getFirstText(anchor.closest("article, li, .card, .item") ?? anchor, [
            ".meta",
            ".subtitle",
            ".description",
            "time",
        ]);

        return {
            title,
            url: href,
            meta: meta || undefined,
        };
    }).filter(item => item.title.length >= 6 && item.url);

    if (items.length < 5) {
        return null;
    }

    return buildStructuredListContent(doc.title || "List Page", items);
}

export function extractBestContent(options: BestContentOptions): ContentExtractionResult | null {
    const readability = extractReadabilityContent(options.html, options.url);
    const readabilityUsable = isReadabilityContentUsable(readability, options.bodyText);
    const bilibiliSearch = extractBilibiliSearchContent(options.html, options.url);

    if (bilibiliSearch) {
        return bilibiliSearch;
    }

    if (readabilityUsable && readability) {
        return readability;
    }

    const genericList = extractGenericListContent(options.html, options.url);
    if (genericList) {
        return genericList;
    }

    const cleanedText = stripCommonFooter(options.bodyText || extractTextFromHtml(options.html, options.url));
    if (cleanedText) {
        return {
            title: options.title || readability?.title || "",
            content: cleanedText,
            excerpt: readability?.excerpt,
            byline: readability?.byline,
            siteName: readability?.siteName,
        };
    }

    return readability;
}

export function htmlToMarkdown(html: string): string {
    return createTurndownService().turndown(html);
}

export function getComparablePageUrl(url: string | undefined): string {
    return getComparableUrl(url);
}
