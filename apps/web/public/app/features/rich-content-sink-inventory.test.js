import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const webPublicDirectory = fileURLToPath(new URL("../../", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const coreHttpRoutesSource = fs.readFileSync(
  path.join(repositoryRoot, "packages/belldandy-core/src/server-http-routes.ts"),
  "utf8",
);
const securityFixtureSource = fs.readFileSync(
  path.join(repositoryRoot, "scripts/verify-webchat-security-policy.mjs"),
  "utf8",
);

const RICH_CONTENT_SINKS = new Map([
  [
    "app/features/rich-content-renderer.js:innerHTML:template:createTrustedRichHtml(sanitized)",
    "rich_content_sanitizer",
  ],
  [
    "app/features/chat-ui.js:innerHTML:body:sanitizedHtml",
    "rich_content_commit",
  ],
]);
const astPrinter = ts.createPrinter({
  newLine: ts.NewLineKind.LineFeed,
  removeComments: true,
});

function reviewedBaseline(clear, reviewedStructuredTemplate, staticTemplate, identityDigest, {
  richContentCommit = 0,
  richContentSanitizer = 0,
} = {}) {
  return {
    clear,
    richContentCommit,
    richContentSanitizer,
    reviewedStructuredTemplate,
    staticTemplate,
    identityDigest,
  };
}

// Counts are paired with a digest of the AST-level sink identities. Any new or moved sink must
// be reviewed and explicitly assigned to clear/static/structured/rich-content before it lands.
const REVIEWED_PRODUCTION_SINK_BASELINE = {
  "app.js": reviewedBaseline(1, 0, 0, "9384d71c8ffcae8f51038a69a4d843bd1de863f7cc0f924263730af8b81488d9"),
  "app/features/agent-runtime.js": reviewedBaseline(3, 0, 0, "7ff651802b017dc4edcdc5cabe30316a282abb02b4d3d7a2a27b06ae0ea58b64"),
  "app/features/assistant-mode-settings-view-model.js": reviewedBaseline(1, 0, 0, "e1225418b5c2940a575662f4682cbe05134545bf44e254e47111a25865c90aab"),
  "app/features/canvas-context.js": reviewedBaseline(2, 0, 0, "91ce12b6df360d40575f040e4326979b40d0866d4fe6c44e27de851d33b69d56"),
  "app/features/chat-network.js": reviewedBaseline(2, 0, 0, "912316973268a78c35242920da707e7387123146d40eace05b235e3b94d6ce6b"),
  "app/features/chat-ui.js": reviewedBaseline(0, 0, 0, "70eaeac7e2681705a979b636c1c170ed25ea829d48a7a8f34bd79aac1e91fd0a", { richContentCommit: 1 }),
  "app/features/experience-workbench.js": reviewedBaseline(0, 1, 0, "b5810b691634ed84e623d1e00603e1d37704787257419e1f2f3686761ff5be55"),
  "app/features/goals-overview.js": reviewedBaseline(3, 0, 0, "6cae1ac21873126a06973d6f3f85beb72de479622e256afde014f6921243b1e1"),
  "app/features/memory-detail-render.js": reviewedBaseline(0, 1, 0, "59eddd83df8322185e452223237a1a91eb07847c28e004ede6ab2ca460a09000"),
  "app/features/memory-viewer.js": reviewedBaseline(0, 4, 0, "a900f30425b8c0d01c39a01f7b6c4a4bc779ddc842cfea534acfed8a93dc3a59"),
  "app/features/rich-content-renderer.js": reviewedBaseline(0, 0, 0, "b8c0825bb2d64026a817de36b1bfd69d473046de2f31902cdd9af0ab578f1929", { richContentSanitizer: 1 }),
  "app/features/session-navigation.js": reviewedBaseline(1, 0, 0, "043f7b6d079f96d1257fc972f183a35bbc76dafdb0df7b7f0d273b50d64289c8"),
  "app/features/settings.js": reviewedBaseline(2, 0, 0, "ade689f963d4c5892ecb35ab137fd194199ee81f09ee82cd1015130e7cd7cabd"),
  "canvas.js": reviewedBaseline(4, 0, 0, "2caa2c8b0d087c3e7d2b2e41f6c10035a2fabbdf40d734ff2ab33423d48a2802"),
};

function listProductionJavaScriptFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "assets" || entry.name === "dist") continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listProductionJavaScriptFiles(entryPath));
    } else if (entry.name.endsWith(".js") && !entry.name.endsWith(".test.js")) {
      files.push(entryPath);
    }
  }
  return files.sort();
}

function propertyName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return null;
}

function receiverText(node, sourceFile) {
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    return astPrinter.printNode(ts.EmitHint.Expression, node.expression, sourceFile).trim();
  }
  return "unknown";
}

function isDocumentWrite(node) {
  return ts.isPropertyAccessExpression(node.expression)
    && node.expression.expression.getText(node.getSourceFile()) === "document"
    && node.expression.name.text === "write";
}

function classifySink(sink) {
  const richContentKind = RICH_CONTENT_SINKS.get(sink.identity);
  if (richContentKind) return richContentKind;
  if (sink.valueText === "\"\"" || sink.valueText === "''" || sink.valueText === "``") return "clear";
  if (sink.valueKind === "StringLiteral" || sink.valueKind === "NoSubstitutionTemplateLiteral") return "static_template";
  return "reviewed_structured_template";
}

function collectHtmlSinks(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const relativePath = path.relative(webPublicDirectory, filePath).replaceAll("\\", "/");
  const sourceFile = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const sinks = [];

  function addSink(kind, targetNode, valueNode) {
    const target = receiverText(targetNode, sourceFile);
    const valueText = valueNode
      ? astPrinter.printNode(ts.EmitHint.Expression, valueNode, sourceFile).trim()
      : "<missing>";
    const identity = `${relativePath}:${kind}:${target}:${valueText}`;
    sinks.push({
      file: relativePath,
      identity,
      kind,
      target,
      valueKind: valueNode ? ts.SyntaxKind[valueNode.kind] : "Missing",
      valueText,
    });
  }

  function visit(node) {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const name = propertyName(node.left);
      if (name === "innerHTML" || name === "outerHTML" || name === "srcdoc") {
        addSink(name, node.left, node.right);
      }
    } else if (ts.isCallExpression(node)) {
      const name = propertyName(node.expression);
      if (name === "insertAdjacentHTML" || name === "createContextualFragment" || name === "setHTML") {
        addSink(name, node.expression, node.arguments.at(-1));
      } else if (isDocumentWrite(node)) {
        addSink("document.write", node.expression, node.arguments.at(0));
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return sinks;
}

function buildInventory() {
  const sinks = listProductionJavaScriptFiles(webPublicDirectory).flatMap(collectHtmlSinks);
  const byFile = {};
  for (const sink of sinks) {
    const classification = classifySink(sink);
    const entry = byFile[sink.file] ?? {
      clear: 0,
      rich_content_commit: 0,
      rich_content_sanitizer: 0,
      reviewed_structured_template: 0,
      static_template: 0,
      identities: [],
    };
    entry[classification] += 1;
    entry.identities.push(sink.identity);
    byFile[sink.file] = entry;
  }

  return Object.fromEntries(Object.entries(byFile).map(([file, entry]) => {
    const identities = entry.identities.sort();
    return [file, {
      clear: entry.clear,
      richContentCommit: entry.rich_content_commit,
      richContentSanitizer: entry.rich_content_sanitizer,
      reviewedStructuredTemplate: entry.reviewed_structured_template,
      staticTemplate: entry.static_template,
      identityDigest: crypto.createHash("sha256").update(identities.join("\n")).digest("hex"),
    }];
  }));
}

describe("WebChat production HTML sink inventory", () => {
  it("fails closed when a production HTML sink is added, moved, or reclassified", () => {
    const inventory = buildInventory();
    expect(inventory).toEqual(REVIEWED_PRODUCTION_SINK_BASELINE);

    const totals = Object.values(inventory).reduce((summary, entry) => ({
      clear: summary.clear + entry.clear,
      richContent: summary.richContent + entry.richContentCommit + entry.richContentSanitizer,
      reviewedStructuredTemplate: summary.reviewedStructuredTemplate + entry.reviewedStructuredTemplate,
      staticTemplate: summary.staticTemplate + entry.staticTemplate,
    }), { clear: 0, richContent: 0, reviewedStructuredTemplate: 0, staticTemplate: 0 });
    expect({ files: Object.keys(inventory).length, ...totals }).toEqual({
      files: 14,
      clear: 19,
      richContent: 2,
      reviewedStructuredTemplate: 6,
      staticTemplate: 0,
    });
  });

  it("keeps model and Tool rich content behind the sanitizer and its sole commit point", () => {
    const richContentRendererSource = fs.readFileSync(
      path.join(webPublicDirectory, "app/features/rich-content-renderer.js"),
      "utf8",
    );
    const chatUiSource = fs.readFileSync(
      path.join(webPublicDirectory, "app/features/chat-ui.js"),
      "utf8",
    );

    expect(richContentRendererSource).toContain('const RICH_CONTENT_TRUSTED_TYPES_POLICY_NAME = "belldandy-rich-content";');
    expect(richContentRendererSource).toContain("purifier.sanitize(content");
    expect(richContentRendererSource).toContain("template.innerHTML = createTrustedRichHtml(sanitized);");
    expect(chatUiSource).toContain('from "./rich-content-renderer.js";');
    expect(chatUiSource.match(/body\.innerHTML = sanitizedHtml;/g)).toHaveLength(1);
  });

  it("records enforced Gateway CSP and the narrower Trusted Types browser fixture", () => {
    expect(coreHttpRoutesSource).toContain('res.setHeader("Content-Security-Policy", WEBCHAT_CSP);');
    expect(coreHttpRoutesSource).not.toContain('res.setHeader("Content-Security-Policy-Report-Only"');
    expect(securityFixtureSource).toContain("trusted-types belldandy-web-assets belldandy-rich-content dompurify");
    expect(securityFixtureSource).toContain("require-trusted-types-for 'script'");
    expect(securityFixtureSource).toContain("/__webchat-rich-content-fixture__.html");
  });
});
