#!/usr/bin/env bash
set -euo pipefail

VERSION="latest"
INSTALL_DIR=""
REPO_OWNER="${STAR_SANCTUARY_REPO_OWNER:-vrboyzero}"
REPO_NAME="${STAR_SANCTUARY_REPO_NAME:-star-sanctuary}"
SOURCE_DIR=""
SKIP_INSTALL_BUILD=0
NO_SETUP=0
FORCE_SETUP=0

MIN_NODE_MAJOR=22
MIN_NODE_MINOR=12
FIRST_START_NOTICE_FILE="first-start-notice.txt"
MAX_RELEASE_ARCHIVE_BYTES=$((512 * 1024 * 1024))
MAX_RELEASE_METADATA_BYTES=$((1024 * 1024))
MAX_RELEASE_ARCHIVE_ENTRIES=100000
MAX_RELEASE_ARCHIVE_ENTRY_BYTES=$((256 * 1024 * 1024))
MAX_RELEASE_ARCHIVE_UNPACKED_BYTES=$((2 * 1024 * 1024 * 1024))

log() {
  printf '[install] %s\n' "$1"
}

fail() {
  local message="$1"
  printf '[install] ERROR: %s\n' "$message" >&2
  case "$message" in
    *"Node.js was not found."*|*"Node.js v"*' is too old. Install Node.js v22.12+ first.'*|*"Failed to detect Node.js version."*)
      printf '[install] HINT: Use Node.js v22.12+ LTS, then reopen the terminal so node/corepack are available on PATH.\n' >&2
      ;;
  esac
  case "$message" in
    *"corepack was not found."*|*"corepack prepare "*' failed.'*)
      printf '[install] HINT: Install or repair a Node.js distribution that includes corepack, then rerun the installer.\n' >&2
      ;;
  esac
  case "$message" in
    *"corepack pnpm install failed."*|*"corepack pnpm build failed."*)
      printf '[install] HINT: Default install/start does not require optional native features like node-pty, fastembed, protobufjs, or onnxruntime-node.\n' >&2
      printf '[install] HINT: A plain "pnpm approve-builds" reminder is not a blocker for the default install/build path.\n' >&2
      printf '[install] HINT: If the log mentions better-sqlite3, native bindings, ABI, or postinstall failures, switch to Node.js v22.12+ LTS and rerun.\n' >&2
      printf '[install] HINT: If the log mentions registry, tarball, ECONNRESET, ETIMEDOUT, or proxy access, fix network/registry access and rerun.\n' >&2
      ;;
  esac
  case "$message" in
    *"'bdd setup' failed."*)
      printf '[install] HINT: Install/build already completed. Fix the setup issue and rerun %s/bdd setup, or rerun the installer with --force-setup.\n' "${INSTALL_ROOT:-<install-root>}" >&2
      ;;
  esac
  exit 1
}

cleanup() {
  if [[ -n "${TEMP_ROOT:-}" && -d "${TEMP_ROOT:-}" ]]; then
    if [[ "${INSTALL_SUCCEEDED:-0}" -ne 1 ]]; then
      if [[ -n "${CURRENT_ROOT:-}" && -e "${CURRENT_ROOT:-}" ]]; then
        rm -rf "${CURRENT_ROOT}"
      fi
      if [[ -n "${BACKUP_PATH:-}" && -e "${BACKUP_PATH:-}" ]]; then
        mv "${BACKUP_PATH}" "${CURRENT_ROOT}"
      fi
      if [[ -n "${INSTALL_ROOT:-}" && -n "${INSTALL_ROOT_FILES_BACKUP_DIR:-}" ]]; then
        restore_install_root_files "${INSTALL_ROOT}" "${INSTALL_ROOT_FILES_BACKUP_DIR}" "${MANAGED_INSTALL_FILES[@]}"
      fi
    fi
    rm -rf "${TEMP_ROOT}"
  fi
}

trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --install-dir)
      INSTALL_DIR="${2:-}"
      shift 2
      ;;
    --repo-owner)
      REPO_OWNER="${2:-}"
      shift 2
      ;;
    --repo-name)
      REPO_NAME="${2:-}"
      shift 2
      ;;
    --source-dir)
      SOURCE_DIR="${2:-}"
      shift 2
      ;;
    --skip-install-build)
      SKIP_INSTALL_BUILD=1
      shift
      ;;
    --no-setup)
      NO_SETUP=1
      shift
      ;;
    --force-setup)
      FORCE_SETUP=1
      shift
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

ensure_command() {
  local name="$1"
  local message="$2"
  command -v "$name" >/dev/null 2>&1 || fail "$message"
}

normalize_version() {
  local raw="$1"
  if [[ -z "$raw" || "$raw" == "latest" ]]; then
    printf 'latest'
    return 0
  fi
  if [[ "$raw" == v* ]]; then
    printf '%s' "$raw"
    return 0
  fi
  printf 'v%s' "$raw"
}

ensure_node_runtime() {
  ensure_command node "Node.js was not found. Install Node.js v22.12+ first."
  ensure_command corepack "corepack was not found. Install a Node.js distribution that includes corepack."
  ensure_command curl "curl was not found."
  ensure_command tar "tar was not found."

  local node_version
  node_version="$(node -p "process.versions.node")" || fail "Failed to detect Node.js version."

  local major minor
  major="$(printf '%s' "$node_version" | cut -d. -f1)"
  minor="$(printf '%s' "$node_version" | cut -d. -f2)"

  if (( major < MIN_NODE_MAJOR )) || (( major == MIN_NODE_MAJOR && minor < MIN_NODE_MINOR )); then
    fail "Node.js v${node_version} is too old. Install Node.js v22.12+ first."
  fi

  log "Detected Node.js v${node_version}"
}

new_source_symlink() {
  local link_path="$1"
  local target_path="$2"
  ln -s "${target_path}" "${link_path}"
}

copy_source_tree() {
  local source_root="$1"
  local target_root="$2"
  mkdir -p "${target_root}"
  cp -a "${source_root}/." "${target_root}/"
}

run_test_fail_point() {
  local point="$1"
  if [[ "${STAR_SANCTUARY_INSTALL_TEST_FAIL_AT:-}" == "${point}" ]]; then
    fail "Installer test failpoint triggered at ${point}."
  fi
}

github_headers=()
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  github_headers=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
fi

validate_repository_identity() {
  local normalized_version
  normalized_version="$(normalize_version "${VERSION}")"
  [[ "${REPO_OWNER}" =~ ^[A-Za-z0-9][A-Za-z0-9-]{0,38}$ ]] \
    && [[ "${REPO_NAME}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$ ]] \
    && [[ "${normalized_version}" == "latest" || "${normalized_version}" =~ ^v?[A-Za-z0-9][A-Za-z0-9._-]*$ ]] \
    || fail "Repository owner or name contains unsupported characters."
}

release_endpoint() {
  local normalized
  normalized="$(normalize_version "$VERSION")"
  if [[ "$normalized" == "latest" ]]; then
    printf 'https://api.github.com/repos/%s/%s/releases/latest' "$REPO_OWNER" "$REPO_NAME"
  else
    printf 'https://api.github.com/repos/%s/%s/releases/tags/%s' "$REPO_OWNER" "$REPO_NAME" "$normalized"
  fi
}

release_page_endpoint() {
  local normalized
  normalized="$(normalize_version "$VERSION")"
  if [[ "$normalized" == "latest" ]]; then
    printf 'https://github.com/%s/%s/releases/latest' "$REPO_OWNER" "$REPO_NAME"
  else
    printf 'https://github.com/%s/%s/releases/tag/%s' "$REPO_OWNER" "$REPO_NAME" "$normalized"
  fi
}

release_version_number_from_tag() {
  local tag="$1"
  if [[ "$tag" == v* ]]; then
    printf '%s' "${tag#v}"
    return 0
  fi
  printf '%s' "$tag"
}

detect_install_payload_kind() {
  local source_root="$1"
  if [[ -f "${source_root}/README-release-light.md" ]]; then
    printf 'release-light'
    return 0
  fi
  printf 'source'
}

resolve_remote_install_payload_plan() {
  local release_json="$1"
  local tag_name="$2"
  local version_number asset_name manifest_name sha256_name
  local asset_url manifest_url sha256_url archive_size archive_digest

  version_number="$(release_version_number_from_tag "$tag_name")"
  [[ "${version_number}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || fail "Failed to resolve a safe release version number from tag."
  asset_name="star-sanctuary-dist-v${version_number}.tar.gz"
  manifest_name="star-sanctuary-dist-v${version_number}.manifest.json"
  sha256_name="star-sanctuary-dist-v${version_number}.sha256"
  asset_url="$(printf '%s' "$release_json" | json_read "(() => { const assets = Array.isArray(data.assets) ? data.assets : []; const hit = assets.find((item) => item && item.name === ${asset_name@Q}); return hit ? hit.browser_download_url : ''; })()")" || asset_url=""
  manifest_url="$(printf '%s' "$release_json" | json_read "(() => { const assets = Array.isArray(data.assets) ? data.assets : []; const hit = assets.find((item) => item && item.name === ${manifest_name@Q}); return hit ? hit.browser_download_url : ''; })()")" || manifest_url=""
  sha256_url="$(printf '%s' "$release_json" | json_read "(() => { const assets = Array.isArray(data.assets) ? data.assets : []; const hit = assets.find((item) => item && item.name === ${sha256_name@Q}); return hit ? hit.browser_download_url : ''; })()")" || sha256_url=""
  archive_size="$(printf '%s' "$release_json" | json_read "(() => { const assets = Array.isArray(data.assets) ? data.assets : []; const hit = assets.find((item) => item && item.name === ${asset_name@Q}); return hit && Number.isSafeInteger(hit.size) ? String(hit.size) : ''; })()")" || archive_size=""
  archive_digest="$(printf '%s' "$release_json" | json_read "(() => { const assets = Array.isArray(data.assets) ? data.assets : []; const hit = assets.find((item) => item && item.name === ${asset_name@Q}); return typeof hit?.digest === 'string' ? hit.digest : ''; })()")" || archive_digest=""

  [[ -n "${asset_url}" && -n "${manifest_url}" && -n "${sha256_url}" ]] \
    || fail "The selected release is missing required verified release-light assets."
  [[ "${archive_size}" =~ ^[0-9]+$ ]] && (( archive_size > 0 && archive_size <= MAX_RELEASE_ARCHIVE_BYTES )) \
    || fail "The release-light archive size is outside the installer limit."

  printf 'release-light|github-release-light|%s|%s|%s|%s|%s|%s|GitHub release-light archive|release-light archive' \
    "${asset_url}" "${manifest_url}" "${sha256_url}" "${asset_name}" "${archive_size}" "${archive_digest}"
}

resolve_release_tag_from_page() {
  local page_url effective_url expected_prefix resolved_tag
  page_url="$(release_page_endpoint)"
  log "Falling back to release page resolution via ${page_url}"
  # 页面回退不需要令牌；只允许 HTTPS 重定向，避免认证信息外流。
  effective_url="$(curl -fsSL --proto '=https' --proto-redir '=https' --max-redirs 5 -H 'User-Agent: Star-Sanctuary-Installer' -o /dev/null -w '%{url_effective}' "${page_url}")" \
    || fail "Failed to resolve release page."

  expected_prefix="https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/"
  if [[ "${effective_url}" == "${expected_prefix}"* ]]; then
    resolved_tag="${effective_url#"${expected_prefix}"}"
    if [[ "${resolved_tag}" =~ ^v[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
      printf '%s' "${resolved_tag}"
      return 0
    fi
  fi

  fail "Failed to resolve release tag from GitHub release page."
}

resolve_remote_install_payload_plan_from_tag() {
  local tag_name="$1"
  local requested_version="$2"
  local normalized version_number asset_name manifest_name sha256_name asset_base_url

  normalized="$(normalize_version "${requested_version}")"
  version_number="$(release_version_number_from_tag "$tag_name")"
  [[ "${version_number}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || fail "Failed to resolve a safe release version number from tag."
  asset_name="star-sanctuary-dist-v${version_number}.tar.gz"
  manifest_name="star-sanctuary-dist-v${version_number}.manifest.json"
  sha256_name="star-sanctuary-dist-v${version_number}.sha256"

  if [[ "${normalized}" == "latest" ]]; then
    asset_base_url="https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest/download/"
  else
    asset_base_url="https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${tag_name}/"
  fi

  printf 'release-light|github-release-light|%s|%s|%s|%s|||GitHub release-light archive|release-light archive' \
    "${asset_base_url}${asset_name}" "${asset_base_url}${manifest_name}" "${asset_base_url}${sha256_name}" "${asset_name}"
}

json_read() {
  local expression="$1"
  node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(0, 'utf8'));
const value = ${expression};
if (value === undefined || value === null) process.exit(1);
if (typeof value === 'string') process.stdout.write(value);
else process.stdout.write(JSON.stringify(value));
  "
}

download_trusted_payload() {
  local source_url="$1"
  local output_path="$2"
  local maximum_bytes="$3"
  local label="$4"

  # 逐跳检查 GitHub 下载重定向，避免将令牌或归档内容交给任意 Host。
  if ! node - "${source_url}" "${output_path}" "${maximum_bytes}" >/dev/null <<'NODE'
const fs = require("node:fs");
const https = require("node:https");
const { URL } = require("node:url");

const args = process.argv.slice(2);
const [sourceUrl, outputPath, maxBytesRaw] = args;
const maxBytes = Number(maxBytesRaw);
const allowedHosts = new Set([
  "github.com",
  "api.github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "github-releases.githubusercontent.com",
]);
const maxRedirects = 5;
const requestTimeoutMs = 120_000;

function fail(message) {
  throw new Error(message);
}

function assertTrustedUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname.toLowerCase())) {
    fail("release download URL is outside the trusted HTTPS host allowlist");
  }
  return url;
}

function headersFor(url) {
  const headers = {
    "User-Agent": "Star-Sanctuary-Installer",
    "Accept": "application/octet-stream",
  };
  const host = url.hostname.toLowerCase();
  if (process.env.GITHUB_TOKEN && (host === "github.com" || host === "api.github.com")) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

function request(url, redirectCount, partialPath) {
  const current = assertTrustedUrl(url);
  return new Promise((resolve, reject) => {
    const req = https.request(current, { method: "GET", headers: headersFor(current) }, (res) => {
      const status = Number(res.statusCode || 0);
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = res.headers.location;
        res.resume();
        if (!location) return reject(new Error("release download redirect did not include a location"));
        if (redirectCount >= maxRedirects) return reject(new Error("release download exceeded redirect limit"));
        return resolve(request(new URL(location, current).toString(), redirectCount + 1, partialPath));
      }
      if (status < 200 || status >= 300) {
        res.resume();
        return reject(new Error(`release download returned HTTP ${status}`));
      }

      const declaredBytes = Number(res.headers["content-length"]);
      if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
        res.resume();
        return reject(new Error("release download exceeds configured byte limit"));
      }

      let bytes = 0;
      let settled = false;
      const output = fs.createWriteStream(partialPath, { flags: "w" });
      const failOnce = (error) => {
        if (settled) return;
        settled = true;
        output.destroy();
        reject(error);
      };

      res.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          res.destroy(new Error("release download exceeds configured byte limit"));
        }
      });
      res.on("error", failOnce);
      output.on("error", failOnce);
      output.on("finish", () => {
        if (settled) return;
        settled = true;
        output.close((error) => {
          if (error) return reject(error);
          try {
            fs.renameSync(partialPath, outputPath);
            resolve(bytes);
          } catch (renameError) {
            reject(renameError);
          }
        });
      });
      res.pipe(output);
    });
    req.setTimeout(requestTimeoutMs, () => req.destroy(new Error("release download timed out")));
    req.on("error", reject);
    req.end();
  });
}

if (!sourceUrl || !outputPath || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
  fail("invalid trusted release download arguments");
}

const partialPath = `${outputPath}.part`;
fs.rmSync(partialPath, { force: true });
request(sourceUrl, 0, partialPath)
  .catch((error) => {
    fs.rmSync(partialPath, { force: true });
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
NODE
  then
    fail "Failed to download ${label} through the trusted release transport."
  fi

  [[ -f "${output_path}" ]] || fail "Trusted download did not create ${label}."
}

get_verified_release_identity() {
  local manifest_path="$1"
  local checksum_path="$2"
  local archive_name="$3"
  local expected_version="$4"

  # `.sha256` 与 manifest 互相校验；签名/attestation 的独立信任根仍由后续发行任务提供。
  node - "${manifest_path}" "${checksum_path}" "${archive_name}" "${expected_version}" \
    "${MAX_RELEASE_ARCHIVE_BYTES}" "${MAX_RELEASE_ARCHIVE_ENTRIES}" "${MAX_RELEASE_ARCHIVE_UNPACKED_BYTES}" <<'NODE'
const crypto = require("node:crypto");
const fs = require("node:fs");

const [manifestPath, checksumPath, archiveName, expectedVersion, maxArchiveBytesRaw, maxEntriesRaw, maxUnpackedBytesRaw] = process.argv.slice(2);
const maxArchiveBytes = Number(maxArchiveBytesRaw);
const maxEntries = Number(maxEntriesRaw);
const maxUnpackedBytes = Number(maxUnpackedBytesRaw);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

const rootName = `star-sanctuary-dist-v${expectedVersion}`;
const manifestName = `${rootName}.manifest.json`;
const expectedNames = new Set([`${rootName}.zip`, `${rootName}.tar.gz`, manifestName]);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
assert(manifest && typeof manifest === "object", "release manifest must be an object");
assert(manifest.schemaVersion === 1, "unsupported release manifest schema");
assert(manifest.product === "star-sanctuary" && manifest.version === expectedVersion, "release manifest identity mismatch");
assert(manifest.releaseKind === "light" && manifest.currentInstallerInput === "release-light-archive", "release manifest is not an installer payload");
assert(manifest.packageRoot === rootName, "release manifest package root mismatch");

const checksums = new Map();
for (const line of fs.readFileSync(checksumPath, "utf8").split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
  const match = /^([a-f0-9]{64})\s+([A-Za-z0-9._-]+)$/i.exec(line);
  assert(match, "invalid release checksum entry");
  const [, hash, name] = match;
  assert(expectedNames.has(name) && !checksums.has(name), "unexpected or duplicate release checksum entry");
  checksums.set(name, hash.toLowerCase());
}
assert(checksums.size === expectedNames.size, "release checksum file is incomplete");
assert(checksums.get(manifestName) === sha256File(manifestPath), "release manifest checksum mismatch");

const archive = Array.isArray(manifest.archives)
  ? manifest.archives.find((item) => item && item.fileName === archiveName)
  : undefined;
assert(archive && archive.format === "tar.gz", "release manifest archive entry is missing or invalid");
assert(typeof archive.sha256 === "string" && /^[a-f0-9]{64}$/i.test(archive.sha256), "release manifest archive hash is invalid");
assert(Number.isSafeInteger(archive.size) && archive.size > 0 && archive.size <= maxArchiveBytes, "release manifest archive size is outside the installer limit");
assert(checksums.get(archiveName) === archive.sha256.toLowerCase(), "release manifest and checksum archive hashes disagree");

const content = manifest.content;
assert(content && Number.isSafeInteger(content.fileCount) && content.fileCount >= 0 && content.fileCount <= maxEntries, "release manifest file count is outside the installer limit");
assert(Number.isSafeInteger(content.totalBytes) && content.totalBytes >= 0 && content.totalBytes <= maxUnpackedBytes, "release manifest unpacked size is outside the installer limit");
process.stdout.write(JSON.stringify({
  packageRoot: rootName,
  archiveSha256: archive.sha256.toLowerCase(),
  archiveSize: archive.size,
  contentFileCount: content.fileCount,
  contentTotalBytes: content.totalBytes,
}));
NODE
}

sha256_file() {
  node -e "const crypto=require('node:crypto');const fs=require('node:fs');process.stdout.write(crypto.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'));" "$1"
}

validate_release_archive() {
  local archive_path="$1"
  local expected_root="$2"
  local expected_file_count="$3"
  local expected_total_bytes="$4"

  # 在 tar 解压前顺序扫描 header；只接受常规文件/目录，拒绝链接、穿越与超量内容。
  node - "${archive_path}" "${expected_root}" "${expected_file_count}" "${expected_total_bytes}" \
    "${MAX_RELEASE_ARCHIVE_ENTRIES}" "${MAX_RELEASE_ARCHIVE_ENTRY_BYTES}" "${MAX_RELEASE_ARCHIVE_UNPACKED_BYTES}" <<'NODE'
const fs = require("node:fs");
const { createGunzip } = require("node:zlib");

const [archivePath, expectedRoot, expectedFileCountRaw, expectedTotalBytesRaw, maxEntriesRaw, maxEntryBytesRaw, maxUnpackedBytesRaw] = process.argv.slice(2);
const expectedFileCount = Number(expectedFileCountRaw);
const expectedTotalBytes = Number(expectedTotalBytesRaw);
const maxEntries = Number(maxEntriesRaw);
const maxEntryBytes = Number(maxEntryBytesRaw);
const maxUnpackedBytes = Number(maxUnpackedBytesRaw);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readText(header, start, length) {
  const text = header.subarray(start, start + length).toString("utf8");
  return text.slice(0, text.indexOf("\0") === -1 ? text.length : text.indexOf("\0"));
}

function readOctal(header, start, length) {
  const raw = readText(header, start, length).trim();
  assert(raw === "" || /^[0-7]+$/.test(raw), "release archive contains an invalid tar size header");
  const value = raw === "" ? 0 : Number.parseInt(raw, 8);
  assert(Number.isSafeInteger(value) && value >= 0, "release archive contains an invalid tar size header");
  return value;
}

function validatePath(rawPath, seen) {
  assert(/^[A-Za-z0-9._/-]+$/.test(rawPath), "release archive contains an unsafe entry path");
  assert(!rawPath.includes("//") && !/(^|\/)(\.|\.\.)(\/|$)/.test(rawPath), "release archive contains an unsafe entry path");
  assert(rawPath === expectedRoot || rawPath.startsWith(`${expectedRoot}/`), "release archive entry is outside the declared package root");
  const key = rawPath.toLowerCase();
  assert(!seen.has(key), "release archive contains a duplicate entry path");
  seen.add(key);
}

async function scanArchive() {
  let buffer = Buffer.alloc(0);
  let dataRemaining = 0;
  let paddingRemaining = 0;
  let zeroBlocks = 0;
  let ended = false;
  let entryCount = 0;
  let fileCount = 0;
  let totalBytes = 0;
  const seen = new Set();

  const processBuffer = () => {
    while (true) {
      if (dataRemaining > 0) {
        const consumed = Math.min(dataRemaining, buffer.length);
        buffer = buffer.subarray(consumed);
        dataRemaining -= consumed;
        if (dataRemaining > 0) return;
      }
      if (paddingRemaining > 0) {
        const consumed = Math.min(paddingRemaining, buffer.length);
        buffer = buffer.subarray(consumed);
        paddingRemaining -= consumed;
        if (paddingRemaining > 0) return;
      }
      if (buffer.length < 512) return;

      const header = buffer.subarray(0, 512);
      buffer = buffer.subarray(512);
      if (header.every((byte) => byte === 0)) {
        zeroBlocks += 1;
        if (zeroBlocks >= 2) ended = true;
        continue;
      }
      assert(!ended, "release archive contains data after tar terminator");
      zeroBlocks = 0;
      entryCount += 1;
      assert(entryCount <= maxEntries, "release archive contains too many entries");

      const name = readText(header, 0, 100);
      const prefix = readText(header, 345, 155);
      const path = prefix ? `${prefix}/${name}` : name;
      const type = String.fromCharCode(header[156] || 0);
      const size = readOctal(header, 124, 12);
      validatePath(path, seen);
      assert(type === "\0" || type === "0" || type === "5", "release archive links and extended tar entries are not allowed");
      if (type === "5") {
        assert(size === 0, "release archive directory entry has unexpected content");
      } else {
        assert(size <= maxEntryBytes, "release archive entry exceeds the configured byte limit");
        assert(totalBytes <= maxUnpackedBytes - size, "release archive exceeds the configured unpacked byte limit");
        fileCount += 1;
        totalBytes += size;
      }
      dataRemaining = size;
      paddingRemaining = (512 - (size % 512)) % 512;
    }
  };

  const source = fs.createReadStream(archivePath);
  const gunzip = createGunzip();
  source.pipe(gunzip);
  for await (const chunk of gunzip) {
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
    processBuffer();
  }
  processBuffer();
  assert(dataRemaining === 0 && paddingRemaining === 0 && ended, "release archive tar stream is incomplete");
  assert(fileCount === expectedFileCount && totalBytes === expectedTotalBytes, "release archive content does not match its manifest");
}

scanArchive().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
NODE
}

write_unix_wrappers() {
  local root="$1"

  cat > "${root}/start.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOTICE_FILE="${SCRIPT_DIR}/first-start-notice.txt"
export STAR_SANCTUARY_RUNTIME_MODE="source"
export BELLDANDY_RUNTIME_MODE="source"
export STAR_SANCTUARY_RUNTIME_DIR="${SCRIPT_DIR}/current"
export BELLDANDY_RUNTIME_DIR="${SCRIPT_DIR}/current"
if [[ -f "${NOTICE_FILE}" ]]; then
  echo "[Star Sanctuary Launcher] Post-install note:"
  cat "${NOTICE_FILE}"
  rm -f "${NOTICE_FILE}"
  echo ""
fi
exec node "${SCRIPT_DIR}/current/packages/belldandy-core/dist/bin/bdd.js" start "$@"
EOF

  cat > "${root}/bdd" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export STAR_SANCTUARY_RUNTIME_MODE="source"
export BELLDANDY_RUNTIME_MODE="source"
export STAR_SANCTUARY_RUNTIME_DIR="${SCRIPT_DIR}/current"
export BELLDANDY_RUNTIME_DIR="${SCRIPT_DIR}/current"
exec node "${SCRIPT_DIR}/current/packages/belldandy-core/dist/bin/bdd.js" "$@"
EOF

  chmod +x "${root}/start.sh" "${root}/bdd"
}

backup_install_root_files() {
  local root="$1"
  local backup_dir="$2"
  shift 2
  mkdir -p "${backup_dir}"
  for file in "$@"; do
    local source_path="${root}/${file}"
    local backup_path="${backup_dir}/${file}"
    if [[ -f "${source_path}" ]]; then
      mkdir -p "$(dirname "${backup_path}")"
      cp "${source_path}" "${backup_path}"
    fi
  done
}

restore_install_root_files() {
  local root="$1"
  local backup_dir="$2"
  shift 2
  for file in "$@"; do
    local target_path="${root}/${file}"
    local backup_path="${backup_dir}/${file}"
    if [[ -f "${backup_path}" ]]; then
      cp "${backup_path}" "${target_path}"
    elif [[ -e "${target_path}" ]]; then
      rm -f "${target_path}"
    fi
  done
}

resolve_state_dir() {
  local home_dir="${HOME}"
  local uname_value
  uname_value="$(uname -s 2>/dev/null || printf '')"

  if [[ "${uname_value}" == "Linux" && -n "${BELLDANDY_STATE_DIR_WSL:-}" && ( -n "${WSL_DISTRO_NAME:-}" || -n "${WSL_INTEROP:-}" ) ]]; then
    printf '%s' "${BELLDANDY_STATE_DIR_WSL/#\~/${home_dir}}"
    return 0
  fi

  if [[ -n "${BELLDANDY_STATE_DIR:-}" ]]; then
    printf '%s' "${BELLDANDY_STATE_DIR/#\~/${home_dir}}"
    return 0
  fi

  if [[ -d "${home_dir}/.star_sanctuary" ]]; then
    printf '%s' "${home_dir}/.star_sanctuary"
    return 0
  fi

  if [[ -d "${home_dir}/.belldandy" ]]; then
    printf '%s' "${home_dir}/.belldandy"
    return 0
  fi

  printf '%s' "${home_dir}/.star_sanctuary"
}

get_setup_step_message() {
  local install_root="$1"
  local state_dir="$2"
  local env_local_path="${state_dir}/.env.local"

  if [[ "${NO_SETUP}" -eq 1 ]]; then
    printf 'Skipping bdd setup (--no-setup)'
    return 0
  fi

  if [[ "${FORCE_SETUP}" -eq 1 ]]; then
    printf 'Launching bdd setup (--force-setup)'
    return 0
  fi

  if [[ -f "${env_local_path}" ]]; then
    printf 'Detected existing .env.local at %s; skipping bdd setup for upgrade handoff' "${env_local_path}"
    return 0
  fi

  printf 'Launching bdd setup'
}

get_setup_summary() {
  local install_root="$1"
  local state_dir="$2"
  local env_local_path="${state_dir}/.env.local"

  if [[ "${NO_SETUP}" -eq 1 ]]; then
    printf 'skipped by --no-setup; run %s/bdd setup when you are ready to refresh config' "${install_root}"
    return 0
  fi

  if [[ "${FORCE_SETUP}" -eq 1 ]]; then
    printf 're-ran during install (--force-setup)'
    return 0
  fi

  if [[ -f "${env_local_path}" ]]; then
    printf 'skipped by default because existing .env.local was preserved; run %s/bdd setup or rerun installer with --force-setup to refresh config' "${install_root}"
    return 0
  fi

  printf 'completed during install'
}

get_first_start_summary() {
  local install_root="$1"
  local state_dir="$2"
  local env_local_path="${state_dir}/.env.local"

  if [[ "${NO_SETUP}" -eq 1 || "${FORCE_SETUP}" -eq 1 ]]; then
    return 0
  fi

  if [[ -f "${env_local_path}" ]]; then
    printf 'will reuse preserved .env.local; run %s/bdd setup later if provider/channel/auth config needs refresh' "${install_root}"
  fi
}

should_run_setup() {
  local _install_root="$1"
  local state_dir="$2"
  local env_local_path="${state_dir}/.env.local"

  if [[ "${NO_SETUP}" -eq 1 ]]; then
    return 1
  fi

  if [[ "${FORCE_SETUP}" -eq 1 ]]; then
    return 0
  fi

  if [[ -f "${env_local_path}" ]]; then
    return 1
  fi

  return 0
}

write_install_metadata() {
  local root="$1"
  local tag="$2"
  local release_name="$3"
  local source_type="$4"

  node -e "
const fs = require('fs');
const path = process.argv[1];
  const payload = {
    productName: 'Star Sanctuary',
    tag: process.argv[2],
    version: process.argv[3],
  source: {
    type: process.argv[6],
    owner: process.argv[4],
    repo: process.argv[5],
    },
    installedAt: new Date().toISOString(),
    currentDir: 'current',
    entrypoints: {
      startSh: 'start.sh',
      bdd: 'bdd',
    },
    notices: {
      firstStart: 'first-start-notice.txt',
  },
};
fs.writeFileSync(path, JSON.stringify(payload, null, 2) + '\n');
" "${root}/install-info.json" "${tag}" "${release_name}" "${REPO_OWNER}" "${REPO_NAME}" "${source_type}"
}

write_first_start_notice() {
  local root="$1"
  shift
  local notice_path="${root}/${FIRST_START_NOTICE_FILE}"
  if [[ "$#" -eq 0 ]]; then
    rm -f "${notice_path}"
    return 0
  fi

  {
    for line in "$@"; do
      printf '%s\n' "$line"
    done
  } > "${notice_path}"
}

if [[ -z "$INSTALL_DIR" ]]; then
  if [[ -n "${XDG_DATA_HOME:-}" ]]; then
    INSTALL_DIR="${XDG_DATA_HOME}/star-sanctuary"
  else
    INSTALL_DIR="${HOME}/.local/share/star-sanctuary"
  fi
fi

mkdir -p "$(dirname "$INSTALL_DIR")"
mkdir -p "$INSTALL_DIR"
INSTALL_ROOT="$(cd "$INSTALL_DIR" && pwd)"
CURRENT_ROOT="${INSTALL_ROOT}/current"
BACKUP_ROOT="${INSTALL_ROOT}/backups"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/star-sanctuary-install-XXXXXX")"
MANAGED_INSTALL_FILES=("start.sh" "bdd" "install-info.json" "${FIRST_START_NOTICE_FILE}")
INSTALL_ROOT_FILES_BACKUP_DIR="${TEMP_ROOT}/install-root-files-backup"
BACKUP_PATH=""
INSTALL_SUCCEEDED=0
SETUP_STEP_MESSAGE=""
SETUP_SUMMARY=""
FIRST_START_SUMMARY=""
INSTALL_STATE_DIR=""

if [[ "${NO_SETUP}" -eq 1 && "${FORCE_SETUP}" -eq 1 ]]; then
  fail "--no-setup and --force-setup cannot be used together."
fi

ensure_node_runtime

NORMALIZED_VERSION="$(normalize_version "$VERSION")"
INSTALL_PAYLOAD_KIND=""
INSTALL_SOURCE_TYPE=""
REMOTE_PLAN=""
if [[ -n "${SOURCE_DIR}" ]]; then
  SOURCE_DIR="$(cd "${SOURCE_DIR}" && pwd)" || fail "Source dir not found: ${SOURCE_DIR}"
  INSTALL_PAYLOAD_KIND="$(detect_install_payload_kind "${SOURCE_DIR}")"
  if [[ "${INSTALL_PAYLOAD_KIND}" == "release-light" ]]; then
    INSTALL_SOURCE_TYPE="local-release-light"
  else
    INSTALL_SOURCE_TYPE="local-source"
  fi
  TAG_NAME="${NORMALIZED_VERSION}"
  if [[ "${TAG_NAME}" == "latest" ]]; then
    TAG_NAME="${INSTALL_SOURCE_TYPE}"
  fi
  RELEASE_NAME="${TAG_NAME}"
  log "Using local ${INSTALL_PAYLOAD_KIND} override from ${SOURCE_DIR}"
else
  validate_repository_identity
  ENDPOINT="$(release_endpoint)"
  log "Fetching release metadata from ${ENDPOINT}"
  if RELEASE_JSON="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'User-Agent: Star-Sanctuary-Installer' "${github_headers[@]}" "${ENDPOINT}")"; then
    TAG_NAME="$(printf '%s' "$RELEASE_JSON" | json_read 'data.tag_name')" || fail "Failed to resolve release tag."
    RELEASE_NAME="$(printf '%s' "$RELEASE_JSON" | json_read 'data.name || data.tag_name')" || fail "Failed to resolve release name."
    REMOTE_PLAN="$(resolve_remote_install_payload_plan "$RELEASE_JSON" "$TAG_NAME")"
  else
    log "GitHub API release metadata fetch failed; falling back to GitHub release page resolution. Set GITHUB_TOKEN to raise API rate limits when available."
    TAG_NAME="$(resolve_release_tag_from_page)"
    RELEASE_NAME="${TAG_NAME}"
    REMOTE_PLAN="$(resolve_remote_install_payload_plan_from_tag "$TAG_NAME" "$VERSION")"
  fi
  IFS='|' read -r INSTALL_PAYLOAD_KIND INSTALL_SOURCE_TYPE ARCHIVE_URL MANIFEST_URL SHA256_URL ARCHIVE_NAME ARCHIVE_DECLARED_SIZE ARCHIVE_API_DIGEST DOWNLOAD_LABEL EXTRACT_LABEL <<< "${REMOTE_PLAN}"
fi

log "Installing Star Sanctuary ${TAG_NAME} into ${INSTALL_ROOT}"

if [[ -n "${SOURCE_DIR}" ]]; then
  SOURCE_ROOT="${SOURCE_DIR}"
else
  ARCHIVE_PATH="${TEMP_ROOT}/${ARCHIVE_NAME}"
  MANIFEST_PATH="${TEMP_ROOT}/release-light.manifest.json"
  CHECKSUM_PATH="${TEMP_ROOT}/release-light.sha256"
  EXTRACT_ROOT="${TEMP_ROOT}/extract"
  mkdir -p "${EXTRACT_ROOT}"

  log "Downloading release identity metadata"
  download_trusted_payload "${MANIFEST_URL}" "${MANIFEST_PATH}" "${MAX_RELEASE_METADATA_BYTES}" "release manifest"
  download_trusted_payload "${SHA256_URL}" "${CHECKSUM_PATH}" "${MAX_RELEASE_METADATA_BYTES}" "release checksum"
  RELEASE_IDENTITY="$(get_verified_release_identity "${MANIFEST_PATH}" "${CHECKSUM_PATH}" "${ARCHIVE_NAME}" "$(release_version_number_from_tag "${TAG_NAME}")")" \
    || fail "Release identity validation failed."
  PACKAGE_ROOT="$(printf '%s' "${RELEASE_IDENTITY}" | json_read 'data.packageRoot')" || fail "Release identity package root is invalid."
  MANIFEST_ARCHIVE_HASH="$(printf '%s' "${RELEASE_IDENTITY}" | json_read 'data.archiveSha256')" || fail "Release identity archive hash is invalid."
  MANIFEST_ARCHIVE_SIZE="$(printf '%s' "${RELEASE_IDENTITY}" | json_read 'data.archiveSize')" || fail "Release identity archive size is invalid."
  MANIFEST_FILE_COUNT="$(printf '%s' "${RELEASE_IDENTITY}" | json_read 'data.contentFileCount')" || fail "Release identity file count is invalid."
  MANIFEST_TOTAL_BYTES="$(printf '%s' "${RELEASE_IDENTITY}" | json_read 'data.contentTotalBytes')" || fail "Release identity unpacked size is invalid."

  if [[ -n "${ARCHIVE_DECLARED_SIZE}" && "${ARCHIVE_DECLARED_SIZE}" != "${MANIFEST_ARCHIVE_SIZE}" ]]; then
    fail "Release metadata and manifest archive sizes disagree."
  fi
  if [[ -n "${ARCHIVE_API_DIGEST}" ]]; then
    [[ "${ARCHIVE_API_DIGEST}" =~ ^sha256:[a-f0-9]{64}$ && "${ARCHIVE_API_DIGEST#sha256:}" == "${MANIFEST_ARCHIVE_HASH}" ]] \
      || fail "Release metadata and manifest archive hashes disagree."
  fi

  log "Downloading ${DOWNLOAD_LABEL}"
  download_trusted_payload "${ARCHIVE_URL}" "${ARCHIVE_PATH}" "${MAX_RELEASE_ARCHIVE_BYTES}" "release archive"
  ARCHIVE_HASH="$(sha256_file "${ARCHIVE_PATH}")" || fail "Failed to calculate release archive hash."
  [[ "${ARCHIVE_HASH}" == "${MANIFEST_ARCHIVE_HASH}" ]] || fail "Release archive hash does not match its manifest."

  log "Scanning verified archive entries before extracting"
  validate_release_archive "${ARCHIVE_PATH}" "${PACKAGE_ROOT}" "${MANIFEST_FILE_COUNT}" "${MANIFEST_TOTAL_BYTES}" \
    || fail "Release archive validation failed."
  log "Extracting ${EXTRACT_LABEL}"
  tar -xzf "${ARCHIVE_PATH}" -C "${EXTRACT_ROOT}" || fail "Failed to extract ${EXTRACT_LABEL}."

  SOURCE_ROOT="${EXTRACT_ROOT}/${PACKAGE_ROOT}"
  [[ -d "${SOURCE_ROOT}" ]] || fail "Failed to locate the verified extracted package root."
fi

mkdir -p "${INSTALL_ROOT}" "${BACKUP_ROOT}"
backup_install_root_files "${INSTALL_ROOT}" "${INSTALL_ROOT_FILES_BACKUP_DIR}" "${MANAGED_INSTALL_FILES[@]}"
if [[ -d "${CURRENT_ROOT}" ]]; then
  BACKUP_PATH="${BACKUP_ROOT}/current-$(date +%Y%m%d-%H%M%S)"
  log "Backing up existing installation to ${BACKUP_PATH}"
  mv "${CURRENT_ROOT}" "${BACKUP_PATH}"
  run_test_fail_point "after_backup"
fi

if [[ -n "${SOURCE_DIR}" ]]; then
  if [[ "${SKIP_INSTALL_BUILD}" -eq 1 ]]; then
    log "Promoting local source override into current/ via symlink"
    new_source_symlink "${CURRENT_ROOT}" "${SOURCE_ROOT}"
  else
    log "Copying local source override into current/ for isolated install/build"
    copy_source_tree "${SOURCE_ROOT}" "${CURRENT_ROOT}"
  fi
else
  log "Promoting extracted source tree into current/"
  mv "${SOURCE_ROOT}" "${CURRENT_ROOT}"
fi
run_test_fail_point "after_promote"

run_test_fail_point "before_install_build"
if [[ "${SKIP_INSTALL_BUILD}" -eq 0 ]]; then
  PACKAGE_MANAGER="$(node -e "const fs=require('fs');const path=require('path');const pkg=JSON.parse(fs.readFileSync(path.join(process.argv[1],'package.json'),'utf8'));process.stdout.write(pkg.packageManager || 'pnpm@10');" "${CURRENT_ROOT}")" \
    || fail "Failed to resolve packageManager from package.json."

  log "Activating ${PACKAGE_MANAGER} via corepack"
  corepack prepare "${PACKAGE_MANAGER}" --activate >/dev/null || fail "corepack prepare ${PACKAGE_MANAGER} failed."

  (
    cd "${CURRENT_ROOT}"
    if [[ "${INSTALL_PAYLOAD_KIND}" == "release-light" ]]; then
      log "Installing production workspace dependencies from release-light package"
      corepack pnpm install --prod --frozen-lockfile || fail "corepack pnpm install failed."
    else
      log "Installing workspace dependencies"
      corepack pnpm install || fail "corepack pnpm install failed."

      log "Building workspace"
      corepack pnpm build || fail "corepack pnpm build failed."
    fi
  )
else
  log "Skipping dependency install/build (--skip-install-build)"
fi
if [[ -f "${CURRENT_ROOT}/start.sh" ]]; then
  chmod +x "${CURRENT_ROOT}/start.sh"
fi

write_unix_wrappers "${INSTALL_ROOT}"
write_install_metadata "${INSTALL_ROOT}" "${TAG_NAME}" "${RELEASE_NAME}" "${INSTALL_SOURCE_TYPE}"
INSTALL_STATE_DIR="$(resolve_state_dir)"

SETUP_STEP_MESSAGE="$(get_setup_step_message "${INSTALL_ROOT}" "${INSTALL_STATE_DIR}")"
SETUP_SUMMARY="$(get_setup_summary "${INSTALL_ROOT}" "${INSTALL_STATE_DIR}")"
FIRST_START_SUMMARY="$(get_first_start_summary "${INSTALL_ROOT}" "${INSTALL_STATE_DIR}")"

if should_run_setup "${INSTALL_ROOT}" "${INSTALL_STATE_DIR}"; then
  log "${SETUP_STEP_MESSAGE}"
  run_test_fail_point "before_setup"
  "${INSTALL_ROOT}/bdd" setup || fail "'bdd setup' failed."
else
  log "${SETUP_STEP_MESSAGE}"
fi

if [[ -n "${FIRST_START_SUMMARY}" ]]; then
  write_first_start_notice "${INSTALL_ROOT}" \
    "[NOTICE] Upgrade preserved your existing .env.local and skipped bdd setup." \
    "[NOTICE] This first start will reuse your current config." \
    "[NOTICE] If provider, channel, or auth settings need refresh, run: ${INSTALL_ROOT}/bdd setup" \
    "[NOTICE] Or rerun the installer with --force-setup."
else
  write_first_start_notice "${INSTALL_ROOT}"
fi

log "Install complete."
printf '  Install root: %s\n' "${INSTALL_ROOT}"
printf '  Start:        %s\n' "${INSTALL_ROOT}/start.sh"
printf '  CLI:          %s\n' "${INSTALL_ROOT}/bdd"
printf '  Setup:        %s\n' "${SETUP_SUMMARY}"
if [[ -n "${FIRST_START_SUMMARY}" ]]; then
  printf '  First start:  %s\n' "${FIRST_START_SUMMARY}"
fi
INSTALL_SUCCEEDED=1
