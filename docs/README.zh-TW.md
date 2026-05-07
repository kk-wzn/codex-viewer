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

## 功能範圍

第一個版本聚焦於 Codex 原生資料的檢視：

- 工作階段清單
- 工作階段中繼資料
- 當存在時顯示活躍執行緒的目標中繼資料
- 來自 rollout 事件的 token 用量與速率限制快照
- 工具使用與角色分佈的彙總資訊
- 從最終回覆事件中擷取「最近一次回覆」
- 解析後的時間軸
- 原始 rollout JSON 事件
- 所選 rollout 檔案支援即時追加更新
- 當畫面已捲動到底部時支援黏性即時捲動

它不會修改 Codex 本身、不會代理模型流量，也不會變更 `~/.codex` 目錄下的任何內容。
