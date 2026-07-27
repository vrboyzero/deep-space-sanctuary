import { describe, expect, it } from "vitest";

import { readExtensionRuntimeFixtureEnvironment } from "./verify-extension-runtime-oci-fixture.mjs";

describe("OCI Extension Host fixture contract", () => {
  it("prefers dedicated Extension Host settings and only falls back to command sandbox settings", () => {
    expect(readExtensionRuntimeFixtureEnvironment("BELLDANDY_EXTENSION_HOST_OCI_IMAGE", {
      BELLDANDY_EXTENSION_HOST_OCI_IMAGE: "dedicated@sha256:one",
      BELLDANDY_COMMAND_SANDBOX_OCI_IMAGE: "fallback@sha256:two",
    })).toBe("dedicated@sha256:one");
    expect(readExtensionRuntimeFixtureEnvironment("BELLDANDY_EXTENSION_HOST_OCI_IMAGE", {
      BELLDANDY_COMMAND_SANDBOX_OCI_IMAGE: "fallback@sha256:two",
    })).toBe("fallback@sha256:two");
  });
});
