import assert from "node:assert/strict";
import { isIP } from "node:net";
import vm from "node:vm";

import { describe, expect, it } from "vitest";

import { renderExpressSubdomainBoundaryTests } from "./coding-agent-benchmark-v3-express-behavior.mjs";

function runBoundarySuite(body) {
  const context = vm.createContext({ isIP });
  const getter = vm.runInContext(`(function () {
    var hostname = this.hostname;
    if (!hostname) return [];
    var offset = this.app.get('subdomain offset');
    var subdomains = !isIP(hostname) ? hostname.split('.').reverse() : [hostname];
    ${body}
  })`, context);
  const failures = [];
  let count = 0;
  context.require = (name) => {
    if (name === "node:assert/strict") return assert;
    if (name === "../..") return { request: Object.defineProperty({}, "subdomains", { get: getter }) };
    throw new Error(`Unexpected test dependency ${name}`);
  };
  context.describe = (_name, run) => run();
  context.it = (name, run) => {
    count += 1;
    try { run(); } catch { failures.push(name); }
  };
  vm.runInContext(renderExpressSubdomainBoundaryTests(), context);
  return { count, failures };
}

describe("Express subdomain behavior evidence", () => {
  it.each([
    "return subdomains.slice(offset);",
    "return offset ? subdomains.slice(offset) : subdomains;",
    "return offset === 0 ? subdomains : subdomains.slice(offset);",
  ])("accepts behavior independently of expression spelling: %s", (body) => {
    expect(runBoundarySuite(body)).toEqual({ count: 16, failures: [] });
  });

  it.each([
    ["return subdomains.slice(offset + 1);", "default-offset"],
    ["if (!offset) offset = 2; return subdomains.slice(offset);", "zero-offset"],
    ["return subdomains.slice(2);", "three-offset"],
    ["return hostname.split('.').reverse().slice(offset);", "ipv4-zero"],
    ["return subdomains.reverse().slice(offset);", "default-offset"],
  ])("rejects a default or boundary regression: %s", (body, witness) => {
    expect(runBoundarySuite(body).failures).toContain(witness);
  });
});
