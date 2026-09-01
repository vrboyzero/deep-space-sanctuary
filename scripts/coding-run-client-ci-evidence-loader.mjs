import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

import { compileOutputSchema } from "../packages/belldandy-core/src/cli/shared/output-schema.ts";
import { projectStructuredTestReport } from "./verification-test-report-adapter.mjs";

const MAX_API_BYTES = 16 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
const MAX_ENTRY_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 200;
const EXPECTED_ZIP_ENTRIES = Object.freeze([
  "lane-receipt.json",
  "vitest-report.json",
]);
const REQUIRED_RUNNER_PLATFORMS = Object.freeze([
  "ubuntu-latest",
  "windows-latest",
]);
const EXPECTED_TEST_FILES = Object.freeze([
  "packages/belldandy-core/src/coding-run/stdio.test.ts",
  "packages/belldandy-core/src/coding-run/client.test.ts",
  "apps/vscode-extension/src/stdio-client.test.js",
  "scripts/coding-run-client-conformance.test.mjs",
  "scripts/coding-run-client-failure-conformance.test.mjs",
  "scripts/run-coding-run-client-external-consumer.test.mjs",
  "scripts/run-coding-run-client-typescript-consumer.test.mjs",
]);
const laneEvidenceSchemaPath = path.resolve(
  import.meta.dirname,
  "..",
  "benchmarks",
  "coding-agent",
  "v3",
  "coding-run-client-ci-lane-evidence.schema.json",
);

/**
 * Verifies one current-candidate GitHub Actions receipt from its original API and ZIP bytes.
 * Trustworthy test failures return complete=false; malformed or inconsistent evidence throws.
 */
export async function loadCodingRunClientCiEvidence(input) {
  const aggregateRoot = path.resolve(requireString(input?.aggregateRoot, "aggregateRoot"));
  const receipt = requireObject(input?.receipt, "receipt");
  const expectedHarness = requireObject(input?.expectedHarness, "expectedHarness");
  if (JSON.stringify(receipt.aggregate?.harness) !== JSON.stringify(expectedHarness)
    || receipt.github?.run?.headSha !== expectedHarness.commit) {
    throw evidenceError("current harness binding drifted");
  }

  const [runApi, jobsApi, artifactsApi, laneValidator] = await Promise.all([
    loadApiEvidence(aggregateRoot, receipt.github.apiEvidence.run, "GitHub run API"),
    loadApiEvidence(aggregateRoot, receipt.github.apiEvidence.jobs, "GitHub jobs API"),
    loadApiEvidence(aggregateRoot, receipt.github.apiEvidence.artifacts, "GitHub artifacts API"),
    loadLaneEvidenceValidator(),
  ]);
  requireRunBinding(receipt, runApi);
  const apiJobs = requireCompleteCollection(jobsApi, "jobs");
  const apiArtifacts = requireCompleteCollection(artifactsApi, "artifacts");
  requireUniqueValues(apiJobs, "id", "GitHub job id");
  requireUniqueStrings(apiJobs, "name", "GitHub job name");
  requireUniqueValues(apiArtifacts, "id", "GitHub artifact id");
  requireUniqueStrings(apiArtifacts, "name", "GitHub artifact name");

  const laneCompletions = [];
  for (const lane of receipt.lanes) {
    const apiJob = requireSingleById(apiJobs, lane.job.id, "GitHub job");
    const apiArtifact = requireSingleById(apiArtifacts, lane.artifact.id, "GitHub artifact");
    requireJobBinding(receipt, lane, apiJob);
    requireArtifactBinding(receipt, lane, apiArtifact);

    const archive = await readBoundedRegularFile(
      resolveInside(aggregateRoot, lane.archive.path),
      MAX_ARCHIVE_BYTES,
      `${lane.platform} artifact archive`,
    );
    const archiveSha256 = sha256(archive);
    if (archiveSha256 !== lane.archive.sha256
      || lane.artifact.digest !== `sha256:${archiveSha256}`
      || apiArtifact.digest !== `sha256:${archiveSha256}`
      || archive.length !== lane.artifact.sizeInBytes
      || archive.length !== apiArtifact.size_in_bytes) {
      throw evidenceError(`${lane.platform} artifact archive digest or size drifted`);
    }
    const entries = readExactZipEntries(archive);
    const laneReceiptBytes = entries.get(lane.laneReceipt.entry);
    const reportBytes = entries.get(lane.nativeTestReport.entry);
    if (sha256(laneReceiptBytes) !== lane.laneReceipt.sha256
      || sha256(reportBytes) !== lane.nativeTestReport.sha256) {
      throw evidenceError(`${lane.platform} artifact entry digest drifted`);
    }

    const laneReceiptText = decodeUtf8(laneReceiptBytes, `${lane.platform} lane receipt`);
    if (!laneValidator.validateOutput(laneReceiptText).ok) {
      throw evidenceError(`${lane.platform} lane receipt does not match its schema`);
    }
    const laneReceipt = parseJson(laneReceiptText, `${lane.platform} lane receipt`);
    const reportText = decodeUtf8(reportBytes, `${lane.platform} native test report`);
    const report = parseJson(reportText, `${lane.platform} native test report`);
    const reportStatus = inspectNativeTestReport({ lane, report, reportText });
    requireLaneReceiptBinding({ receipt, lane, laneReceipt, reportStatus });
    requireLaneTerminalBinding({ lane, apiJob, reportStatus });
    laneCompletions.push(reportStatus === "passed");
  }
  return { complete: laneCompletions.every(Boolean) };
}

async function loadApiEvidence(aggregateRoot, reference, label) {
  const content = await readBoundedRegularFile(
    resolveInside(aggregateRoot, reference.path),
    MAX_API_BYTES,
    label,
  );
  if (sha256(content) !== reference.sha256) {
    throw evidenceError(`${label} digest drifted`);
  }
  return parseJson(decodeUtf8(content, label), label);
}

async function loadLaneEvidenceValidator() {
  const schemaBytes = await readBoundedRegularFile(
    laneEvidenceSchemaPath,
    MAX_ENTRY_BYTES,
    "coding-run client CI lane evidence schema",
  );
  const schema = parseJson(decodeUtf8(schemaBytes, "lane evidence schema"), "lane evidence schema");
  const compiled = compileOutputSchema(schema);
  if (!compiled.ok) throw evidenceError("lane evidence schema is invalid");
  return compiled.validator;
}

function requireRunBinding(receipt, runApi) {
  const repository = receipt.github.repository;
  const workflow = receipt.github.workflow;
  const run = receipt.github.run;
  const expectedHtmlUrl = `https://github.com/${repository.fullName}/actions/runs/${run.id}`;
  const apiRepository = requireObject(runApi.repository, "run API repository");
  const checks = [
    [runApi.id, run.id],
    [runApi.run_attempt, run.attempt],
    [runApi.event, run.event],
    [runApi.head_branch, run.headBranch],
    [runApi.head_sha, run.headSha],
    [runApi.status, run.status],
    [runApi.conclusion, run.conclusion],
    [runApi.created_at, run.createdAt],
    [runApi.updated_at, run.updatedAt],
    [runApi.html_url, run.htmlUrl],
    [runApi.workflow_id, workflow.id],
    [runApi.name, workflow.name],
    [runApi.path, workflow.path],
    [apiRepository.id, repository.id],
    [apiRepository.full_name, repository.fullName],
    [apiRepository.private, repository.private],
  ];
  if (checks.some(([actual, expected]) => actual !== expected)
    || run.htmlUrl !== expectedHtmlUrl
    || runApi.html_url !== expectedHtmlUrl) {
    throw evidenceError("GitHub run API binding drifted");
  }
}

function requireJobBinding(receipt, lane, apiJob) {
  const labels = requireArray(apiJob.labels, `${lane.platform} GitHub job labels`);
  const requiredPlatformLabels = labels.filter((label) => {
    return REQUIRED_RUNNER_PLATFORMS.includes(label);
  });
  const checks = [
    [apiJob.id, lane.job.id],
    [apiJob.run_id, receipt.github.run.id],
    [apiJob.run_attempt, receipt.github.run.attempt],
    [apiJob.workflow_name, receipt.github.workflow.name],
    [apiJob.head_branch, receipt.github.run.headBranch],
    [apiJob.head_sha, lane.job.headSha],
    [apiJob.name, lane.job.name],
    [apiJob.status, lane.job.status],
    [apiJob.conclusion, lane.job.conclusion],
    [apiJob.started_at, lane.job.startedAt],
    [apiJob.completed_at, lane.job.completedAt],
  ];
  if (checks.some(([actual, expected]) => actual !== expected)
    || lane.job.headSha !== receipt.github.run.headSha
    || JSON.stringify(requiredPlatformLabels) !== JSON.stringify([lane.platform])) {
    throw evidenceError(`${lane.platform} GitHub job binding drifted`);
  }
  const steps = requireArray(apiJob.steps, `${lane.platform} GitHub job steps`);
  requireUniqueValues(steps, "number", `${lane.platform} GitHub step number`);
  requireUniqueNamedItem(
    steps,
    lane.verificationStep.name,
    "GitHub verification step name",
  );
  requireUniqueNamedItem(
    steps,
    lane.uploadStep.name,
    "GitHub upload step name",
  );
  const verificationStep = requireSingleById(
    steps,
    lane.verificationStep.number,
    "GitHub verification step",
    "number",
  );
  const uploadStep = requireSingleById(
    steps,
    lane.uploadStep.number,
    "GitHub upload step",
    "number",
  );
  requireApiStepBinding(
    verificationStep,
    lane.verificationStep,
    `${lane.platform} verification step`,
  );
  requireApiStepBinding(
    uploadStep,
    lane.uploadStep,
    `${lane.platform} upload step`,
  );
  requireOrderedTimeline(`${lane.platform} CI timeline`, [
    receipt.github.run.createdAt,
    lane.job.startedAt,
    lane.verificationStep.startedAt,
    lane.verificationStep.completedAt,
    lane.uploadStep.startedAt,
    lane.uploadStep.completedAt,
    lane.job.completedAt,
    receipt.github.run.updatedAt,
  ]);
}

function requireApiStepBinding(apiStep, step, label) {
  const checks = [
    [apiStep.number, step.number],
    [apiStep.name, step.name],
    [apiStep.status, step.status],
    [apiStep.conclusion, step.conclusion],
    [apiStep.started_at, step.startedAt],
    [apiStep.completed_at, step.completedAt],
  ];
  if (checks.some(([actual, expected]) => actual !== expected)) {
    throw evidenceError(`${label} binding drifted`);
  }
}

function requireArtifactBinding(receipt, lane, apiArtifact) {
  const workflowRun = requireObject(apiArtifact.workflow_run, "artifact workflow run");
  const checks = [
    [apiArtifact.id, lane.artifact.id],
    [apiArtifact.name, lane.artifact.name],
    [apiArtifact.digest, lane.artifact.digest],
    [apiArtifact.size_in_bytes, lane.artifact.sizeInBytes],
    [apiArtifact.expired, lane.artifact.expired],
    [apiArtifact.created_at, lane.artifact.createdAt],
    [apiArtifact.expires_at, lane.artifact.expiresAt],
    [workflowRun.id, lane.artifact.workflowRun.id],
    [workflowRun.repository_id, lane.artifact.workflowRun.repositoryId],
    [workflowRun.head_repository_id, lane.artifact.workflowRun.headRepositoryId],
    [workflowRun.head_branch, lane.artifact.workflowRun.headBranch],
    [workflowRun.head_sha, lane.artifact.workflowRun.headSha],
  ];
  if (checks.some(([actual, expected]) => actual !== expected)
    || workflowRun.id !== receipt.github.run.id
    || workflowRun.repository_id !== receipt.github.repository.id
    || workflowRun.head_repository_id !== receipt.github.repository.id
    || workflowRun.head_branch !== receipt.github.run.headBranch
    || workflowRun.head_sha !== receipt.github.run.headSha) {
    throw evidenceError(`${lane.platform} GitHub artifact binding drifted`);
  }
  requireOrderedTimeline(`${lane.platform} GitHub artifact lifecycle`, [
    apiArtifact.created_at,
    apiArtifact.updated_at,
    apiArtifact.expires_at,
  ]);
}

function requireLaneReceiptBinding({ receipt, lane, laneReceipt, reportStatus }) {
  const expectedRef = `refs/heads/${receipt.github.run.headBranch}`;
  const expectedWorkflowRef =
    `${receipt.github.repository.fullName}/${receipt.github.workflow.path}@${expectedRef}`;
  const checks = [
    [laneReceipt.github.repositoryId, receipt.github.repository.id],
    [laneReceipt.github.repository, receipt.github.repository.fullName],
    [laneReceipt.github.workflow, receipt.github.workflow.name],
    [laneReceipt.github.workflowRef, expectedWorkflowRef],
    [laneReceipt.github.runId, receipt.github.run.id],
    [laneReceipt.github.runAttempt, receipt.github.run.attempt],
    [laneReceipt.github.sha, receipt.github.run.headSha],
    [laneReceipt.github.ref, expectedRef],
    [laneReceipt.runner.platform, lane.platform],
    [laneReceipt.runner.os, lane.runnerOs],
    [laneReceipt.report.status, reportStatus],
    [laneReceipt.report.framework, lane.nativeTestReport.framework],
    [laneReceipt.report.format, lane.nativeTestReport.format],
    [laneReceipt.report.runnerVersion, lane.nativeTestReport.runnerVersion],
    [laneReceipt.report.path, lane.nativeTestReport.entry],
    [laneReceipt.report.sha256, lane.nativeTestReport.sha256],
  ];
  if (checks.some(([actual, expected]) => actual !== expected)
    || JSON.stringify(laneReceipt.report.testFiles) !== JSON.stringify(EXPECTED_TEST_FILES)
    || JSON.stringify(lane.testFiles) !== JSON.stringify(EXPECTED_TEST_FILES)) {
    throw evidenceError(`${lane.platform} lane receipt binding drifted`);
  }
  requireOrderedTimeline(`${lane.platform} lane receipt timeline`, [
    lane.verificationStep.completedAt,
    laneReceipt.generatedAt,
    lane.uploadStep.startedAt,
  ]);
}

function requireLaneTerminalBinding({ lane, apiJob, reportStatus }) {
  const expectedConclusion = reportStatus === "passed" ? "success" : "failure";
  if (lane.job.status !== "completed"
    || lane.verificationStep.status !== "completed"
    || lane.job.conclusion !== expectedConclusion
    || lane.verificationStep.conclusion !== expectedConclusion
    || apiJob.conclusion !== expectedConclusion
    || lane.uploadStep.status !== "completed"
    || lane.uploadStep.conclusion !== "success") {
    throw evidenceError(`${lane.platform} CI terminal state drifted`);
  }
}

function inspectNativeTestReport({ lane, report, reportText }) {
  const projected = projectStructuredTestReport({
    framework: lane.nativeTestReport.framework,
    format: lane.nativeTestReport.format,
    runnerVersion: lane.nativeTestReport.runnerVersion,
    artifact: {
      path: lane.nativeTestReport.entry,
      sha256: lane.nativeTestReport.sha256,
    },
    content: reportText,
  });
  if (projected.status !== "passed" && projected.status !== "failed") {
    throw evidenceError(`${lane.platform} native test report is not terminal`);
  }
  const results = requireArray(report.testResults, `${lane.platform} native test results`);
  if (results.length !== EXPECTED_TEST_FILES.length) {
    throw evidenceError(`${lane.platform} native test selection drifted`);
  }
  const selected = results.map((result) => {
    const normalized = typeof result?.name === "string" ? result.name.replaceAll("\\", "/") : "";
    return EXPECTED_TEST_FILES.find(
      (testFile) => normalized === testFile || normalized.endsWith(`/${testFile}`),
    ) ?? null;
  });
  if (selected.some((testFile) => testFile === null)
    || new Set(selected).size !== EXPECTED_TEST_FILES.length
    || JSON.stringify([...selected].sort()) !== JSON.stringify([...EXPECTED_TEST_FILES].sort())) {
    throw evidenceError(`${lane.platform} native test selection drifted`);
  }
  const filesPassed = results.every((result) => {
    return result.status === "passed"
      && Array.isArray(result.assertionResults)
      && result.assertionResults.length > 0
      && result.assertionResults.every(({ status }) => status === "passed");
  });
  if ((projected.status === "passed") !== filesPassed) {
    throw evidenceError(`${lane.platform} native test report terminal state drifted`);
  }
  return projected.status;
}

function requireCompleteCollection(value, key) {
  const collection = requireObject(value, `GitHub ${key} API`);
  const items = requireArray(collection[key], `GitHub ${key} API ${key}`);
  if (!Number.isSafeInteger(collection.total_count)
    || collection.total_count !== items.length
    || items.length < 2
    || items.length > 100) {
    throw evidenceError(`GitHub ${key} API collection is incomplete`);
  }
  return items;
}

function requireUniqueValues(items, key, label) {
  const values = items.map((item) => item?.[key]);
  if (values.some((value) => !Number.isSafeInteger(value) || value < 1)
    || new Set(values).size !== values.length) {
    throw evidenceError(`${label} is missing or duplicated`);
  }
}

function requireUniqueStrings(items, key, label) {
  const values = items.map((item) => item?.[key]);
  if (values.some((value) => typeof value !== "string" || value.length < 1)
    || new Set(values).size !== values.length) {
    throw evidenceError(`${label} is missing or duplicated`);
  }
}

function requireSingleById(items, id, label, key = "id") {
  const matches = items.filter((item) => item?.[key] === id);
  if (matches.length !== 1) throw evidenceError(`${label} binding is missing or duplicated`);
  return matches[0];
}

function requireUniqueNamedItem(items, name, label) {
  if (items.filter((item) => item?.name === name).length !== 1) {
    throw evidenceError(`${label} is missing or duplicated`);
  }
}

function requireOrderedTimeline(label, timestamps) {
  const times = timestamps.map((timestamp) => {
    return typeof timestamp === "string" ? Date.parse(timestamp) : Number.NaN;
  });
  if (times.some((time) => !Number.isFinite(time))
    || times.some((time, index) => index > 0 && time < times[index - 1])) {
    throw evidenceError(`${label} drifted`);
  }
}

function readExactZipEntries(archive) {
  const eocdOffset = findEndOfCentralDirectory(archive);
  const entryCount = archive.readUInt16LE(eocdOffset + 10);
  const centralSize = archive.readUInt32LE(eocdOffset + 12);
  const centralOffset = archive.readUInt32LE(eocdOffset + 16);
  if (archive.readUInt16LE(eocdOffset + 4) !== 0
    || archive.readUInt16LE(eocdOffset + 6) !== 0
    || archive.readUInt16LE(eocdOffset + 8) !== entryCount
    || entryCount !== EXPECTED_ZIP_ENTRIES.length
    || archive.readUInt16LE(eocdOffset + 20) !== 0
    || centralOffset + centralSize !== eocdOffset) {
    throw evidenceError("artifact ZIP central directory drifted");
  }
  const centralEnd = centralOffset + centralSize;
  const entries = [];
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    requireRange(archive, cursor, 46, "artifact ZIP central header");
    if (archive.readUInt32LE(cursor) !== 0x02014b50) {
      throw evidenceError("artifact ZIP central header is invalid");
    }
    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const checksum = archive.readUInt32LE(cursor + 16);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const diskStart = archive.readUInt16LE(cursor + 34);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    requireRange(archive, cursor, recordLength, "artifact ZIP central entry");
    const name = decodeUtf8(
      archive.subarray(cursor + 46, cursor + 46 + nameLength),
      "artifact ZIP entry name",
    );
    requireZipEntryMetadata({
      flags,
      method,
      compressedSize,
      uncompressedSize,
      diskStart,
      name,
    });
    entries.push({
      name,
      flags,
      method,
      checksum,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    cursor += recordLength;
  }
  if (cursor !== centralEnd
    || JSON.stringify(entries.map(({ name }) => name).sort())
      !== JSON.stringify([...EXPECTED_ZIP_ENTRIES].sort())) {
    throw evidenceError("artifact ZIP entries drifted");
  }

  const byLocalOffset = [...entries].sort((left, right) => left.localOffset - right.localOffset);
  const output = new Map();
  let totalUncompressed = 0;
  for (let index = 0; index < byLocalOffset.length; index += 1) {
    const entry = byLocalOffset[index];
    const nextOffset = byLocalOffset[index + 1]?.localOffset ?? centralOffset;
    requireRange(archive, entry.localOffset, 30, "artifact ZIP local header");
    if (archive.readUInt32LE(entry.localOffset) !== 0x04034b50) {
      throw evidenceError("artifact ZIP local header is invalid");
    }
    const localFlags = archive.readUInt16LE(entry.localOffset + 6);
    const localMethod = archive.readUInt16LE(entry.localOffset + 8);
    const localChecksum = archive.readUInt32LE(entry.localOffset + 14);
    const localCompressedSize = archive.readUInt32LE(entry.localOffset + 18);
    const localUncompressedSize = archive.readUInt32LE(entry.localOffset + 22);
    const nameLength = archive.readUInt16LE(entry.localOffset + 26);
    const extraLength = archive.readUInt16LE(entry.localOffset + 28);
    const headerEnd = entry.localOffset + 30 + nameLength + extraLength;
    requireRange(archive, entry.localOffset, 30 + nameLength + extraLength, "artifact ZIP local entry");
    const localName = decodeUtf8(
      archive.subarray(entry.localOffset + 30, entry.localOffset + 30 + nameLength),
      "artifact ZIP local entry name",
    );
    if (localName !== entry.name || localFlags !== entry.flags || localMethod !== entry.method) {
      throw evidenceError("artifact ZIP local entry binding drifted");
    }
    const usesDescriptor = (entry.flags & 0x0008) !== 0;
    if ((!usesDescriptor && (localChecksum !== entry.checksum
      || localCompressedSize !== entry.compressedSize
      || localUncompressedSize !== entry.uncompressedSize))
      || (usesDescriptor && ((localChecksum !== 0 && localChecksum !== entry.checksum)
        || (localCompressedSize !== 0 && localCompressedSize !== entry.compressedSize)
        || (localUncompressedSize !== 0 && localUncompressedSize !== entry.uncompressedSize)))) {
      throw evidenceError("artifact ZIP local entry metadata drifted");
    }
    const payloadEnd = headerEnd + entry.compressedSize;
    requireRange(archive, headerEnd, entry.compressedSize, "artifact ZIP entry payload");
    requireDataDescriptor(archive, entry, payloadEnd, nextOffset);
    const compressed = archive.subarray(headerEnd, payloadEnd);
    let content;
    try {
      content = entry.method === 0
        ? Buffer.from(compressed)
        : inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES });
    } catch {
      throw evidenceError(`artifact ZIP entry ${entry.name} cannot be decompressed`);
    }
    if (content.length !== entry.uncompressedSize || crc32(content) !== entry.checksum) {
      throw evidenceError(`artifact ZIP entry ${entry.name} CRC or size drifted`);
    }
    totalUncompressed += content.length;
    if (totalUncompressed > MAX_TOTAL_ENTRY_BYTES) {
      throw evidenceError("artifact ZIP expanded content exceeds its limit");
    }
    output.set(entry.name, content);
  }
  if (byLocalOffset[0]?.localOffset !== 0 || output.size !== EXPECTED_ZIP_ENTRIES.length) {
    throw evidenceError("artifact ZIP local layout drifted");
  }
  return output;
}

function findEndOfCentralDirectory(archive) {
  if (archive.length < 22) throw evidenceError("artifact ZIP is truncated");
  const minimum = Math.max(0, archive.length - 22 - 65_535);
  for (let offset = archive.length - 22; offset >= minimum; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      const commentLength = archive.readUInt16LE(offset + 20);
      if (offset + 22 + commentLength === archive.length) return offset;
    }
  }
  throw evidenceError("artifact ZIP end record is missing");
}

function requireZipEntryMetadata(input) {
  if (!EXPECTED_ZIP_ENTRIES.includes(input.name)
    || input.diskStart !== 0
    || (input.flags & ~0x080e) !== 0
    || (input.flags & 0x0001) !== 0
    || (input.method !== 0 && input.method !== 8)
    || input.compressedSize < 1
    || input.uncompressedSize < 1
    || input.uncompressedSize > MAX_ENTRY_BYTES
    || input.compressedSize > MAX_ARCHIVE_BYTES
    || input.uncompressedSize > input.compressedSize * MAX_COMPRESSION_RATIO) {
    throw evidenceError(`artifact ZIP entry ${input.name} metadata is unsupported`);
  }
}

function requireDataDescriptor(archive, entry, payloadEnd, nextOffset) {
  if ((entry.flags & 0x0008) === 0) {
    if (payloadEnd !== nextOffset) throw evidenceError("artifact ZIP local entries overlap or contain gaps");
    return;
  }
  const descriptorSize = archive.readUInt32LE(payloadEnd) === 0x08074b50 ? 16 : 12;
  requireRange(archive, payloadEnd, descriptorSize, "artifact ZIP data descriptor");
  const base = payloadEnd + (descriptorSize === 16 ? 4 : 0);
  if (archive.readUInt32LE(base) !== entry.checksum
    || archive.readUInt32LE(base + 4) !== entry.compressedSize
    || archive.readUInt32LE(base + 8) !== entry.uncompressedSize
    || payloadEnd + descriptorSize !== nextOffset) {
    throw evidenceError("artifact ZIP data descriptor drifted");
  }
}

function requireRange(buffer, offset, length, label) {
  if (!Number.isSafeInteger(offset)
    || !Number.isSafeInteger(length)
    || offset < 0
    || length < 0
    || offset + length > buffer.length) {
    throw evidenceError(`${label} is out of bounds`);
  }
}

async function readBoundedRegularFile(target, maxBytes, label) {
  let stats;
  try {
    stats = await fs.lstat(target);
  } catch {
    throw evidenceError(`unable to read ${label}`);
  }
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size < 1 || stats.size > maxBytes) {
    throw evidenceError(`${label} must be a bounded regular file`);
  }
  return await fs.readFile(target);
}

function resolveInside(root, relativePath) {
  const target = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(root, target);
  if (!relative
    || relative === ".."
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)) {
    throw evidenceError("evidence path escapes its aggregate root");
  }
  return target;
}

function decodeUtf8(value, label) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    throw evidenceError(`${label} is not UTF-8`);
  }
}

function parseJson(value, label) {
  try {
    const parsed = JSON.parse(value);
    return requireObject(parsed, label);
  } catch (error) {
    if (error?.message?.startsWith("Coding-run client CI evidence")) throw error;
    throw evidenceError(`${label} is invalid JSON`);
  }
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw evidenceError(`${label} must be an object`);
  }
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw evidenceError(`${label} must be an array`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length < 1) {
    throw evidenceError(`${label} must be a non-empty string`);
  }
  return value;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function crc32(value) {
  let checksum = 0xffffffff;
  for (const byte of value) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ ((checksum & 1) === 1 ? 0xedb88320 : 0);
    }
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function evidenceError(message) {
  return new Error(`Coding-run client CI evidence ${message}.`);
}
