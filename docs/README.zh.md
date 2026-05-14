# Codex Viewer

Codex Viewer 是一个用于查看 Codex 会话数据的本地 Web 工具，灵感来自 `cc-viewer`。

[English](../README.md) | 简体中文 | [繁體中文](./README.zh-TW.md)

它直接读取 Codex 的本地状态，而不是拦截 API 流量：

- `~/.codex/state_5.sqlite`：会话列表与元数据
- `~/.codex/sessions/**/rollout-*.jsonl`：每一轮的事件
- `~/.codex/session_index.jsonl`：当 SQLite 不可用时作为兜底数据源

## 使用方法

```bash
npm start
```

或者：

```bash
node server.js
```

然后在浏览器中打开：

```text
http://127.0.0.1:7088
```

可选环境变量：

```bash
CODEX_HOME=/path/to/.codex CODEX_VIEWER_PORT=7088 npm start
```

## 功能范围

第一个版本聚焦于 Codex 原生数据的查看：

- 会话列表
- 会话元数据
- 当存在时显示活跃线程的目标元数据
- 来自 rollout 事件的 token 用量与限流情况快照
- 工具使用与角色分布的汇总信息
- 从最终回复事件中提取「最近一次回复」
- 解析后的时间线
- 可读性更强的原始 rollout JSON 事件，支持过滤、按发送人/来源标识、事件类型汇总，以及展开查看格式化 payload
- 选中的 rollout 文件支持实时追加更新
- 当视图已滚动到底部时支持粘性实时滚动

它不会修改 Codex 本身，不会代理模型流量，也不会改动 `~/.codex` 目录下的任何内容。
