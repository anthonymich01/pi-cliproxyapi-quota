# pi-cliproxyapi-quota

[![npm version](https://img.shields.io/npm/v/pi-cliproxyapi-quota.svg)](https://www.npmjs.com/package/pi-cliproxyapi-quota)
[![license](https://img.shields.io/npm/l/pi-cliproxyapi-quota.svg)](./LICENSE)

**English** | [中文](#中文说明)

A [pi](https://pi.dev) extension for users who route their AI subscriptions into pi through
[CLIProxyAPI / EasyCLIProxyAPI](https://github.com/router-for-me/EasyCLIProxyAPI).

It surfaces subscription limits for reverse-proxied models inside pi:

- **Quota** — see subscription limits for **every OAuth provider** the proxy holds without leaving pi.

Supported providers: **Claude**, **Antigravity / Gemini Code Assist**, and **Kimi** (verified), plus
**Codex** and **xAI / Grok** (best‑effort, shown as `(unverified)` until confirmed against a real
account — see [Scope](#scope--limitations)).

## Features

| Trigger | What it does |
|---|---|
| `/quota` | For each credential the proxy holds, show every quota window: used %, remaining %, reset countdown. |
| `Ctrl+Shift+Q` | Same as `/quota`, but works **while the model is streaming** (it's a shortcut, not a queued command). |
| footer `Quota[claude] 5h 64% left · 7d 95% left` | Remaining % for the provider of the **current model** (follows model switches; falls back to the first credential). Color-coded by quota availability and reset countdown urgency; auto-shown on startup and refreshed every 3 minutes (idle or prompting). |

### Color-Coded Quota & Countdown

The status bar footer features dynamic ANSI colors so you can immediately see quota availability and reset countdown urgency:

- **Remaining Percentage (`% left`)**:
  - 🟢 **Green** (`> 75%` left): Quota is ample.
  - 🟡 **Yellow** (`51%–75%` left): Moderate consumption.
  - 🟠 **Orange** (`26%–50%` left): Running lower.
  - 🔴 **Red** (`≤ 25%` left): Low or exhausted quota.

- **Reset Countdown (`↻`)**:
  - 🟢 **Green** (`< 1 hour` remaining, e.g. `↻ 59m`, `↻ 45m`): Limit resets very soon (applies to both 5-hour session and 7-day weekly windows).
  - 🟡 **Yellow** (`< 3 days` remaining, e.g. `↻ 2d1h`, `↻ 1d1h`): For 7-day weekly windows approaching reset.
  - **Default / Dim** (e.g. `↻ 2h1m`, `↻ 5d18h`): Reset is still further out (`≥ 1 hour` for 5h windows, `≥ 3 days` for 7d windows).

The quota data path mirrors the EasyCLIProxyAPI control panel exactly: the proxy management API
`POST /v0/management/api-call` proxies each provider's own usage endpoint (e.g. Anthropic
`/api/oauth/usage`, Google `retrieveUserQuotaSummary`) using the stored OAuth credential. These
endpoints report utilization; they do not consume quota. Disabled credentials are skipped.

## Install

```bash
pi install git:github.com/anthonymich01/pi-cliproxyapi-quota
```

Or load a local checkout by adding its path to `~/.pi/agent/settings.json`:

```json
{ "extensions": ["/absolute/path/to/pi-cliproxyapi-quota/index.ts"] }
```

Reload pi (`/reload`) after installing.

## Configuration

No secrets are stored in this package. At runtime it resolves:

**Base URL** (proxy): `CLIPROXYAPI_BASE_URL` → `~/.pi/agent/cliproxyapi.json` `baseUrl` → `http://127.0.0.1:8317`

**Management key** (required for `/quota`), in order:
1. env `CLIPROXYAPI_MANAGEMENT_KEY`
2. `~/.pi/agent/cliproxyapi-quota.json` → `{ "managementKey": "..." }`
3. EasyCLIProxyAPI GUI `config.toml` (`management-secret-key`), auto‑located per‑OS:
   - macOS: `~/Library/Application Support/com.cpa.gui/config.toml`
   - Linux: `$XDG_CONFIG_HOME/com.cpa.gui/config.toml`
   - Windows: `%APPDATA%\com.cpa.gui\config.toml`

If you don’t run the GUI, set `CLIPROXYAPI_MANAGEMENT_KEY` (must match your proxy's
`remote-management.secret-key`) or the JSON override.

## Scope & limitations

- **Verified** (tested against live accounts): `claude`, `antigravity` / `gemini`.
- **Unverified** (ported from the EasyCLIProxyAPI panel, endpoints + parsers wired but not yet tested
  against a real account): `codex`, `xai` / `grok`. These are labelled `(unverified)` in the
  output. If one is wrong for your account, please open an issue with the raw response — easy to fix.
- Reads a local management key to call the localhost management API; nothing is sent anywhere except
  your own proxy and each provider's usage endpoint (through that proxy). Disabled credentials are skipped.

## License

MIT

---

## 中文说明

适用于通过 [CLIProxyAPI / EasyCLIProxyAPI](https://github.com/router-for-me/EasyCLIProxyAPI)
把各 AI 订阅接入 [pi](https://pi.dev) 的用户。它补上了 pi 对反向代理模型不暴露的订阅配额：

- **额度** — 在 pi 里直接看代理持有的**每个 OAuth 提供方**的订阅限额。

支持的提供方：**Claude**、**Antigravity / Gemini Code Assist**、**Kimi**（已验证），以及 **Codex**、
**xAI / Grok**（尽力支持，在真实账号上校准前显示为 `(unverified)`）。

### 功能

| 触发 | 作用 |
|---|---|
| `/quota` | 对代理持有的每个凭证，显示其所有配额窗口：已用 %、剩余 %、重置倒计时。 |
| `Ctrl+Shift+Q` | 同 `/quota`，但**模型正在输出时也能按**（快捷键，不会被排队）。 |
| footer `Quota[claude] 5h 64% left · 7d 95% left` | 显示**当前模型**对应服务的剩余 %（随模型切换，取不到时回退到第一个凭证）；额度与倒计时带有色彩指示，启动即显示并每 3 分钟自动刷新（空闲或对话中均生效）。 |

### 状态栏彩色高亮与重置倒计时

底部状态栏配额采用动态 ANSI 彩色高亮显示，一眼看清额度裕量与重置紧迫程度：

- **剩余百分比 (`% left`)**:
  - 🟢 **绿色** (`> 75%` 剩余): 额度充裕。
  - 🟡 **黄色** (`51%–75%` 剩余): 消耗适中。
  - 🟠 **橙色** (`26%–50%` 剩余): 额度偏低。
  - 🔴 **红色** (`≤ 25%` 剩余): 额度告急。

- **重置倒计时 (`↻`)**:
  - 🟢 **绿色** (`< 1 小时`，例如 `↻ 59m`、`↻ 45m`): 即将重置刷新（适用于 5 小时会话和 7 天周额度）。
  - 🟡 **黄色** (`< 3 天`，例如 `↻ 2d1h`、`↻ 1d1h`): 适用于 7 天周配额窗口临近重置。
  - **默认暗淡**（例如 `↻ 2h1m`、`↻ 5d18h`）: 距离重置尚早（5 小时窗口 `≥ 1 小时`，7 天窗口 `≥ 3 天`）。

取数链路与 EasyCLIProxyAPI 控制面板完全一致：代理管理 API `POST /v0/management/api-call`
用存储的 OAuth 凭证代理请求各提供方自己的用量端点（如 Anthropic `/api/oauth/usage`、
Google `retrieveUserQuotaSummary`）。这些端点只报告用量，不消耗额度；禁用的凭证会跳过。

### 安装

```bash
pi install git:github.com/anthonymich01/pi-cliproxyapi-quota
```

或把本地目录的路径加到 `~/.pi/agent/settings.json`：

```json
{ "extensions": ["/absolute/path/to/pi-cliproxyapi-quota/index.ts"] }
```

安装后 `/reload` 重载 pi。

### 配置

本包不存储任何密钥，运行时解析：

**Base URL**（代理）：`CLIPROXYAPI_BASE_URL` → `~/.pi/agent/cliproxyapi.json` 的 `baseUrl` → `http://127.0.0.1:8317`

**管理密钥**（`/quota` 必需），按顺序：
1. 环境变量 `CLIPROXYAPI_MANAGEMENT_KEY`
2. `~/.pi/agent/cliproxyapi-quota.json` 的 `{ "managementKey": "..." }`
3. EasyCLIProxyAPI GUI 的 `config.toml`（`management-secret-key`），按系统自动定位：
   - macOS：`~/Library/Application Support/com.cpa.gui/config.toml`
   - Linux：`$XDG_CONFIG_HOME/com.cpa.gui/config.toml`
   - Windows：`%APPDATA%\com.cpa.gui\config.toml`

不用 GUI 的话，设置 `CLIPROXYAPI_MANAGEMENT_KEY`（需与代理的 `remote-management.secret-key` 一致）或用上述 JSON 覆盖。

### 范围与限制

- **已验证**（在真实账号上实测）：`claude`、`antigravity` / `gemini`。
- **未验证**（按 EasyCLIProxyAPI 面板移植，端点与解析已接但未在真实账号上跑过）：`codex`、
  `xai` / `grok`，输出里标 `(unverified)`。若某家在你账号上不对，请带原始返回开 issue，很容易修。
- 仅读取本地管理密钥去调本机管理 API；除了你自己的代理和（经代理的）各提供方用量端点，不向任何地方发送数据；禁用的凭证会跳过。

### 许可证

MIT
