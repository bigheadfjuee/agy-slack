# agy-slack

[繁體中文](#繁體中文) | [English](#english)

---

## 繁體中文

讓 Slack 透過 **Socket Mode** 直接與本機 **Google Antigravity CLI (`agy`)** 通訊的 TypeScript / Node.js Bridge。

### 功能特色

- **Socket Mode 免對外公開網址**：無需 ngrok 或公開 HTTPS endpoint，直接在本機或企業內網啟動即可連線 Slack。
- **企業 Proxy 支援**：支援 `SLACK_PROXY_URL`，預設自動繼承 `HTTPS_PROXY` / `HTTP_PROXY` 環境變數（設為 `none` 可停用）。
- **Thread 對應 Conversation 續聊**：同一個 Slack thread 自動綁定同一個 `agy` `conversation_id`（透過 `--conversation` 續接上下文），後續在 thread 內回覆不需重複 `@mention`。
- **即時串流更新回覆**：透過 `agy --print --output-format stream-json` 解析 NDJSON 串流事件，節流更新 Slack 訊息並顯示工具執行狀態。
- **可中斷執行**：回覆中的訊息附帶 **Cancel** 按鈕，也支援 `!cancel` 強制中止執行中的 `agy` 行程。
- **啟動暫時性網路錯誤自動重試**：針對透過 Proxy 執行 `agy` 時可能出現的暫時性啟動連線錯誤（如 `Eligibility check failed ... EOF`），會自動重試最多 2 次。
- **長訊息自動分段 & Markdown 轉換**：自動將 Markdown 轉為 Slack `mrkdwn`，超過字數上限時自動分段並保持程式碼區塊完整。
- **權限控制**：支援 `SLACK_ALLOWED_USERS` 與 `SLACK_ALLOWED_CHANNELS` 白名單保護本機環境安全，且專案 `.env` 優先覆寫系統環境變數。

### 事前準備

1. **Node.js >= 20** 與 **pnpm**
2. **已安裝並登入 Antigravity CLI (`agy`)**：先在終端機確認 `agy --version` 可正常執行且已完成驗證。
3. **Slack Workspace 權限**（可建立並安裝 Slack App）。

### 快速設定 Slack App（使用 Manifest，約 1 分鐘）

1. 前往 [Slack API Apps](https://api.slack.com/apps) 點選 **Create New App** → **From a manifest**。
2. 選擇你的 Workspace，貼上專案內的 [`slack-app-manifest.yaml`](./slack-app-manifest.yaml) 內容並建立。
3. 取得 **App-Level Token (`xapp-...`)**：
   - 進入 **Basic Information** → **App-Level Tokens** → **Generate Token and Scopes**
   - 命名（例如 `socket-mode`），加入 Scope：`connections:write`
   - 複製產生的 `xapp-...` token。
4. 取得 **Bot User OAuth Token (`xoxb-...`)**：
   - 進入 **Install App** → **Install to Workspace**
   - 複製 **Bot User OAuth Token** (`xoxb-...`)。
5. 將 Bot 邀請進想使用的頻道（例如 `/invite @Antigravity`），或直接傳送 DM 給 Bot。

### 安裝與啟動

```bash
# 1. 安裝相依套件
pnpm install

# 2. 建立環境變數設定檔
cp .env.example .env
# 編輯 .env，填入 SLACK_BOT_TOKEN、SLACK_APP_TOKEN、SLACK_ALLOWED_USERS 與 AGY_WORKDIR 等設定

# 3. 開發模式啟動（檔案變更自動重載）
pnpm dev

# 或建置後啟動
pnpm build
pnpm start:prod
```

### 使用方式

- **頻道對話**：在頻道中 `@Antigravity 幫我說明這個專案的結構`，Bot 會在該訊息的 thread 回覆；之後直接在同一個 thread 回覆即可延續對話。
- **私訊 (DM)**：直接傳訊息給 Bot。
- **Slash Command**：使用 `/agy <問題>`、`/agy status`、`/agy help`。

#### Thread 內建指令

| 指令 | 說明 |
| :--- | :--- |
| `!status` | 檢視目前 thread 的 `conversation_id`、model、mode 與工作目錄 |
| `!reset` | 清除此 thread 的 `conversation_id`，下一則訊息會開啟全新對話 |
| `!cancel` | 中止此 thread 正在執行的 `agy` 任務（也可點選訊息上的 Cancel 按鈕） |
| `!model <name\|default>` | 為此 thread 指定不同的模型 |
| `!mode <auto\|accept-edits\|plan\|default>` | 為此 thread 指定執行模式 |
| `!help` | 顯示指令說明 |

### 環境變數說明

完整範本請參考 [`.env.example`](./.env.example)：

| 變數 | 必填 | 說明 |
| :--- | :---: | :--- |
| `SLACK_BOT_TOKEN` | 是 | Bot User OAuth Token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | 是 | App-Level Token (`xapp-...`，需含 `connections:write`) |
| `SLACK_PROXY_URL` | 否 | HTTP/HTTPS Proxy URL；留空會繼承 `HTTPS_PROXY`/`HTTP_PROXY`，填 `none` 則強制略過 |
| `SLACK_ALLOWED_USERS` | 否 | 允許使用的 Slack User ID（逗號分隔）；留空則不限制 |
| `SLACK_ALLOWED_CHANNELS` | 否 | 允許使用的 Slack Channel/DM ID（逗號分隔）；留空則不限制 |
| `AGY_BIN` | 否 | `agy` 執行檔名稱或路徑（預設 `agy`） |
| `AGY_WORKDIR` | 否 | `agy` 執行工作目錄（預設為目前目錄） |
| `AGY_MODEL` / `AGY_MODE` / `AGY_EFFORT` | 否 | 預設模型、執行模式（`auto` / `accept-edits` / `plan`）與思考強度 |
| `AGY_SANDBOX` | 否 | 是否在沙盒模式執行（預設 `false`） |
| `AGY_DANGEROUSLY_SKIP_PERMISSIONS` | 否 | 是否自動略過工具權限確認（預設 `false`） |
| `AGY_TIMEOUT_SECONDS` | 否 | 單次請求逾時秒數（預設 `300`，`0` 表示不限） |

### 安全提醒

- 強烈建議在 `.env` 設定 `SLACK_ALLOWED_USERS`（填入你的 Slack User ID），避免頻道中其他人透過 Bot 在你的電腦執行指令。
- `AGY_DANGEROUSLY_SKIP_PERMISSIONS` 預設為 `false`。若需在非互動模式下讓 `agy` 自動修改檔案或執行終端指令，請評估風險後再搭配 `AGY_SANDBOX=true` 或 `AGY_MODE` 使用。

### 測試與驗證

```bash
pnpm typecheck
pnpm test
pnpm build
```

---

## English

A TypeScript / Node.js bridge that connects Slack to your local **Google Antigravity CLI (`agy`)** over **Socket Mode**.

### Features

- **No Public URL Required (Socket Mode)**: Connect directly to Slack from your local machine or corporate intranet without ngrok or a public HTTPS endpoint.
- **Corporate Proxy Support**: Supports `SLACK_PROXY_URL` and automatically inherits `HTTPS_PROXY` / `HTTP_PROXY` (set to `none` to bypass).
- **Thread-to-Conversation Continuity**: Each Slack thread automatically maps to an `agy` `conversation_id` (resumed via `--conversation`), so follow-up replies in the same thread continue seamlessly without re-mentioning the bot.
- **Live Streaming Updates**: Parses NDJSON events from `agy --print --output-format stream-json`, throttling Slack message updates and displaying live tool execution status.
- **Cancellable Runs**: In-progress replies include a **Cancel** button, and `!cancel` aborts the active `agy` process tree.
- **Automatic Retry on Transient Startup Errors**: Automatically retries up to 2 times when `agy` hits transient proxy/network errors during startup (e.g., `Eligibility check failed ... EOF`).
- **Auto-Chunking & Markdown Conversion**: Converts Markdown to Slack `mrkdwn`, splitting long responses safely while keeping fenced code blocks intact.
- **Access Control**: Supports `SLACK_ALLOWED_USERS` and `SLACK_ALLOWED_CHANNELS` allowlists. Project-local `.env` values override inherited OS environment variables.

### Prerequisites

1. **Node.js >= 20** and **pnpm**
2. **Antigravity CLI (`agy`) installed and authenticated**: Verify `agy --version` works in your terminal.
3. **Slack Workspace permissions** to create and install a Slack App.

### Quick Slack App Setup (via Manifest, ~1 min)

1. Go to [Slack API Apps](https://api.slack.com/apps) and click **Create New App** → **From a manifest**.
2. Select your workspace, paste the contents of [`slack-app-manifest.yaml`](./slack-app-manifest.yaml), and create the app.
3. Generate an **App-Level Token (`xapp-...`)**:
   - Navigate to **Basic Information** → **App-Level Tokens** → **Generate Token and Scopes**
   - Name it (e.g., `socket-mode`), add the `connections:write` scope, and copy the `xapp-...` token.
4. Obtain the **Bot User OAuth Token (`xoxb-...`)**:
   - Navigate to **Install App** → **Install to Workspace**
   - Copy the **Bot User OAuth Token** (`xoxb-...`).
5. Invite the bot to your channels (e.g., `/invite @Antigravity`) or send it a Direct Message.

### Installation & Running

```bash
# 1. Install dependencies
pnpm install

# 2. Create your environment file
cp .env.example .env
# Edit .env and fill in SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_ALLOWED_USERS, AGY_WORKDIR, etc.

# 3. Start in development mode (auto-reload on file changes)
pnpm dev

# Or build and run in production mode
pnpm build
pnpm start:prod
```

### Usage

- **Channel Threads**: Mention `@Antigravity explain this repository` in a channel. The bot replies in a thread; reply in that thread to continue the conversation.
- **Direct Messages (DM)**: Message the bot directly.
- **Slash Commands**: `/agy <prompt>`, `/agy status`, `/agy help`.

#### In-Thread Commands

| Command | Description |
| :--- | :--- |
| `!status` | Show the current thread's `conversation_id`, model, mode, and working directory |
| `!reset` | Clear the thread's `conversation_id` so the next message starts a fresh conversation |
| `!cancel` | Abort the running `agy` task in this thread (or click the **Cancel** button) |
| `!model <name\|default>` | Override the model for this thread |
| `!mode <auto\|accept-edits\|plan\|default>` | Override the execution mode for this thread |
| `!help` | Display the help message |

### Configuration

See [`.env.example`](./.env.example) for the full template:

| Variable | Required | Description |
| :--- | :---: | :--- |
| `SLACK_BOT_TOKEN` | Yes | Bot User OAuth Token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | Yes | App-Level Token (`xapp-...` with `connections:write`) |
| `SLACK_PROXY_URL` | No | HTTP/HTTPS proxy URL; defaults to `HTTPS_PROXY`/`HTTP_PROXY`, or `none` to bypass |
| `SLACK_ALLOWED_USERS` | No | Comma-separated Slack User IDs; leave empty to allow everyone |
| `SLACK_ALLOWED_CHANNELS` | No | Comma-separated Slack Channel/DM IDs; leave empty to allow all channels |
| `AGY_BIN` | No | Path or command name for Antigravity CLI (default: `agy`) |
| `AGY_WORKDIR` | No | Working directory for `agy` (default: current working directory) |
| `AGY_MODEL` / `AGY_MODE` / `AGY_EFFORT` | No | Default model, execution mode (`auto` / `accept-edits` / `plan`), and reasoning effort |
| `AGY_SANDBOX` | No | Run `agy` in terminal sandbox mode (default: `false`) |
| `AGY_DANGEROUSLY_SKIP_PERMISSIONS` | No | Auto-approve tool permissions in non-interactive mode (default: `false`) |
| `AGY_TIMEOUT_SECONDS` | No | Per-prompt timeout in seconds (default: `300`, `0` = no timeout) |

### Security Notes

- Strongly recommended: set `SLACK_ALLOWED_USERS` in `.env` to your own Slack User ID so other workspace members cannot run commands on your machine.
- `AGY_DANGEROUSLY_SKIP_PERMISSIONS` defaults to `false`. Only enable it if you trust all allowed users/channels, and consider pairing it with `AGY_SANDBOX=true` or `AGY_MODE`.

### Testing & Verification

```bash
pnpm typecheck
pnpm test
pnpm build
```
