# TUI Performance Gate

该 Gate 使用真实构建产物和真实 PTY，按平台分别测量 `startup`、`resize`、`inputReplay` 与 `exit`。Windows 使用 ConPTY，WSL2 使用 Python Unix PTY；两者都执行首帧、窄屏/恢复、mouse 切页、256 字符输入回放和 `Ctrl+C` 退出，并要求终端 mode、PTY owner、已观察进程和临时 state 全部收敛。

```powershell
corepack pnpm build
corepack pnpm benchmark:tui-performance
corepack pnpm verify:tui-performance
```

也可分别执行 `benchmark:tui-performance:windows` 和 `benchmark:tui-performance:wsl`。正式报告为 `tui-performance-report/v1`，默认写入 `artifacts/benchmarks/p1b-tui-performance.json`；`verify:tui-performance` 会从原始样本重新计算所有摘要和历史 Gate，拒绝手工改写的派生指标。

分位数使用 nearest-rank；抖动率固定为 `(p99 - p50) / max(p50, 1ms)`。p99 上限为 `baseline * p99Ratio + p99AllowanceMs`，抖动上限为 `baseline * jitterRateRatio + jitterRateAllowance`。Windows 与 WSL2 只使用各自 baseline，不能交叉替代。

首次或明确批准的重新校准可加 `--calibration` 生成 `tui-performance-calibration/v1` 候选报告。该模式不会自动更新 baseline；维护者必须审查平台指纹、全部样本和零残留证据后，手工更新 `v1/baseline.json`。缺少构建产物、`node-pty`、WSL/Python，平台指纹不符，交互/清理失败，样本少于 5 个或历史退化时均失败关闭。
