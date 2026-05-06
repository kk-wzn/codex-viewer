# Codex Viewer

Codex Viewer is a small local web viewer for Codex session data, inspired by `cc-viewer`.

English | [简体中文](./docs/README.zh.md)

It reads Codex's local state instead of intercepting API traffic:

- `~/.codex/state_5.sqlite` for the session list and metadata
- `~/.codex/sessions/**/rollout-*.jsonl` for turn events
- `~/.codex/session_index.jsonl` as a fallback when SQLite is unavailable

## Usage

```bash
npm start
```

or:

```bash
node server.js
```

Then open:

```text
http://127.0.0.1:7088
```

Optional environment variables:

```bash
CODEX_HOME=/path/to/.codex CODEX_VIEWER_PORT=7088 npm start
```

## Scope

This first version focuses on Codex-native viewing:

- session list
- session metadata
- active thread goal metadata when available
- token usage and rate-limit snapshots from rollout events
- tool usage and role distribution summaries
- "Last Response" extraction from final-answer events
- parsed timeline
- raw rollout JSON events
- live append updates for the selected rollout file
- sticky live scrolling when the viewer is already at the bottom

It intentionally does not patch Codex, proxy model traffic, or modify `~/.codex`.
