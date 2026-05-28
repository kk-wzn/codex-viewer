# Codex Viewer

Codex Viewer 是一個用於檢視 Codex 工作階段資料的本地 Web 工具，靈感來自 `cc-viewer`。

[English](../README.md) | [简体中文](./README.zh.md) | 繁體中文

它直接讀取 Codex 的本地狀態，而不是攔截 API 流量：

- `~/.codex/state_5.sqlite`：工作階段清單與中繼資料
- `~/.codex/sessions/**/rollout-*.jsonl`：每一輪的事件
- `~/.codex/session_index.jsonl`：當 SQLite 無法使用時作為備用資料來源

## 使用方法

```bash
npm start
```

或者：

```bash
node server.js
```

接著於瀏覽器開啟：

```text
http://127.0.0.1:7088
```

可選環境變數：

```bash
CODEX_HOME=/path/to/.codex CODEX_VIEWER_PORT=7088 npm start
```

查看目前版本：

```bash
codex-viewer --version
```

版本變更記錄保存在 [`history.md`](../history.md)。版本號來自 `package.json`，並會顯示於 CLI、`/api/health` 與 Web 頂部。

## 功能範圍

Codex Viewer 聚焦於 Codex 原生資料的檢視：

- 工作階段清單
- 工作階段中繼資料
- 當存在時顯示活躍執行緒的目標中繼資料
- 來自 rollout 事件的 token 用量與速率限制快照
- 工具使用與角色分佈的彙總資訊
- 會話內容搜尋支援命中高亮、命中數統計和上一筆/下一筆定位
- 工具呼叫摘要顯示退出碼、耗時、輸出行數，並對失敗呼叫高亮
- 從最終回覆事件中擷取「最近一次回覆」，支援複製、跳轉到對應會話位置，並預設隱藏 app directive
- 時間軸支援搜尋、依日期分組、依關鍵節點類型篩選，並可跳轉到對應 Conversation 或 Raw event
- 可讀性更強的原始 rollout JSON 事件，支援 `sender:tool`、`type:response_item`、`tool:exec_command`、`call_id:...` 等結構化過濾
- 原始事件的傳送者/事件類型 chips 可點擊篩選，提供過濾建構器、事件編號/call_id 定位、複製 JSON / call_id，長事件流支援漸進渲染，並可展開檢視格式化 payload
- 支援依標題、路徑、模型、分支、來源和時間搜尋工作階段
- 工作階段搜尋支援清除按鈕，並提示目前工作階段是否被搜尋條件隱藏
- 視圖 tab 支援吸頂和獨立捲動位置恢復
- 長工作階段視圖支援浮動按鈕一鍵回到頂部
- 手動重新整理會重新載入目前工作階段詳情和最新 token 用量，並顯示重新整理狀態
- 所選 rollout 檔案支援即時追加更新
- 當畫面已捲動到底部時支援黏性即時捲動

它不會修改 Codex 本身、不會代理模型流量，也不會變更 `~/.codex` 目錄下的任何內容。
