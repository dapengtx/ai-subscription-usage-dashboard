# Contributing

Thanks for considering a contribution.

## Development Setup

```bash
npm start
```

Open `http://localhost:4173`.

Before submitting changes, run:

```bash
npm run check
```

## Project Principles

- Keep the app local-first.
- Do not add network collection unless it is explicitly optional and documented.
- Do not commit local usage data, screenshots with private data, API keys, or generated `data/store.json`.
- Preserve the distinction between subscription fixed cost and token-estimated usage value.
- Prefer focused UI changes that help users diagnose usage, quota windows, and account health.

## Pull Request Checklist

- The app starts with `npm start`.
- `npm run check` passes.
- No files under `data/` are committed.
- No local paths, account names, or sensitive usage history are included in docs or fixtures.
- UI changes are verified on desktop and mobile widths.
