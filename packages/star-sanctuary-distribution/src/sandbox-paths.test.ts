import fs from "node:fs";
import path from "node:path";

import { expect, test, vi } from "vitest";

import {
  assertPathInsideRoots,
  guardedRemovePath,
  assertSafeSingleExeRuntimeVersionDirInfo,
  resolveSingleExeVerifyBaseRoot,
} from "./sandbox-paths.js";

test("assertPathInsideRoots accepts a nested path inside an allowed root", () => {
  const rootPath = path.resolve("C:/sandbox/runtime");
  const nestedPath = path.join(rootPath, "state", "marker.txt");

  expect(assertPathInsideRoots(nestedPath, [rootPath], "delete test path")).toBe(path.resolve(nestedPath));
});

test("assertPathInsideRoots rejects a path outside allowed roots", () => {
  const rootPath = path.resolve("C:/sandbox/runtime");
  const outsidePath = path.resolve("C:/Users/admin/.star_sanctuary-bootstrap");

  expect(() => assertPathInsideRoots(outsidePath, [rootPath], "delete test path")).toThrow(
    /outside allowed sandbox roots/i,
  );
});

test("guardedRemovePath removes a nested path inside an allowed root", () => {
  const rootPath = path.resolve("C:/sandbox/runtime");
  const nestedPath = path.join(rootPath, "state", "marker.txt");
  const existsSync = vi.spyOn(fs, "existsSync").mockReturnValue(true);
  const lstatSync = vi.spyOn(fs, "lstatSync").mockReturnValue({
    isDirectory: () => false,
    isSymbolicLink: () => false,
  } as unknown as fs.Stats);
  const rmSync = vi.spyOn(fs, "rmSync").mockImplementation(() => {});

  expect(guardedRemovePath(nestedPath, [rootPath], "delete test path")).toBe(path.resolve(nestedPath));
  expect(rmSync).toHaveBeenCalledWith(path.resolve(nestedPath), { recursive: false, force: true });

  existsSync.mockRestore();
  lstatSync.mockRestore();
  rmSync.mockRestore();
});

test("guardedRemovePath rejects a path outside allowed roots", () => {
  const rootPath = path.resolve("C:/sandbox/runtime");
  const outsidePath = path.resolve("C:/Users/admin/.star_sanctuary-bootstrap");

  expect(() => guardedRemovePath(outsidePath, [rootPath], "delete test path")).toThrow(
    /outside allowed sandbox roots/i,
  );
});

test("guardedRemovePath removes a broken symlink inside an allowed root", () => {
  const rootPath = path.resolve("C:/sandbox/runtime");
  const brokenLinkPath = path.join(rootPath, "state", "broken-link");
  const lstatSync = vi.spyOn(fs, "lstatSync").mockReturnValue({
    isDirectory: () => false,
    isSymbolicLink: () => true,
  } as unknown as fs.Stats);
  const rmSync = vi.spyOn(fs, "rmSync").mockImplementation(() => {});

  expect(guardedRemovePath(brokenLinkPath, [rootPath], "delete broken link")).toBe(path.resolve(brokenLinkPath));
  expect(rmSync).toHaveBeenCalledWith(path.resolve(brokenLinkPath), { recursive: false, force: true });

  lstatSync.mockRestore();
  rmSync.mockRestore();
});

test("assertSafeSingleExeRuntimeVersionDirInfo accepts verify sandbox roots", () => {
  const verifyBaseRoot = resolveSingleExeVerifyBaseRoot({
    env: { LOCALAPPDATA: "C:/Users/admin/AppData/Local" } as NodeJS.ProcessEnv,
    tmpDir: "C:/Temp",
  });
  const appHomeDir = path.join(verifyBaseRoot, "deps-full", "home");
  const runtimeBaseDir = path.join(appHomeDir, "runtime");
  const versionRootDir = path.join(runtimeBaseDir, "0.5.4-win32-x64");

  expect(() => assertSafeSingleExeRuntimeVersionDirInfo({
    appHomeDir,
    runtimeBaseDir,
    versionKey: "0.5.4-win32-x64",
    versionRootDir,
    runtimeDir: path.join(versionRootDir, "runtime"),
    versionFilePath: path.join(versionRootDir, "version.json"),
    runtimeManifestPath: path.join(versionRootDir, "runtime-manifest.json"),
  }, {
    env: { LOCALAPPDATA: "C:/Users/admin/AppData/Local" } as NodeJS.ProcessEnv,
  })).not.toThrow();
});

test("assertSafeSingleExeRuntimeVersionDirInfo rejects unexpected user-home paths", () => {
  const appHomeDir = path.resolve("C:/Users/admin/.star_sanctuary-bootstrap");
  const runtimeBaseDir = path.join(appHomeDir, "runtime");
  const versionRootDir = path.join(runtimeBaseDir, "0.5.4-win32-x64");

  expect(() => assertSafeSingleExeRuntimeVersionDirInfo({
    appHomeDir,
    runtimeBaseDir,
    versionKey: "0.5.4-win32-x64",
    versionRootDir,
    runtimeDir: path.join(versionRootDir, "runtime"),
    versionFilePath: path.join(versionRootDir, "version.json"),
    runtimeManifestPath: path.join(versionRootDir, "runtime-manifest.json"),
  }, {
    env: { LOCALAPPDATA: "C:/Users/admin/AppData/Local" } as NodeJS.ProcessEnv,
  })).toThrow(/outside allowed single-exe sandboxes/i);
});
