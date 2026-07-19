import { describe, expect, it } from "vitest";

import {
  REQUIRED_WEB_ASSET_PACKAGE_NAMES,
  validateWebAssetPackageProvenance,
} from "./web-asset-manifest-policy.mjs";

function createValidManifest() {
  return {
    version: 1,
    provenance: {
      lockfileSha256: "a".repeat(64),
    },
    packages: REQUIRED_WEB_ASSET_PACKAGE_NAMES.map((name) => ({
      name,
      version: "1.0.0",
      license: "MIT",
    })),
  };
}

describe("Web asset package provenance policy", () => {
  it("accepts the complete versioned and licensed package inventory", () => {
    expect(validateWebAssetPackageProvenance(createValidManifest())).toBe(true);
  });

  it("rejects missing and duplicate package identities", () => {
    const missing = createValidManifest();
    missing.packages.pop();
    expect(() => validateWebAssetPackageProvenance(missing)).toThrow(/missing required package/i);

    const duplicate = createValidManifest();
    duplicate.packages.push({ ...duplicate.packages[0] });
    expect(() => validateWebAssetPackageProvenance(duplicate)).toThrow(/duplicate package/i);
  });

  it("rejects packages without a version or declared license", () => {
    const emptyVersion = createValidManifest();
    emptyVersion.packages[0].version = "";
    expect(() => validateWebAssetPackageProvenance(emptyVersion)).toThrow(/invalid version/i);

    const unspecifiedLicense = createValidManifest();
    unspecifiedLicense.packages[0].license = "UNSPECIFIED";
    expect(() => validateWebAssetPackageProvenance(unspecifiedLicense)).toThrow(/invalid license/i);
  });

  it("rejects a missing or malformed lockfile identity", () => {
    const missing = createValidManifest();
    delete missing.provenance;
    expect(() => validateWebAssetPackageProvenance(missing)).toThrow(/lockfile sha-256/i);

    const malformed = createValidManifest();
    malformed.provenance.lockfileSha256 = "not-a-sha256";
    expect(() => validateWebAssetPackageProvenance(malformed)).toThrow(/lockfile sha-256/i);
  });
});
