export const EXPRESS_SUBDOMAIN_BEHAVIOR_VERSION = "coding-agent-express-subdomain-behavior/v1";

// 固定公共行为，不指定修复表达式；边界值用于防止只修好默认样例。
const CASES = [
  { id: "default-offset", hostname: "api.service.example.com", offset: 2, expected: ["service", "api"] },
  { id: "zero-offset", hostname: "api.service.example.com", offset: 0, expected: ["com", "example", "service", "api"] },
  { id: "one-offset", hostname: "api.service.example.com", offset: 1, expected: ["example", "service", "api"] },
  { id: "three-offset", hostname: "api.service.example.com", offset: 3, expected: ["api"] },
  { id: "at-length", hostname: "api.service.example.com", offset: 4, expected: [] },
  { id: "beyond-length", hostname: "api.service.example.com", offset: 10, expected: [] },
  { id: "negative-offset", hostname: "api.service.example.com", offset: -1, expected: ["api"] },
  { id: "fractional-offset", hostname: "api.service.example.com", offset: 1.5, expected: ["example", "service", "api"] },
  { id: "string-offset", hostname: "api.service.example.com", offset: "2", expected: ["service", "api"] },
  { id: "empty-hostname", hostname: "", offset: 2, expected: [] },
  { id: "missing-hostname", offset: 0, expected: [] },
  { id: "ipv4-zero", hostname: "127.0.0.1", offset: 0, expected: ["127.0.0.1"] },
  { id: "ipv4-default", hostname: "127.0.0.1", offset: 2, expected: [] },
  { id: "ipv6-zero", hostname: "::1", offset: 0, expected: ["::1"] },
  { id: "single-label", hostname: "localhost", offset: 0, expected: ["localhost"] },
  { id: "two-label-default", hostname: "example.com", offset: 2, expected: [] },
];

export function renderExpressSubdomainBoundaryTests() {
  return [
    "var assert = require('node:assert/strict')",
    "var subdomainGetter = Object.getOwnPropertyDescriptor(require('../..').request, 'subdomains').get",
    `describe(${JSON.stringify(EXPRESS_SUBDOMAIN_BEHAVIOR_VERSION)}, function () {`,
    `  var cases = ${JSON.stringify(CASES)}`,
    "  cases.forEach(function (testCase) {",
    "    it(testCase.id, function () {",
    "      var receiver = { hostname: testCase.hostname, app: { get: function (name) {",
    "        assert.equal(name, 'subdomain offset')",
    "        return testCase.offset",
    "      } } }",
    "      assert.deepEqual(subdomainGetter.call(receiver), testCase.expected)",
    "    })",
    "  })",
    "})",
    "",
  ].join("\n");
}
