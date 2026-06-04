# Security Policy

## Local Data

This project reads local Claude Code and Codex CLI logs and persists dashboard state in `data/store.json`.

Do not publish `data/store.json`. It can contain sensitive information such as:

- Account names.
- Local usernames and paths.
- Usage history.
- Session timing.
- Model usage patterns.

The repository `.gitignore` excludes `data/` by default.

## API Keys

The current project does not require API keys and does not call OpenAI or Anthropic Admin APIs.

If you add integrations in a fork:

- Never commit keys.
- Store secrets outside the repository.
- Keep remote syncing opt-in.
- Document exactly what data leaves the local machine.

## Reporting Issues

If you find a security issue, avoid posting sensitive details publicly. Open a minimal GitHub issue describing the class of problem, or contact the maintainer through the repository profile.
