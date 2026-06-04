# AI Subscription Usage Dashboard

Local-first dashboard for tracking ChatGPT/Codex CLI and Claude Code subscription usage from local logs.

The project focuses on subscription account operations: fixed monthly cost, token-estimated usage value, model-level attribution, 5-hour window analysis, and local historical retention. It does not call OpenAI or Anthropic Admin APIs and does not send local usage data to any remote service.

## Features

- Local-only collection from `~/.claude/projects`, `~/.codex/sessions`, and `~/.codex/archived_sessions`.
- ChatGPT/Codex and Claude account views with request count, token count, fixed cost, and estimated usage value.
- Model-level token breakdown: input, output, cache read/write, reasoning, total, and billable tokens.
- 5-hour window attribution by platform, model, request count, and token contribution.
- Subscription health cards for 5-hour token limits, weekly token limits, renewal risk, and data quality.
- Local persistence in `data/store.json`.
- No exchange-rate conversion; all prices and estimated values are shown in USD.

## Requirements

- Node.js 18 or newer.
- Claude Code and/or Codex CLI local session logs if you want automatic collection.

## Quick Start

```bash
npm start
```

Then open:

```text
http://localhost:4173
```

Click `自动采集` to scan local Claude Code and Codex CLI logs.

## Data Sources

The dashboard reads local JSONL files only:

- Claude Code: `~/.claude/projects/**/*.jsonl`
- Codex CLI: `~/.codex/sessions/**/*.jsonl`
- Codex archived sessions: `~/.codex/archived_sessions/**/*.jsonl`

Collected dashboard data is stored locally in:

```text
data/store.json
```

This file is intentionally ignored by Git because it can contain private usage history, local paths, account names, and operational metadata.

## Usage Value vs Fixed Cost

The dashboard separates two concepts:

- Fixed cost: the subscription account's monthly cost, configured by the user.
- Usage value: an estimated value calculated from token usage and model pricing assumptions.

Usage value is not the same as the subscription bill. It is intended to help compare whether a fixed subscription is being used effectively.

## 5-Hour Window Attribution

The 5-hour window section is designed for quota diagnosis:

- Which platform contributed the most requests?
- Which model contributed the most tokens?
- Is the likely limiting factor request count or token volume?
- Did a high-token model or a long-context session dominate the current window?

This is especially useful after a subscription window limit is reached.

## Privacy

This app is local-first:

- No API keys are required.
- No OpenAI or Anthropic Admin API calls are made.
- No local logs are uploaded.
- Sensitive local state under `data/` is excluded from version control.

Review [SECURITY.md](SECURITY.md) before publishing forks or sharing generated data.

## Development

```bash
npm run check
npm start
```

The app is intentionally dependency-light. The server is a small Node.js HTTP service and the frontend is plain HTML/CSS/JavaScript.

## License

MIT
