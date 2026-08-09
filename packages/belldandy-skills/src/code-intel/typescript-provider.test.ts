import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CodeIntel,
  TypeScriptLanguageServiceProvider,
} from "./index.js";

const temporaryRoots: string[] = [];
const facades: CodeIntel[] = [];

afterEach(async () => {
  for (const facade of facades.splice(0)) {
    facade.dispose();
  }
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("TypeScriptLanguageServiceProvider", () => {
  it("answers symbol and definition queries through the language-neutral facade", async () => {
    const fixture = await createTypeScriptFixture();
    const codeIntel = createFacade();

    const symbols = await codeIntel.query({
      workspace: { rootPath: fixture.root, revision: "revision-1" },
      operation: "symbols",
      query: "createGreeter",
      requiredCapability: "semantic",
      deadlineAtMs: 2_000,
    });
    const definition = await codeIntel.query({
      workspace: { rootPath: fixture.root, revision: "revision-1" },
      operation: "definition",
      location: {
        path: "src/caller.ts",
        ...positionOf(fixture.callerSource, "createGreeter", { last: true }),
      },
      requiredCapability: "semantic-live",
      deadlineAtMs: 2_000,
    });

    expect(symbols).toMatchObject({
      ok: true,
      result: {
        status: "completed",
        items: [{
          location: {
            scope: "workspace",
            path: "src/alpha.ts",
            range: {
              start: positionOf(fixture.alphaSource, "createGreeter"),
              end: positionOf(fixture.alphaSource, "createGreeter", { end: true }),
            },
          },
          symbolKind: "function",
          documentRevision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        }],
        freshness: { status: "fresh" },
        provenance: {
          providerId: "typescript-language-service",
          capability: "semantic-live",
          workspaceRevision: "revision-1",
        },
      },
    });
    expect(definition).toMatchObject({
      ok: true,
      result: {
        items: [{
          location: { scope: "workspace", path: "src/alpha.ts" },
          symbolKind: "function",
        }],
        freshness: { status: "fresh" },
      },
    });
  });

  it("answers references and implementations across workspace files", async () => {
    const fixture = await createTypeScriptFixture();
    const codeIntel = createFacade();
    const greeterDeclaration = positionOf(fixture.alphaSource, "Greeter");

    const references = await codeIntel.query({
      workspace: { rootPath: fixture.root, revision: "revision-1" },
      operation: "references",
      location: { path: "src/alpha.ts", ...greeterDeclaration },
      requiredCapability: "semantic-live",
      deadlineAtMs: 2_000,
    });
    const implementation = await codeIntel.query({
      workspace: { rootPath: fixture.root, revision: "revision-1" },
      operation: "implementation",
      location: { path: "src/alpha.ts", ...greeterDeclaration },
      requiredCapability: "semantic-live",
      deadlineAtMs: 2_000,
    });

    expect(references).toMatchObject({
      ok: true,
      result: {
        items: expect.arrayContaining([
          expect.objectContaining({ location: expect.objectContaining({ path: "src/caller.ts" }) }),
        ]),
      },
    });
    expect(implementation).toMatchObject({
      ok: true,
      result: {
        items: [expect.objectContaining({
          location: expect.objectContaining({ path: "src/alpha.ts" }),
          symbolKind: "class",
        })],
      },
    });
  });

  it("paginates symbol results and reloads snapshots when the workspace revision changes", async () => {
    const fixture = await createTypeScriptFixture();
    const codeIntel = createFacade();
    const firstPage = await codeIntel.query({
      workspace: { rootPath: fixture.root, revision: "revision-1" },
      operation: "symbols",
      query: "Greeter",
      requiredCapability: "semantic-live",
      deadlineAtMs: 2_000,
      limit: 1,
    });
    expect(firstPage).toMatchObject({
      ok: true,
      result: { status: "partial", page: { returned: 1, truncated: true, nextCursor: expect.any(String) } },
    });
    if (!firstPage.ok || !firstPage.result.page.nextCursor) {
      throw new Error("Expected a continuation cursor.");
    }
    const secondPage = await codeIntel.query({
      workspace: { rootPath: fixture.root, revision: "revision-1" },
      operation: "symbols",
      query: "Greeter",
      requiredCapability: "semantic-live",
      deadlineAtMs: 2_000,
      limit: 1,
      cursor: firstPage.result.page.nextCursor,
    });
    expect(secondPage).toMatchObject({ ok: true, result: { page: { returned: 1 } } });
    if (!secondPage.ok) {
      throw new Error("Expected a second symbol page.");
    }
    expect(secondPage.result.items[0]).not.toEqual(firstPage.result.items[0]);

    const firstDefinition = await codeIntel.query({
      workspace: { rootPath: fixture.root, revision: "revision-1" },
      operation: "definition",
      location: {
        path: "src/caller.ts",
        ...positionOf(fixture.callerSource, "createGreeter", { last: true }),
      },
      requiredCapability: "semantic-live",
      deadlineAtMs: 2_000,
    });
    const changedAlphaSource = `// revision 2\n${fixture.alphaSource}`;
    await writeFile(path.join(fixture.root, "src", "alpha.ts"), changedAlphaSource, "utf-8");
    const reloadedDefinition = await codeIntel.query({
      workspace: { rootPath: fixture.root, revision: "revision-2" },
      operation: "definition",
      location: {
        path: "src/caller.ts",
        ...positionOf(fixture.callerSource, "createGreeter", { last: true }),
      },
      requiredCapability: "semantic-live",
      deadlineAtMs: 2_000,
    });
    expect(firstDefinition).toMatchObject({ ok: true, result: { items: [{ documentRevision: expect.any(String) }] } });
    expect(reloadedDefinition).toMatchObject({
      ok: true,
      result: { provenance: { workspaceRevision: "revision-2" }, items: [{ documentRevision: expect.any(String) }] },
    });
    if (!firstDefinition.ok || !reloadedDefinition.ok) {
      throw new Error("Expected definition evidence before and after reload.");
    }
    expect(reloadedDefinition.result.items[0]?.documentRevision)
      .not.toBe(firstDefinition.result.items[0]?.documentRevision);
  });

  it("releases Provider sessions when the facade is disposed", async () => {
    const fixture = await createTypeScriptFixture();
    const codeIntel = new CodeIntel({
      providers: [new TypeScriptLanguageServiceProvider()],
      now: () => 1_000,
    });
    await codeIntel.query({
      workspace: { rootPath: fixture.root, revision: "revision-1" },
      operation: "symbols",
      query: "createGreeter",
      requiredCapability: "semantic",
      deadlineAtMs: 2_000,
    });
    codeIntel.dispose();

    const outcome = await codeIntel.query({
      workspace: { rootPath: fixture.root, revision: "revision-1" },
      operation: "symbols",
      query: "createGreeter",
      requiredCapability: "semantic",
      deadlineAtMs: 2_000,
    });
    expect(outcome).toEqual({
      ok: false,
      error: {
        code: "provider_failure",
        message: "CodeIntel Provider failed to answer the query.",
        retryable: true,
        providerId: "typescript-language-service",
      },
    });
  });

  it("observes bounded session reuse, LRU eviction, revision reload, and disposal", async () => {
    const fixtures = await Promise.all([
      createTypeScriptFixture(),
      createTypeScriptFixture(),
      createTypeScriptFixture(),
    ]);
    const events: Array<{
      type: string;
      reason: string;
      workspaceRevision: string;
      activeSessions: number;
    }> = [];
    const provider = new TypeScriptLanguageServiceProvider({
      maxWorkspaceSessions: 2,
      onResourceEvent: (event) => events.push(event),
    });
    const codeIntel = new CodeIntel({ providers: [provider], now: () => 1_000 });
    facades.push(codeIntel);

    const query = async (fixture: Awaited<ReturnType<typeof createTypeScriptFixture>>, revision: string) => {
      const outcome = await codeIntel.query({
        workspace: { rootPath: fixture.root, revision },
        operation: "symbols",
        query: "createGreeter",
        requiredCapability: "semantic-live",
        deadlineAtMs: 2_000,
      });
      expect(outcome).toMatchObject({ ok: true });
    };

    await query(fixtures[0], "revision-a1");
    await query(fixtures[1], "revision-b1");
    await query(fixtures[0], "revision-a1");
    await query(fixtures[2], "revision-c1");
    await query(fixtures[0], "revision-a2");
    codeIntel.dispose();

    expect(events).toEqual([
      { type: "session-created", reason: "cache-miss", workspaceRevision: "revision-a1", activeSessions: 1 },
      { type: "session-created", reason: "cache-miss", workspaceRevision: "revision-b1", activeSessions: 2 },
      { type: "session-reused", reason: "cache-hit", workspaceRevision: "revision-a1", activeSessions: 2 },
      { type: "session-disposed", reason: "lru-eviction", workspaceRevision: "revision-b1", activeSessions: 1 },
      { type: "session-created", reason: "cache-miss", workspaceRevision: "revision-c1", activeSessions: 2 },
      { type: "session-disposed", reason: "revision-reload", workspaceRevision: "revision-a1", activeSessions: 1 },
      { type: "session-created", reason: "cache-miss", workspaceRevision: "revision-a2", activeSessions: 2 },
      { type: "session-disposed", reason: "provider-dispose", workspaceRevision: "revision-c1", activeSessions: 1 },
      { type: "session-disposed", reason: "provider-dispose", workspaceRevision: "revision-a2", activeSessions: 0 },
    ]);
    expect(Math.max(...events.map((event) => event.activeSessions))).toBe(2);
  });

  it("covers JavaScript, JSX, TypeScript, and TSX files in one configured project", async () => {
    const fixture = await createMixedTypeScriptFixture();
    const codeIntel = createFacade();

    const jsDefinition = await codeIntel.query({
      workspace: { rootPath: fixture.root, revision: "mixed-revision-1" },
      operation: "definition",
      location: {
        path: "src/caller.ts",
        ...positionOf(fixture.callerSource, "jsHelper", { last: true }),
      },
      requiredCapability: "semantic-live",
      deadlineAtMs: 2_000,
    });
    const jsxDefinition = await codeIntel.query({
      workspace: { rootPath: fixture.root, revision: "mixed-revision-1" },
      operation: "definition",
      location: {
        path: "src/panel-jsx.jsx",
        ...positionOf(fixture.jsxSource, "JsxPanel", { last: true }),
      },
      requiredCapability: "semantic-live",
      deadlineAtMs: 2_000,
    });
    const tsxDefinition = await codeIntel.query({
      workspace: { rootPath: fixture.root, revision: "mixed-revision-1" },
      operation: "definition",
      location: {
        path: "src/panel-tsx.tsx",
        ...positionOf(fixture.tsxSource, "TsxPanel", { last: true }),
      },
      requiredCapability: "semantic-live",
      deadlineAtMs: 2_000,
    });

    expect(jsDefinition).toMatchObject({
      ok: true,
      result: { items: [expect.objectContaining({ location: expect.objectContaining({ path: "src/helper.js" }) })] },
    });
    expect(jsxDefinition).toMatchObject({
      ok: true,
      result: { items: [expect.objectContaining({ location: expect.objectContaining({ path: "src/panel-jsx.jsx" }) })] },
    });
    expect(tsxDefinition).toMatchObject({
      ok: true,
      result: { items: [expect.objectContaining({ location: expect.objectContaining({ path: "src/panel-tsx.tsx" }) })] },
    });
  });

  it("discovers referenced monorepo projects without exposing their TypeScript config shape", async () => {
    const fixture = await createProjectReferenceFixture();
    const codeIntel = createFacade();

    const definition = await codeIntel.query({
      workspace: { rootPath: fixture.root, revision: "monorepo-revision-1" },
      operation: "definition",
      location: {
        path: "packages/app/src/index.ts",
        ...positionOf(fixture.appSource, "sharedValue", { last: true }),
      },
      requiredCapability: "semantic-live",
      deadlineAtMs: 2_000,
    });

    expect(definition).toMatchObject({
      ok: true,
      result: {
        items: expect.arrayContaining([expect.objectContaining({
          location: expect.objectContaining({
            scope: "workspace",
            path: "packages/lib/src/index.ts",
          }),
        })]),
      },
    });
  });

  it("requires an explicit external root before resolving dependency evidence", async () => {
    const fixture = await createExternalDependencyFixture();
    const withoutAllowlist = createFacade();
    const denied = await withoutAllowlist.query({
      workspace: { rootPath: fixture.root, revision: "external-revision-1" },
      operation: "definition",
      location: {
        path: "src/caller.ts",
        ...positionOf(fixture.callerSource, "externalThing", { last: true }),
      },
      requiredCapability: "semantic-live",
      deadlineAtMs: 2_000,
    });
    const withAllowlist = createFacade();
    const allowed = await withAllowlist.query({
      workspace: {
        rootPath: fixture.root,
        revision: "external-revision-1",
        externalRoots: [fixture.externalRoot],
      },
      operation: "definition",
      location: {
        path: "src/caller.ts",
        ...positionOf(fixture.callerSource, "externalThing", { last: true }),
      },
      requiredCapability: "semantic-live",
      deadlineAtMs: 2_000,
    });

    expect(denied).toMatchObject({ ok: true });
    if (!denied.ok) {
      throw new Error("Expected a contained unresolved alias result.");
    }
    expect(denied.result.items.every((item) => item.location.scope === "workspace")).toBe(true);
    expect(allowed).toMatchObject({
      ok: true,
      result: {
        items: expect.arrayContaining([expect.objectContaining({
          location: { scope: "external", path: fixture.externalFile, range: expect.any(Object) },
        })]),
      },
    });
  });
});

function createFacade() {
  const facade = new CodeIntel({
    providers: [new TypeScriptLanguageServiceProvider()],
    now: () => 1_000,
  });
  facades.push(facade);
  return facade;
}

async function createTypeScriptFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ss-code-intel-ts-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, "src"), { recursive: true });
  const alphaSource = [
    "export interface Greeter {",
    "  greet(): string;",
    "}",
    "export class FriendlyGreeter implements Greeter {",
    "  greet(): string { return \"hello\"; }",
    "}",
    "export function createGreeter(): Greeter {",
    "  return new FriendlyGreeter();",
    "}",
    "",
  ].join("\n");
  const callerSource = [
    "import { createGreeter, type Greeter } from \"./alpha.js\";",
    "export const greeter: Greeter = createGreeter();",
    "",
  ].join("\n");
  await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
    },
    include: ["src/**/*.ts"],
  }), "utf-8");
  await writeFile(path.join(root, "src", "alpha.ts"), alphaSource, "utf-8");
  await writeFile(path.join(root, "src", "caller.ts"), callerSource, "utf-8");
  return { root, alphaSource, callerSource };
}

async function createMixedTypeScriptFixture() {
  const root = await createTemporaryRoot("ss-code-intel-mixed-");
  await mkdir(path.join(root, "src"), { recursive: true });
  const callerSource = [
    "import { jsHelper } from \"./helper.js\";",
    "import { JsxPanel } from \"./panel-jsx.jsx\";",
    "import { TsxPanel } from \"./panel-tsx.js\";",
    "export const mixedValue: string = jsHelper();",
    "export const jsxPanel = JsxPanel;",
    "export const tsxPanel = TsxPanel;",
    "",
  ].join("\n");
  await writeJson(path.join(root, "tsconfig.json"), {
    compilerOptions: {
      allowJs: true,
      checkJs: true,
      jsx: "preserve",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      target: "ES2022",
    },
    include: ["src/**/*"],
  });
  await writeFile(path.join(root, "src", "helper.js"), "export function jsHelper() { return \"ok\"; }\n", "utf-8");
  const jsxSource = [
    "export function JsxPanel() { return <section />; }",
    "export const renderedJsxPanel = JsxPanel;",
    "",
  ].join("\n");
  const tsxSource = [
    "export function TsxPanel() { return <main />; }",
    "export const renderedTsxPanel = TsxPanel;",
    "",
  ].join("\n");
  await writeFile(path.join(root, "src", "panel-jsx.jsx"), jsxSource, "utf-8");
  await writeFile(path.join(root, "src", "panel-tsx.tsx"), tsxSource, "utf-8");
  await writeFile(path.join(root, "src", "caller.ts"), callerSource, "utf-8");
  return { root, callerSource, jsxSource, tsxSource };
}

async function createProjectReferenceFixture() {
  const root = await createTemporaryRoot("ss-code-intel-reference-");
  const libRoot = path.join(root, "packages", "lib");
  const appRoot = path.join(root, "packages", "app");
  await mkdir(path.join(libRoot, "src"), { recursive: true });
  await mkdir(path.join(appRoot, "src"), { recursive: true });
  await writeJson(path.join(root, "tsconfig.json"), {
    files: [],
    references: [{ path: "./packages/lib" }, { path: "./packages/app" }],
  });
  await writeJson(path.join(libRoot, "tsconfig.json"), {
    compilerOptions: { composite: true, module: "NodeNext", moduleResolution: "NodeNext", target: "ES2022" },
    include: ["src/**/*.ts"],
  });
  await writeJson(path.join(appRoot, "tsconfig.json"), {
    compilerOptions: {
      composite: true,
      module: "NodeNext",
      moduleResolution: "NodeNext",
      target: "ES2022",
      baseUrl: ".",
      paths: { "@fixture/lib": ["../lib/src/index.ts"] },
    },
    references: [{ path: "../lib" }],
    include: ["src/**/*.ts"],
  });
  const appSource = [
    "import { sharedValue } from \"../../lib/src/index.js\";",
    "export const appValue = sharedValue;",
    "",
  ].join("\n");
  await writeFile(path.join(libRoot, "src", "index.ts"), "export const sharedValue = 42;\n", "utf-8");
  await writeFile(path.join(appRoot, "src", "index.ts"), appSource, "utf-8");
  return { root, appSource };
}

async function createExternalDependencyFixture() {
  const root = await createTemporaryRoot("ss-code-intel-external-workspace-");
  const externalRoot = await createTemporaryRoot("ss-code-intel-external-dependency-");
  await mkdir(path.join(root, "src"), { recursive: true });
  const externalFile = path.join(externalRoot, "dependency.ts");
  const relativeImport = path.relative(path.join(root, "src"), externalFile)
    .split(path.sep)
    .join("/")
    .replace(/\.ts$/u, ".js");
  const callerSource = [
    `import { externalThing } from "${relativeImport}";`,
    "export const externalValue = externalThing();",
    "",
  ].join("\n");
  await writeJson(path.join(root, "tsconfig.json"), {
    compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", target: "ES2022" },
    include: ["src/**/*.ts"],
  });
  await writeFile(externalFile, "export function externalThing() { return 42; }\n", "utf-8");
  await writeFile(path.join(root, "src", "caller.ts"), callerSource, "utf-8");
  return { root, externalRoot, externalFile, callerSource };
}

async function createTemporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(value), "utf-8");
}

function positionOf(source: string, needle: string, options: { end?: boolean; last?: boolean } = {}) {
  const start = options.last ? source.lastIndexOf(needle) : source.indexOf(needle);
  const offset = options.end ? start + needle.length : start;
  if (start < 0) {
    throw new Error(`Missing fixture text: ${needle}`);
  }
  const before = source.slice(0, offset).split("\n");
  return { line: before.length - 1, column: before.at(-1)?.length ?? 0 };
}
