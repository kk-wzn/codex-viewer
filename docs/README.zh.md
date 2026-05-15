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

查看当前版本：

```bash
codex-viewer --version
```

版本变更记录保存在 [`history.md`](../history.md)。版本号来自 `package.json`，并会显示在 CLI、`/api/health` 和 Web 顶部。

## 功能范围

第一个版本聚焦于 Codex 原生数据的查看：

- 会话列表
- 会话元数据
- 当存在时显示活跃线程的目标元数据
- 来自 rollout 事件的 token 用量与限流情况快照
- 工具使用与角色分布的汇总信息
- 会话内容搜索支持命中高亮
- 工具调用摘要显示退出码、耗时、输出行数，并对失败调用高亮
- 从最终回复事件中提取「最近一次回复」，支持复制和跳转到对应会话位置
- 解析后的时间线支持按日期分组，并用关键节点标识用户提示、最终回复、shell 命令、补丁、工具错误和 git push
- 可读性更强的原始 rollout JSON 事件，支持 `sender:tool`、`type:response_item`、`tool:exec_command`、`call_id:...` 等结构化过滤
- 原始事件的发送人/事件类型 chips 可点击筛选，支持复制 JSON / call_id，长事件流支持渐进渲染，并可展开查看格式化 payload
- 支持按标题、路径、模型、分支、来源和时间搜索会话
- 视图 tab 支持吸顶和独立滚动位置恢复
- 长会话视图支持浮动按钮一键回到顶部
- 手动刷新会重新加载当前会话详情和最新 token 用量
- 选中的 rollout 文件支持实时追加更新
- 当视图已滚动到底部时支持粘性实时滚动

它不会修改 Codex 本身，不会代理模型流量，也不会改动 `~/.codex` 目录下的任何内容。
