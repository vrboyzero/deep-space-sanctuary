import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import {
  FilesystemCapability,
  assertSafeFilesystemBasename,
} from "./filesystem-capability.js";

const tempDirs = new Set<string>();

afterEach(() => {
  for (const tempDir of tempDirs) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  tempDirs.clear();
});

function createTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.add(tempDir);
  return tempDir;
}

function createDirectoryLink(targetPath: string, linkPath: string): void {
  fs.symlinkSync(targetPath, linkPath, process.platform === "win32" ? "junction" : "dir");
}

test("rejects lexical traversal, absolute paths, and Windows path forms before I/O", () => {
  const root = createTempDir("belldandy-fs-cap-root-");
  const outside = createTempDir("belldandy-fs-cap-outside-");
  const capability = new FilesystemCapability({ rootPath: root, label: "test root" });

  for (const unsafePath of ["../outside.txt", "..\\outside.txt", "/outside.txt", "C:\\outside.txt", "\\\\server\\share\\outside.txt", "nested/../outside.txt", "file\u0000name"]) {
    expect(() => capability.resolveForWriteRelative(unsafePath)).toThrow(/unsafe relative path/i);
  }
  expect(() => capability.resolveForWritePath(path.join(outside, "outside.txt"))).toThrow(/outside capability root/i);
});

test("allows existing and new paths wholly contained by the canonical root", () => {
  const root = createTempDir("belldandy-fs-cap-root-");
  const nestedDir = path.join(root, "nested");
  const existingPath = path.join(nestedDir, "existing.txt");
  fs.mkdirSync(nestedDir);
  fs.writeFileSync(existingPath, "ok", "utf8");
  const capability = new FilesystemCapability({ rootPath: root, label: "test root", maxBytes: 8 });

  expect(capability.resolveExistingRelative("nested/existing.txt")).toBe(fs.realpathSync(existingPath));
  expect(capability.resolveForWriteRelative("nested/new.txt")).toBe(path.join(fs.realpathSync(nestedDir), "new.txt"));
  expect(() => capability.assertByteLength(9, "test payload")).toThrow(/exceeds the 8 byte limit/i);
});

test("rejects symlink or junction targets that resolve outside the capability root", () => {
  const root = createTempDir("belldandy-fs-cap-root-");
  const outside = createTempDir("belldandy-fs-cap-outside-");
  fs.writeFileSync(path.join(outside, "secret.txt"), "secret", "utf8");
  createDirectoryLink(outside, path.join(root, "escape"));
  const capability = new FilesystemCapability({ rootPath: root, label: "test root" });

  expect(() => capability.resolveExistingRelative("escape/secret.txt")).toThrow(/resolves outside capability root/i);
  expect(() => capability.resolveForWriteRelative("escape/new.txt")).toThrow(/resolves outside capability root/i);
  expect(() => capability.resolveForRemovalRelative("escape/secret.txt")).toThrow(/resolves outside capability root/i);
});

test("allows removal of a broken link inside the root without resolving its missing target", () => {
  const root = createTempDir("belldandy-fs-cap-root-");
  const brokenLinkPath = path.join(root, "broken-link");
  createDirectoryLink(path.join(root, "missing-target"), brokenLinkPath);
  const capability = new FilesystemCapability({ rootPath: root, label: "test root" });

  expect(() => capability.resolveExistingRelative("broken-link")).toThrow();
  expect(capability.resolveForRemovalRelative("broken-link")).toBe(brokenLinkPath);
});

test("rechecks a parent directory before writing after it is replaced by a link", () => {
  const root = createTempDir("belldandy-fs-cap-root-");
  const outside = createTempDir("belldandy-fs-cap-outside-");
  const mutableParent = path.join(root, "mutable");
  fs.mkdirSync(mutableParent);
  const capability = new FilesystemCapability({ rootPath: root, label: "test root" });

  fs.rmdirSync(mutableParent);
  createDirectoryLink(outside, mutableParent);

  expect(() => capability.resolveForWriteRelative("mutable/new.txt")).toThrow(/resolves outside capability root/i);
});

test("accepts only portable basename-safe external file names", () => {
  expect(assertSafeFilesystemBasename("voice.amr", "QQ voice file name")).toBe("voice.amr");

  for (const unsafeName of ["../voice.amr", "..\\voice.amr", "/voice.amr", "C:\\voice.amr", "\\\\server\\share\\voice.amr", "CON", "voice. ", "voice\u0000.amr"]) {
    expect(() => assertSafeFilesystemBasename(unsafeName, "QQ voice file name")).toThrow(/unsafe basename/i);
  }
});
