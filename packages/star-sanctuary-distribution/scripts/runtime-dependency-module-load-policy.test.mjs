import { describe, expect, it } from "vitest";

import { inspectOptionalRuntimeModule } from "./runtime-dependency-module-load-policy.mjs";

function createModuleRequire({ loadError } = {}) {
  let loadCalls = 0;
  const moduleRequire = () => {
    loadCalls += 1;
    if (loadError) throw loadError;
    return { loaded: true };
  };
  moduleRequire.resolve = (specifier) => `C:/runtime/node_modules/${specifier}/index.js`;
  return {
    moduleRequire,
    getLoadCalls: () => loadCalls,
  };
}

describe("runtime dependency module load policy", () => {
  it("resolves presence without loading the module when load is disabled", () => {
    const fixture = createModuleRequire();

    expect(inspectOptionalRuntimeModule(fixture.moduleRequire, "fastembed")).toEqual({
      present: true,
      resolvedFrom: "C:/runtime/node_modules/fastembed/index.js",
      load: { ok: null },
    });
    expect(fixture.getLoadCalls()).toBe(0);
  });

  it("reports a resolved module that fails during real load", () => {
    const fixture = createModuleRequire({ loadError: new Error("native binding mismatch") });

    expect(inspectOptionalRuntimeModule(
      fixture.moduleRequire,
      "onnxruntime-node",
      { load: true },
    )).toEqual({
      present: true,
      resolvedFrom: "C:/runtime/node_modules/onnxruntime-node/index.js",
      load: { ok: false, error: "native binding mismatch" },
    });
    expect(fixture.getLoadCalls()).toBe(1);
  });
});
