# Security Configuration Guide (English Summary)

Updated: 2026-03-18

This is a short English summary of the full Chinese guide:

- [安全变量配置建议方案.md](./安全变量配置建议方案.md)

## Quick Recommendation

If you want one default choice instead of tuning every variable:

- Use the `balanced` profile by default
- Use `strict` if this is mostly a local, single-user workstation
- Use `open` only when you explicitly need broader integrations such as Community API, Webhook, browser automation, MCP, or wider file access

## What This Guide Covers

This summary focuses on the variables that directly affect security boundaries:

- file read/write scope
- inbound network exposure
- outbound network behavior
- command execution permissions
- browser automation scope
- WebSocket / Community API / Webhook authentication surface

It does not try to cover:

- memory quality tuning
- token cost optimization
- general model selection

## Key Code-Level Findings

### 1. `BELLDANDY_HOST=0.0.0.0` cannot be combined with `BELLDANDY_AUTH_MODE=none`

This is enforced by code, not just documentation.

Practical takeaway:

- public or LAN binding must use `token` or `password`
- `none` is only acceptable for localhost-only use

### 2. `BELLDANDY_COMMUNITY_API_ENABLED=true` also requires authentication

The gateway refuses to start if Community API is enabled while auth mode is `none`.

Practical takeaway:

- if you enable `/api/message`
- also enable auth
- prefer a dedicated `BELLDANDY_COMMUNITY_API_TOKEN`

### 3. `BELLDANDY_ALLOWED_ORIGINS` only protects WebSocket Origin checks

It does not automatically secure every HTTP endpoint.

Practical takeaway:

- do not treat it as a full-service ACL
- it mainly helps defend the WebSocket side against cross-site usage

### 4. Paired Web clients are high-privilege clients

The frontend can use raw config endpoints to read and overwrite `.env` after pairing succeeds.

Practical takeaway:

- pairing is not a lightweight permission model
- pairing approval effectively grants admin-style configuration access

### 5. `BELLDANDY_DANGEROUS_TOOLS_ENABLED=false` only disables `run_command`

It does not disable tools such as:

- `file_read`
- `file_write`
- `file_delete`
- `apply_patch`
- `web_fetch`

Practical takeaway:

- this is not a global safety switch
- the real coarse switch is `BELLDANDY_TOOLS_ENABLED`
- the real fine-grained boundary is `BELLDANDY_TOOLS_POLICY_FILE`

### 6. `BELLDANDY_EXTRA_WORKSPACE_ROOTS` materially expands file and filesystem MCP scope

Practical takeaway:

- only add the smallest necessary project roots
- avoid broad roots like `E:\` or `D:\`

### 7. Browser Relay itself is localhost-only, but browser target domains are unrestricted unless you configure them

Supported variables:

- `BELLDANDY_BROWSER_OUTBOUND_PROFILE` (`public-web` by default; use `privileged-local-browser` only for explicit private-network automation)
- `BELLDANDY_BROWSER_ALLOWED_DOMAINS`
- `BELLDANDY_BROWSER_DENIED_DOMAINS`

Practical takeaway:

- keep `public-web` unless private-network automation is required
- if `privileged-local-browser` is enabled, configure the smallest possible domain allowlist at the same time
- the legacy `BELLDANDY_BROWSER_ALLOW_PRIVATE_NETWORK` boolean no longer elevates browser access

## Recommended Profiles

### Strict

Use when:

- this is a mostly local machine
- you want the smallest possible write surface
- you do not need browser automation, MCP, or command execution

Typical shape:

- `BELLDANDY_HOST=127.0.0.1`
- `BELLDANDY_AUTH_MODE=token`
- `BELLDANDY_COMMUNITY_API_ENABLED=false`
- `BELLDANDY_DANGEROUS_TOOLS_ENABLED=false`
- `BELLDANDY_MCP_ENABLED=false`
- `BELLDANDY_BROWSER_RELAY_ENABLED=false`
- `BELLDANDY_TOOLS_POLICY_FILE=.../tools-policy.strict.json`

### Balanced

Use when:

- this is your normal development setup
- you want tools and workspace editing
- you do not want to expose too much at once

Typical shape:

- localhost binding
- token auth
- tools enabled
- `run_command` still disabled
- one or a few explicit extra workspace roots
- `BELLDANDY_TOOLS_POLICY_FILE=.../tools-policy.balanced.json`

### Controlled Open

Use when:

- you need Community API, Webhook, browser automation, MCP, or wider execution scope
- you are willing to add explicit policy restrictions instead of relying on defaults

Typical shape:

- token auth required
- explicit `BELLDANDY_ALLOWED_ORIGINS`
- dedicated `BELLDANDY_COMMUNITY_API_TOKEN`
- explicit browser domain allow/deny lists
- explicit tools policy file

### Maximum Capability

Use when:

- you explicitly want the widest tool surface for a trusted local operator setup
- you accept `run_command`, binary writes, dotfile writes, and unrestricted public-domain fetches
- you still want a policy file, but you do not want domain or extension allowlists to be the default boundary

Typical shape:

- localhost binding still recommended
- token auth still required
- `BELLDANDY_DANGEROUS_TOOLS_ENABLED=true`
- `BELLDANDY_TOOLS_POLICY_FILE=.../tools-policy.max.json`
- formatter executables are blocked explicitly by command name instead of by semantic classification

## Related Files

Built-in policy examples:

- [`../config/tools-policy.strict.json`](/E:/project/star-sanctuary/config/tools-policy.strict.json)
- [`../config/tools-policy.balanced.json`](/E:/project/star-sanctuary/config/tools-policy.balanced.json)
- [`../config/tools-policy.open.json`](/E:/project/star-sanctuary/config/tools-policy.open.json)
- [`../config/tools-policy.max.json`](/E:/project/star-sanctuary/config/tools-policy.max.json)

Full Chinese guide:

- [安全变量配置建议方案.md](./安全变量配置建议方案.md)
