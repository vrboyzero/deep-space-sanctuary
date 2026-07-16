# Star Sanctuary Browser Relay Extension

这个 Chrome 扩展用于把真实浏览器连接到 Star Sanctuary 的本地 Relay Server，让 Agent 能操作你当前浏览器中的页面和登录态。

## 它的作用

扩展本身不是浏览器自动化的全部，它负责把 Chrome 标签页接到本地 Relay。

完整链路是：

1. Star Sanctuary / `bdd relay` 启动本地 Relay Server
2. Chrome 扩展连接到 Relay
3. Agent 通过 Relay 间接控制浏览器页面

## 安装步骤

### 1. 启动 Relay

推荐方式：

```bash
corepack pnpm bdd relay start --port 28892
```

或者在 Gateway 配置中启用自动启动：

```env
BELLDANDY_BROWSER_RELAY_ENABLED=true
BELLDANDY_RELAY_PORT=28892
```

Relay 会为 state directory 生成本机凭据。运行下面的显式命令取得它，再在扩展的“选项”页面填写端口和凭据：

```bash
corepack pnpm bdd relay credential
```

> Relay 凭据只在 WebSocket 握手中传递，不会写入连接 URL；不要把凭据写入仓库或截图中。

手动启动 Relay 时，Gateway 中的 Browser Tool 也必须取得同一个凭据；将命令输出的值写入本机 `.env.local` 的 `BELLDANDY_RELAY_TOKEN`。使用 Gateway 自动启动 Relay 时，该凭据会在进程内自动注入，无需额外配置。

### 2. 安装扩展

1. 打开 Chrome，进入 `chrome://extensions/`
2. 开启右上角“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择当前目录：`apps/browser-extension`

## 使用方法

### 首次连接

1. 确保本地 Relay 已经启动
2. 点击 Chrome 工具栏中的 `Star Sanctuary Browser Relay` 图标
3. 扩展会自动尝试连接本地 Relay

### 状态说明

扩展图标徽标会显示这些状态：

- `ON`：连接成功
- `OFF`：当前未连接
- `ERR`：连接失败
- `...`：正在连接

### 成功标志

满足任一即可判断基本连通：

- 扩展图标显示 `ON`
- Relay / Gateway 日志中出现扩展连接成功相关输出
- Agent 能正常使用浏览器工具，如打开页面、截图、点击、输入、抓取快照

## 常见建议

- 如果你想复用网站登录态，先在 Chrome 中手动登录，再让 Agent 接管
- 如果连接失败，先确认 28892 端口没有被占用
- 如果你修改了 Relay 端口，扩展连接端口也必须保持一致
- 如果当前活动标签页是 WebChat，建议优先让 Agent 使用 `browser_open` 新开标签页，避免误导航

## 相关文档

- [README.md](../../README.md)
