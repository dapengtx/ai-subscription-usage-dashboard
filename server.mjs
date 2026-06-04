import { createServer } from "node:http";
import { homedir } from "node:os";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 4173);
const storePath = join(root, "data", "store.json");
const claudeProjectsPath = join(homedir(), ".claude", "projects");
const codexSessionsPaths = [
  join(homedir(), ".codex", "sessions"),
  join(homedir(), ".codex", "archived_sessions"),
];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const CLAUDE_SESSION_HOURS = 5;
const CLAUDE_PRICING = [
  { match: "opus", input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  { match: "sonnet", input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  { match: "haiku", input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 },
];
const DEFAULT_CLAUDE_PRICING = CLAUDE_PRICING[1];
const CODEX_PRICING = [
  { match: "codex", input: 1.25, output: 10, cacheRead: 0.125, reasoning: 10 },
  { match: "gpt-5", input: 1.25, output: 10, cacheRead: 0.125, reasoning: 10 },
  { match: "gpt-4.1", input: 2, output: 8, cacheRead: 0.5, reasoning: 8 },
  { match: "gpt-4o", input: 2.5, output: 10, cacheRead: 1.25, reasoning: 10 },
  { match: "o3", input: 2, output: 8, cacheRead: 0.5, reasoning: 8 },
  { match: "o4-mini", input: 1.1, output: 4.4, cacheRead: 0.275, reasoning: 4.4 },
];
const DEFAULT_CODEX_PRICING = CODEX_PRICING[0];

function json(res, status, data) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function loadStore() {
  try {
    return JSON.parse(await readFile(storePath, "utf8"));
  } catch {
    const store = {
      accounts: [],
      usageRecords: [],
      activities: [
        {
          id: crypto.randomUUID(),
          title: "等待添加订阅账号",
          detail: "新增 ChatGPT 或 Claude 订阅账号后，可通过自动采集读取本机日志并留存历史记录。",
          level: "warn",
          time: new Date().toISOString(),
        },
      ],
      syncJobs: {
        enabled: false,
        intervalHours: 6,
        lastRunAt: null,
        mode: "auto",
      },
    };
    await saveStore(store);
    return store;
  }
}

async function saveStore(store) {
  await mkdir(join(root, "data"), { recursive: true });
  await writeFile(storePath, JSON.stringify(store, null, 2));
}

function addActivity(store, title, detail, level = "ok") {
  store.activities.unshift({
    id: crypto.randomUUID(),
    title,
    detail,
    level,
    time: new Date().toISOString(),
  });
  store.activities = store.activities.slice(0, 50);
}

async function getConnectors() {
  const claudeLogCount = await countClaudeLogFiles();
  const codexLogCount = await countCodexLogFiles();
  return [
    {
      id: "claude_code_local",
      provider: "claude",
      name: "Claude Code 本地日志",
      kind: "local_cli",
      status: claudeLogCount ? "ready" : "not_found",
      detail: claudeLogCount
        ? `发现 ${claudeLogCount} 个 Claude Code JSONL 日志文件，可自动回填完整历史。`
        : `未发现 ${claudeProjectsPath}。安装并使用 Claude Code 后会自动出现。`,
    },
    {
      id: "codex_cli_local",
      provider: "chatgpt",
      name: "Codex CLI 本地日志",
      kind: "local_cli",
      status: codexLogCount ? "ready" : "not_found",
      detail: codexLogCount
        ? `发现 ${codexLogCount} 个 Codex session JSONL 文件，可自动采集本机 OpenAI/Codex token 历史。`
        : "未发现 ~/.codex/sessions 或 ~/.codex/archived_sessions 下的 session JSONL 文件。",
    },
  ];
}

async function countClaudeLogFiles() {
  try {
    const files = await walkFilesFromRoots(getClaudeLogRoots(), ".jsonl", 4000);
    return files.length;
  } catch {
    return 0;
  }
}

async function countCodexLogFiles() {
  try {
    const files = await walkFilesFromRoots(codexSessionsPaths, ".jsonl", 4000);
    return files.length;
  } catch {
    return 0;
  }
}

function getClaudeLogRoots() {
  return [
    claudeProjectsPath,
    join(homedir(), ".claude", "transcripts"),
    join(homedir(), ".config", "claude", "projects"),
    join(homedir(), ".config", "claude", "transcripts"),
    join(homedir(), "Library", "Application Support", "Claude", "projects"),
    join(homedir(), "Library", "Application Support", "Claude", "transcripts"),
  ];
}

function getRange(period) {
  const end = new Date();
  const start = new Date(end);

  if (period === "week") {
    start.setUTCDate(end.getUTCDate() - 6);
  } else if (period === "30d") {
    start.setUTCDate(end.getUTCDate() - 29);
  } else if (period === "quarter") {
    const quarterStartMonth = Math.floor(end.getUTCMonth() / 3) * 3;
    start.setUTCMonth(quarterStartMonth, 1);
  } else {
    start.setUTCDate(1);
  }

  start.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

function isoDay(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

function dayLabel(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

function inRange(record, range) {
  const date = new Date(`${record.date}T00:00:00.000Z`);
  return date >= range.start && date <= range.end;
}

function statusFor(account, ...quotas) {
  const maxQuota = Math.max(...quotas.filter((quota) => Number.isFinite(quota)), 0);
  if (maxQuota >= 95) return "danger";
  if (maxQuota >= 80 || daysUntil(account.renewalDate) <= 7) return "warn";
  return "ok";
}

function getStatusReasons(account, quota, weeklyTokenQuota, sessionTokenQuota) {
  const reasons = [];
  if (Number(sessionTokenQuota) >= 95) reasons.push(`5 小时窗口已用 ${sessionTokenQuota}%`);
  else if (Number(sessionTokenQuota) >= 80) reasons.push(`5 小时窗口接近限额：${sessionTokenQuota}%`);
  if (Number(weeklyTokenQuota) >= 95) reasons.push(`近 7 天周限额已用 ${weeklyTokenQuota}%`);
  else if (Number(weeklyTokenQuota) >= 80) reasons.push(`近 7 天周限额接近上限：${weeklyTokenQuota}%`);
  if (Number(quota) >= 95) reasons.push(`周期请求额度已用 ${quota}%`);
  else if (Number(quota) >= 80) reasons.push(`周期请求额度接近上限：${quota}%`);
  const renewalDays = daysUntil(account.renewalDate);
  if (renewalDays <= 7) reasons.push(`距离续费 ${Math.max(0, renewalDays)} 天`);
  return reasons;
}

function daysUntil(value) {
  if (!value) return Number.POSITIVE_INFINITY;
  const target = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(target.getTime())) return Number.POSITIVE_INFINITY;
  return Math.ceil((target.getTime() - Date.now()) / 86_400_000);
}

function calculateQuota(account, record) {
  if (!record) return 0;
  const messageLimit = Number(account.messageLimit || 0);
  if (!messageLimit) return null;
  return Math.min(100, Math.round((Number(record.messages || 0) / messageLimit) * 100));
}

function calculateQuotaForPeriod(account, messages, period) {
  const messageLimit = Number(account.messageLimit || 0);
  if (!messageLimit) return null;
  const rangeLimit =
    period === "week"
      ? (messageLimit / 30) * 7
      : period === "quarter"
        ? messageLimit * 3
        : messageLimit;
  if (!rangeLimit) return null;
  return Math.min(100, Math.round((Number(messages || 0) / rangeLimit) * 100));
}

function calculateTokenQuota(used, limit) {
  const safeLimit = Number(limit || 0);
  if (!safeLimit) return null;
  return Math.min(100, Math.round((Number(used || 0) / safeLimit) * 100));
}

function buildUsage(store, period) {
  const range = getRange(period);
  const weekRange = getRange("week");
  const records = store.usageRecords.filter((record) => inRange(record, range));
  const weekRecords = store.usageRecords.filter((record) => inRange(record, weekRange));
  const accountRows = store.accounts.map((account) => {
    const accountRecords = records
      .filter((record) => record.accountId === account.id)
      .sort((a, b) => a.date.localeCompare(b.date));
    const messages = accountRecords.reduce((total, item) => total + Number(item.messages || 0), 0);
    const tokens = accountRecords.reduce((total, item) => total + Number(item.tokens || 0), 0);
    const usageValue = accountRecords.reduce((total, item) => total + Number(item.usageValue ?? item.cost ?? 0), 0);
    const modelStats = aggregateModelStats(accountRecords, account);
    const fixedCost = getFixedCostForPeriod(account, period);
    const quota = calculateQuotaForPeriod(account, messages, period);
    const weeklyTokens = weekRecords
      .filter((record) => record.accountId === account.id)
      .reduce((total, item) => total + Number(item.tokens || 0), 0);
    const weeklyTokenLimit = Number(account.weeklyTokenLimit || 0);
    const weeklyTokenQuota = calculateTokenQuota(weeklyTokens, weeklyTokenLimit);
    const sessionTokenLimit = Number(account.sessionTokenLimit || 0);
    const sessionTokens = Number(account.sessionWindow?.tokens || 0);
    const sessionTokenQuota = calculateTokenQuota(sessionTokens, sessionTokenLimit);
    const statusReasons = getStatusReasons(account, quota, weeklyTokenQuota, sessionTokenQuota);
    return {
      id: account.id,
      name: account.name,
      owner: account.owner,
      provider: account.provider,
      plan: account.plan,
      renewal: account.renewalDate || "未设置",
      messages,
      tokens: tokens / 1_000_000,
      cost: fixedCost,
      fixedCost,
      usageValue,
      modelStats,
      valueRatio: fixedCost ? usageValue / fixedCost : null,
      quota,
      status: statusFor(account, quota, weeklyTokenQuota, sessionTokenQuota),
      statusReasons,
      activeInPeriod: Boolean(accountRecords.length && (messages || tokens || usageValue)),
      members: account.members,
      monthlyPrice: account.monthlyPrice,
      messageLimit: account.messageLimit,
      tokenLimit: account.tokenLimit,
      weeklyTokens,
      weeklyTokenLimit,
      weeklyTokenQuota,
      sessionTokenLimit,
      sessionTokenQuota,
      source: account.source,
      lastSyncedAt: account.lastSyncedAt,
      historyStartDate: account.historyStartDate,
      sessionWindow: account.sessionWindow || null,
      sessionWindows: (account.sessionWindows || []).slice(-12),
      p90Tokens: account.p90Tokens || null,
      lastQuality: account.lastQuality || null,
    };
  });

  const byDay = new Map();
  for (const record of records) {
    const row = byDay.get(record.date) || { day: dayLabel(record.date), chatgpt: 0, claude: 0 };
    row[record.provider] += Number(record.messages || 0);
    byDay.set(record.date, row);
  }

  return {
    source: "local",
    period,
    range: {
      start: isoDay(range.start),
      end: isoDay(range.end),
      days: getRangeDays(range),
      label: getPeriodLabel(period),
    },
    accounts: accountRows,
    daily: [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, value]) => value),
    activities: store.activities.slice(0, 12).map((item) => ({
      title: item.title,
      detail: item.detail,
      level: item.level,
      time: formatTime(item.time),
    })),
    syncJobs: store.syncJobs,
  };
}

function getFixedCostForPeriod(account, period) {
  const monthlyPrice = Number(account.monthlyPrice || 0);
  if (!monthlyPrice) return 0;
  if (period === "quarter") return monthlyPrice * 3;
  if (period === "week") return (monthlyPrice / 30) * 7;
  if (period === "30d") return monthlyPrice;
  return monthlyPrice;
}

function aggregateModelStats(records, account) {
  const byModel = new Map();
  for (const record of records) {
    const stats = record.modelStats && Object.keys(record.modelStats).length
      ? record.modelStats
      : {
          [account.plan || "unknown"]: {
            requests: Number(record.messages || 0),
            inputTokens: Number(record.inputTokens || 0),
            outputTokens: Number(record.outputTokens || 0),
            cacheCreationTokens: Number(record.cacheCreationTokens || 0),
            cacheReadTokens: Number(record.cacheReadTokens || 0),
            reasoningTokens: Number(record.reasoningTokens || 0),
            tokens: Number(record.tokens || 0),
            billableTokens: Number(record.billableTokens ?? record.tokens ?? 0),
            usageValue: Number(record.usageValue || 0),
          },
        };

    for (const [model, value] of Object.entries(stats)) {
      const row = byModel.get(model) || {
        model,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        reasoningTokens: 0,
        tokens: 0,
        billableTokens: 0,
        usageValue: 0,
      };
      row.requests += Number(value.requests || value.messages || 0);
      row.inputTokens += Number(value.inputTokens || 0);
      row.outputTokens += Number(value.outputTokens || 0);
      row.cacheCreationTokens += Number(value.cacheCreationTokens || 0);
      row.cacheReadTokens += Number(value.cacheReadTokens || 0);
      row.reasoningTokens += Number(value.reasoningTokens || 0);
      row.tokens += Number(value.tokens || 0);
      row.billableTokens += Number(value.billableTokens ?? value.tokens ?? 0);
      row.usageValue += Number(value.usageValue || 0);
      byModel.set(model, row);
    }
  }
  return [...byModel.values()].sort((a, b) => b.tokens - a.tokens);
}

function getRangeDays(range) {
  const start = Date.parse(`${isoDay(range.start)}T00:00:00.000Z`);
  const end = Date.parse(`${isoDay(range.end)}T00:00:00.000Z`);
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

function getPeriodLabel(period) {
  if (period === "week") return "近 7 天";
  if (period === "30d") return "近 30 天";
  if (period === "quarter") return "本季度";
  return "本月";
}

function publicAccount(account) {
  return account;
}

async function runAutoSync(store) {
  const summaries = [];
  const connectors = await getConnectors();

  try {
    const summary = await syncClaudeCodeLocal(store);
    summaries.push(summary);
  } catch (error) {
    summaries.push({ id: "claude_code_local", imported: 0, error: error.message });
  }

  try {
    const summary = await syncCodexCliLocal(store);
    summaries.push(summary);
  } catch (error) {
    summaries.push({ id: "codex_cli_local", imported: 0, error: error.message });
  }

  const imported = summaries.reduce((total, item) => total + Number(item.imported || 0), 0);
  const errors = summaries.filter((item) => item.error);
  const readyCount = connectors.filter((item) => item.status === "ready").length;
  addActivity(
    store,
    "自动采集完成",
    readyCount
      ? `已运行 ${readyCount} 个可用连接器，写入或更新 ${imported} 条本地历史记录。`
      : "没有可用本地日志连接器。安装并使用 Claude Code 或 Codex CLI 后即可自动采集。",
    errors.length ? "warn" : "ok",
  );

  for (const error of errors) {
    addActivity(store, "连接器采集失败", `${error.id}: ${error.error}`, "danger");
  }

  store.syncJobs.lastRunAt = new Date().toISOString();
  store.syncJobs.mode = "auto";
  return { imported, summaries, connectors };
}

async function syncClaudeCodeLocal(store) {
  const files = await walkFilesFromRoots(getClaudeLogRoots(), ".jsonl", 4000);
  const events = [];
  const seen = new Set();
  const quality = {
    files: files.length,
    parsed: 0,
    duplicate: 0,
    invalidJson: 0,
    missingUsage: 0,
    missingTimestamp: 0,
    zeroTokens: 0,
  };

  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let item;
      try {
        item = JSON.parse(line);
      } catch {
        quality.invalidJson += 1;
        continue;
      }

      const usage = item.message?.usage || item.usage;
      const timestamp = item.timestamp || item.created_at || item.createdAt;
      if (!usage) {
        quality.missingUsage += 1;
        continue;
      }
      if (!timestamp) {
        quality.missingTimestamp += 1;
        continue;
      }

      const tokenParts = getUsageTokenParts(usage);
      if (!tokenParts.billableTokens) {
        quality.zeroTokens += 1;
        continue;
      }

      const eventKey = getClaudeEventKey(item, timestamp, usage, file);
      if (seen.has(eventKey)) {
        quality.duplicate += 1;
        continue;
      }
      seen.add(eventKey);

      const model = item.message?.model || item.model || "claude-sonnet";
      events.push({
        id: eventKey,
        timestamp: new Date(timestamp),
        date: isoDay(timestamp),
      model,
      ...tokenParts,
      cost: estimateClaudeCost(model, tokenParts),
      });
      quality.parsed += 1;
    }
  }

  if (!events.length) {
    return {
      id: "claude_code_local",
      imported: 0,
      detail: "没有发现可解析的 Claude Code usage 记录。",
      quality,
    };
  }

  events.sort((a, b) => a.timestamp - b.timestamp);
  const daily = aggregateClaudeDaily(events);
  const sessions = buildClaudeSessions(events);
  const currentSession = getCurrentClaudeSession(sessions);
  const p90Tokens = percentile(
    sessions
      .filter((session) => !session.active)
      .map((session) => session.tokens)
      .filter(Boolean),
    0.9,
  );
  const account = ensureAutoAccount(store, {
    name: "Claude Code 本地订阅",
    provider: "claude",
    owner: "本机 CLI",
    plan: "Pro / Max",
    source: "claude_code_local",
    historyStartDate: [...daily.keys()].sort()[0],
  });
  account.sessionWindow = currentSession;
  account.sessionWindows = sessions.slice(-24);
  account.p90Tokens = p90Tokens;
  account.lastQuality = quality;

  for (const [date, value] of daily) {
    upsertRecord(store, {
      accountId: account.id,
      provider: "claude",
      date,
      messages: value.messages,
      tokens: value.tokens,
      billableTokens: value.billableTokens,
      inputTokens: value.inputTokens,
      outputTokens: value.outputTokens,
      cacheCreationTokens: value.cacheCreationTokens,
      cacheReadTokens: value.cacheReadTokens,
      cost: 0,
      usageValue: value.cost,
      modelStats: value.modelStats,
      quota: p90Tokens && currentSession?.active ? Math.min(100, Math.round((currentSession.tokens / p90Tokens) * 100)) : null,
      source: "claude_code_local",
    });
  }
  account.lastSyncedAt = new Date().toISOString();
  return {
    id: "claude_code_local",
    imported: daily.size,
    parsed: quality.parsed,
    duplicate: quality.duplicate,
    activeSession: currentSession,
    p90Tokens,
  };
}

async function syncCodexCliLocal(store) {
  const files = await walkFilesFromRoots(codexSessionsPaths, ".jsonl", 4000);
  const daily = new Map();
  const events = [];
  const seen = new Set();
  const quality = {
    files: files.length,
    parsed: 0,
    duplicate: 0,
    invalidJson: 0,
    missingUsage: 0,
    missingTimestamp: 0,
    zeroTokens: 0,
  };

  for (const file of files) {
    const content = await readFile(file, "utf8");
    let currentModel = "";
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let item;
      try {
        item = JSON.parse(line);
      } catch {
        quality.invalidJson += 1;
        continue;
      }

      currentModel = getCodexModelName(item, currentModel);
      const timestamp = item.timestamp || item.time || item.created_at || item.createdAt;
      const usage = findUsagePayload(item);
      if (!usage) {
        quality.missingUsage += 1;
        continue;
      }
      if (!timestamp) {
        quality.missingTimestamp += 1;
        continue;
      }
      const tokens = getOpenAITokenParts(usage);
      if (!tokens.billableTokens) {
        quality.zeroTokens += 1;
        continue;
      }

      const eventKey = getCodexEventKey(item, timestamp, usage, file);
      if (seen.has(eventKey)) {
        quality.duplicate += 1;
        continue;
      }
      seen.add(eventKey);

      const date = isoDay(timestamp);
      const model = getCodexModelName(item, currentModel);
      const cost = estimateCodexCost(model, tokens);
      const event = {
        id: eventKey,
        timestamp: new Date(timestamp),
        date,
        model,
        inputTokens: tokens.inputTokens,
        outputTokens: tokens.outputTokens,
        cacheCreationTokens: 0,
        cacheReadTokens: tokens.cacheReadTokens,
        reasoningTokens: tokens.reasoningTokens,
        total: tokens.total,
        billableTokens: tokens.billableTokens,
        cost,
      };
      events.push(event);
      const row =
        daily.get(date) ||
        {
          messages: 0,
          tokens: 0,
          billableTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          reasoningTokens: 0,
          cost: 0,
          modelStats: {},
        };
      row.messages += 1;
      row.tokens += tokens.total;
      row.inputTokens += tokens.inputTokens;
      row.outputTokens += tokens.outputTokens;
      row.cacheReadTokens += tokens.cacheReadTokens;
      row.reasoningTokens += tokens.reasoningTokens;
      row.billableTokens = Number(row.billableTokens || 0) + tokens.billableTokens;
      row.cost += cost;
      addModelUsage(row.modelStats, event.model, {
        requests: 1,
        inputTokens: tokens.inputTokens,
        outputTokens: tokens.outputTokens,
        cacheReadTokens: tokens.cacheReadTokens,
        reasoningTokens: tokens.reasoningTokens,
        tokens: tokens.total,
        billableTokens: tokens.billableTokens,
        usageValue: cost,
      });
      daily.set(date, row);
      quality.parsed += 1;
    }
  }

  if (!daily.size) {
    return { id: "codex_cli_local", imported: 0, detail: "没有发现可解析的 Codex usage 记录。", quality };
  }

  const account = ensureAutoAccount(store, {
    name: "Codex CLI 本地用量",
    provider: "chatgpt",
    owner: "本机 CLI",
    plan: "Codex",
    source: "codex_cli_local",
    historyStartDate: [...daily.keys()].sort()[0],
  });
  account.lastQuality = quality;
  const sessions = buildUsageSessions(events);
  account.sessionWindows = sessions.slice(-24);
  account.sessionWindow = getCurrentUsageSession(sessions);
  account.p90Tokens = percentile(
    sessions
      .filter((session) => !session.active)
      .map((session) => session.tokens)
      .filter(Boolean),
    0.9,
  );

  for (const [date, value] of daily) {
    upsertRecord(store, {
      accountId: account.id,
      provider: "chatgpt",
      date,
      messages: value.messages,
      tokens: value.tokens,
      billableTokens: value.billableTokens,
      inputTokens: value.inputTokens,
      outputTokens: value.outputTokens,
      cacheReadTokens: value.cacheReadTokens,
      reasoningTokens: value.reasoningTokens,
      cost: 0,
      usageValue: value.cost,
      modelStats: value.modelStats,
      quota: null,
      source: "codex_cli_local",
    });
  }
  account.lastSyncedAt = new Date().toISOString();
  return {
    id: "codex_cli_local",
    imported: daily.size,
    parsed: quality.parsed,
    duplicate: quality.duplicate,
    activeSession: account.sessionWindow,
    p90Tokens: account.p90Tokens,
  };
}

function ensureAutoAccount(store, next) {
  let account = store.accounts.find((item) => item.source === next.source);
  if (account) return account;
  account = {
    id: crypto.randomUUID(),
    name: next.name,
    provider: next.provider,
    owner: next.owner,
    plan: next.plan,
    members: null,
    renewalDate: "",
    monthlyPrice: 0,
    messageLimit: 0,
    tokenLimit: 0,
    sessionTokenLimit: 0,
    weeklyTokenLimit: 0,
    source: next.source,
    historyStartDate: next.historyStartDate,
    createdAt: new Date().toISOString(),
    lastSyncedAt: null,
  };
  store.accounts.push(account);
  return account;
}

function getUsageTokenParts(usage) {
  const inputTokens = Number(usage.input_tokens || usage.uncached_input_tokens || 0);
  const outputTokens = Number(usage.output_tokens || 0);
  const nestedCacheCreationTokens =
    Number(usage.cache_creation?.ephemeral_1h_input_tokens || 0) +
    Number(usage.cache_creation?.ephemeral_5m_input_tokens || 0);
  const cacheCreationTokens = nestedCacheCreationTokens || Number(usage.cache_creation_input_tokens || 0);
  const cacheReadTokens = Number(usage.cache_read_input_tokens || 0);
  return {
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    total: inputTokens + outputTokens,
    billableTokens: inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens,
  };
}

function findUsagePayload(item) {
  if (item.type === "event_msg" && item.payload?.type === "token_count") {
    return item.payload.info?.last_token_usage || null;
  }
  const candidates = [
    item.usage,
    item.token_usage,
    item.tokenUsage,
    item.message?.usage,
    item.response?.usage,
    item.data?.usage,
    item.event?.usage,
    item.payload?.usage,
  ];
  return candidates.find((candidate) => candidate && typeof candidate === "object") || null;
}

function getOpenAITokenParts(usage) {
  const inputDetails = usage.input_tokens_details || usage.prompt_tokens_details || {};
  const outputDetails = usage.output_tokens_details || usage.completion_tokens_details || {};
  const inputTokens = Number(usage.input_tokens || usage.prompt_tokens || 0);
  const outputTokens = Number(usage.output_tokens || usage.completion_tokens || 0);
  const cacheReadTokens = Number(
    usage.input_cached_tokens ||
      usage.cached_input_tokens ||
      usage.cached_tokens ||
      inputDetails.cached_tokens ||
      inputDetails.cache_read_tokens ||
      0,
  );
  const reasoningTokens = Number(outputDetails.reasoning_tokens || usage.reasoning_tokens || usage.reasoning_output_tokens || 0);
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    reasoningTokens,
    total: inputTokens + outputTokens,
    billableTokens: Number(usage.total_tokens || 0) || inputTokens + outputTokens + cacheReadTokens + reasoningTokens,
  };
}

function getCodexEventKey(item, timestamp, usage, file) {
  return [
    item.id || item.request_id || item.requestId || item.call_id || "",
    timestamp,
    usage.total_tokens || usage.input_tokens || usage.prompt_tokens || 0,
    usage.output_tokens || usage.completion_tokens || 0,
    file,
  ].join(":");
}

function getCodexModelName(item, fallback = "codex") {
  return (
    item.payload?.model ||
    item.payload?.model_slug ||
    item.payload?.model_name ||
    item.payload?.modelName ||
    item.payload?.info?.model ||
    item.payload?.metadata?.model ||
    item.payload?.config?.model ||
    item.message?.model ||
    item.response?.model ||
    item.data?.model ||
    item.model ||
    fallback ||
    "codex"
  );
}

function addModelUsage(target, model, value) {
  const name = model || "unknown";
  const row =
    target[name] ||
    {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      reasoningTokens: 0,
      tokens: 0,
      billableTokens: 0,
      usageValue: 0,
    };
  row.requests += Number(value.requests || 0);
  row.inputTokens += Number(value.inputTokens || 0);
  row.outputTokens += Number(value.outputTokens || 0);
  row.cacheCreationTokens += Number(value.cacheCreationTokens || 0);
  row.cacheReadTokens += Number(value.cacheReadTokens || 0);
  row.reasoningTokens += Number(value.reasoningTokens || 0);
  row.tokens += Number(value.tokens || 0);
  row.billableTokens += Number(value.billableTokens ?? value.tokens ?? 0);
  row.usageValue += Number(value.usageValue || 0);
  target[name] = row;
}

function getClaudeEventKey(item, timestamp, usage, file) {
  const messageId = item.message?.id || item.message_id || item.id || "";
  const requestId = item.requestId || item.request_id || item.request?.id || "";
  if (messageId || requestId) {
    return [
      file,
      messageId,
      requestId,
      timestamp,
      item.message?.model || item.model || "",
      usage.input_tokens || 0,
      usage.output_tokens || 0,
      usage.cache_creation_input_tokens || 0,
      usage.cache_read_input_tokens || 0,
    ].join(":");
  }
  return [
    file,
    timestamp,
    item.message?.model || item.model || "",
    usage.input_tokens || 0,
    usage.output_tokens || 0,
    usage.cache_creation_input_tokens || 0,
    usage.cache_read_input_tokens || 0,
  ].join(":");
}

function estimateClaudeCost(model, tokenParts) {
  const pricing = getClaudePricing(model);
  return (
    (tokenParts.inputTokens / 1_000_000) * pricing.input +
    (tokenParts.outputTokens / 1_000_000) * pricing.output +
    (tokenParts.cacheCreationTokens / 1_000_000) * pricing.cacheWrite +
    (tokenParts.cacheReadTokens / 1_000_000) * pricing.cacheRead
  );
}

function getClaudePricing(model = "") {
  const lower = model.toLowerCase();
  return CLAUDE_PRICING.find((price) => lower.includes(price.match)) || DEFAULT_CLAUDE_PRICING;
}

function estimateCodexCost(model, tokenParts) {
  const pricing = getCodexPricing(model);
  const cacheReadTokens = Number(tokenParts.cacheReadTokens || 0);
  const inputTokens = Math.max(0, Number(tokenParts.inputTokens || 0) - cacheReadTokens);
  const outputTokens = Number(tokenParts.outputTokens || 0);
  const reasoningTokens = Number(tokenParts.reasoningTokens || 0);
  return (
    (inputTokens / 1_000_000) * pricing.input +
    (cacheReadTokens / 1_000_000) * pricing.cacheRead +
    (outputTokens / 1_000_000) * pricing.output +
    (reasoningTokens / 1_000_000) * pricing.reasoning
  );
}

function getCodexPricing(model = "") {
  const lower = model.toLowerCase();
  return CODEX_PRICING.find((price) => lower.includes(price.match)) || DEFAULT_CODEX_PRICING;
}

function aggregateClaudeDaily(events) {
  const daily = new Map();
  for (const event of events) {
    const row =
      daily.get(event.date) ||
        {
          messages: 0,
          tokens: 0,
          billableTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cost: 0,
        modelStats: {},
      };
    row.messages += 1;
    row.tokens += event.total;
    row.billableTokens += event.billableTokens;
    row.inputTokens += event.inputTokens;
    row.outputTokens += event.outputTokens;
    row.cacheCreationTokens += event.cacheCreationTokens;
    row.cacheReadTokens += event.cacheReadTokens;
    row.cost += event.cost;
    addModelUsage(row.modelStats, event.model, {
      requests: 1,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      cacheCreationTokens: event.cacheCreationTokens,
      cacheReadTokens: event.cacheReadTokens,
      tokens: event.total,
      billableTokens: event.billableTokens,
      usageValue: event.cost,
    });
    daily.set(event.date, row);
  }
  return daily;
}

function buildClaudeSessions(events) {
  return buildUsageSessions(events);
}

function buildUsageSessions(events) {
  const sessions = [];
  const windowMs = CLAUDE_SESSION_HOURS * 60 * 60 * 1000;
  let current = null;

  events.sort((a, b) => a.timestamp - b.timestamp);
  for (const event of events) {
    if (!current || event.timestamp.getTime() >= current.startAtMs + windowMs) {
      current = {
        startAtMs: event.timestamp.getTime(),
        endAtMs: event.timestamp.getTime() + windowMs,
        messages: 0,
        tokens: 0,
        billableTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        reasoningTokens: 0,
        cost: 0,
        modelStats: {},
      };
      sessions.push(current);
    }
    current.messages += 1;
    current.tokens += event.total;
    current.billableTokens += event.billableTokens;
    current.inputTokens += event.inputTokens;
    current.outputTokens += event.outputTokens;
    current.cacheCreationTokens += event.cacheCreationTokens;
    current.cacheReadTokens += event.cacheReadTokens;
    current.reasoningTokens += Number(event.reasoningTokens || 0);
    current.cost += event.cost;
    addModelUsage(current.modelStats, event.model, {
      requests: 1,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      cacheCreationTokens: event.cacheCreationTokens,
      cacheReadTokens: event.cacheReadTokens,
      reasoningTokens: event.reasoningTokens,
      tokens: event.total,
      billableTokens: event.billableTokens,
      usageValue: event.cost,
    });
  }

  return sessions.map((session) => ({
    startAt: new Date(session.startAtMs).toISOString(),
    endAt: new Date(session.endAtMs).toISOString(),
    active: Date.now() < session.endAtMs,
    messages: session.messages,
    tokens: session.tokens,
    billableTokens: session.billableTokens,
    inputTokens: session.inputTokens,
    outputTokens: session.outputTokens,
    cacheCreationTokens: session.cacheCreationTokens,
    cacheReadTokens: session.cacheReadTokens,
    reasoningTokens: session.reasoningTokens,
    cost: session.cost,
    modelStats: session.modelStats,
  }));
}

function getCurrentClaudeSession(sessions) {
  return getCurrentUsageSession(sessions);
}

function getCurrentUsageSession(sessions) {
  return sessions.find((session) => session.active) || sessions.at(-1) || null;
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * ratio) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

async function walkFiles(dir, extension, limit, output = []) {
  if (output.length >= limit) return output;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return output;
  }
  for (const entry of entries) {
    if (output.length >= limit) break;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walkFiles(path, extension, limit, output);
    else if (entry.isFile() && path.endsWith(extension)) output.push(path);
  }
  return output;
}

async function walkFilesFromRoots(roots, extension, limit) {
  const output = [];
  for (const rootDir of roots) {
    if (output.length >= limit) break;
    await walkFiles(rootDir, extension, limit, output);
  }
  return output;
}

function formatTime(value) {
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return date.toLocaleDateString("zh-CN");
}

async function createAccount(req, res) {
  const payload = await readBody(req);
  const store = await loadStore();
  const provider = payload.provider === "claude" ? "claude" : "chatgpt";
  const account = {
    id: crypto.randomUUID(),
    name: String(payload.name || "").trim() || "未命名订阅号",
    provider,
    owner: String(payload.owner || "").trim() || "未分组",
    plan: String(payload.plan || "Pro").trim(),
    members: Number(payload.members || 1),
    renewalDate: payload.renewalDate || "",
    monthlyPrice: Number(payload.monthlyPrice || 0),
    messageLimit: Number(payload.messageLimit || 0),
    tokenLimit: Number(payload.tokenLimit || 0),
    sessionTokenLimit: Number(payload.sessionTokenLimit || 0),
    weeklyTokenLimit: Number(payload.weeklyTokenLimit || 0),
    source: payload.source || "manual",
    historyStartDate: payload.historyStartDate || isoDay(),
    createdAt: new Date().toISOString(),
    lastSyncedAt: null,
  };

  store.accounts.push(account);
  addActivity(
    store,
    "已添加订阅账号",
    `${account.name} 已建立本地档案。系统仅从本机 Claude Code / Codex CLI 日志自动采集用量。`,
  );
  await saveStore(store);
  json(res, 201, { account: publicAccount(account) });
}

async function updateAccount(req, res, accountId) {
  const payload = await readBody(req);
  const store = await loadStore();
  const account = store.accounts.find((item) => item.id === accountId);
  if (!account) {
    json(res, 404, { error: "Account not found" });
    return;
  }

  const provider = payload.provider === "claude" ? "claude" : "chatgpt";
  account.name = String(payload.name || "").trim() || account.name;
  account.provider = provider;
  account.owner = String(payload.owner || "").trim() || "未分组";
  account.plan = String(payload.plan || account.plan || "Pro").trim();
  account.members = payload.members === "" || payload.members == null ? null : Number(payload.members);
  account.renewalDate = payload.renewalDate || "";
  account.monthlyPrice = Number(payload.monthlyPrice || 0);
  account.messageLimit = Number(payload.messageLimit || 0);
  account.tokenLimit = Number(payload.tokenLimit || 0);
  account.sessionTokenLimit = Number(payload.sessionTokenLimit || 0);
  account.weeklyTokenLimit = Number(payload.weeklyTokenLimit || 0);
  account.historyStartDate = payload.historyStartDate || account.historyStartDate || isoDay();

  addActivity(
    store,
    "已更新订阅账号",
    `${account.name} 的基础信息已更新。`,
  );
  await saveStore(store);
  json(res, 200, { account: publicAccount(account) });
}

function upsertRecord(store, next) {
  const index = store.usageRecords.findIndex(
    (item) => item.accountId === next.accountId && item.date === next.date && item.source === next.source,
  );
  const record = {
    id: index >= 0 ? store.usageRecords[index].id : crypto.randomUUID(),
    ...next,
    updatedAt: new Date().toISOString(),
  };
  if (index >= 0) store.usageRecords[index] = record;
  else store.usageRecords.push(record);
}

async function syncUsage(req, res) {
  const store = await loadStore();
  const result = await runAutoSync(store);
  await saveStore(store);
  json(res, 200, { ok: true, syncJobs: store.syncJobs, ...result });
}

async function updateSyncJob(req, res) {
  const payload = await readBody(req);
  const store = await loadStore();
  store.syncJobs = {
    enabled: true,
    intervalHours: Number(payload.intervalHours || 6),
    lastRunAt: store.syncJobs.lastRunAt,
    mode: "auto",
  };
  addActivity(store, "已创建自动采集任务", `每 ${store.syncJobs.intervalHours} 小时运行一次可用连接器，并将采集结果保存到本地。`);
  await saveStore(store);
  json(res, 200, { syncJobs: store.syncJobs });
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const normalized = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(root, normalized);

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(file);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (isSensitiveApi(req, url) && !isLoopbackRequest(req)) {
      json(res, 403, { error: "Sensitive local endpoint is restricted to loopback requests." });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/usage") {
      const store = await loadStore();
      json(res, 200, buildUsage(store, url.searchParams.get("period") || "month"));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/connectors") {
      json(res, 200, { connectors: await getConnectors() });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/accounts") return createAccount(req, res);
    if (req.method === "PUT" && url.pathname.startsWith("/api/accounts/")) {
      return updateAccount(req, res, decodeURIComponent(url.pathname.replace("/api/accounts/", "")));
    }
    if (req.method === "POST" && url.pathname === "/api/sync") return syncUsage(req, res);
    if (req.method === "POST" && url.pathname === "/api/sync-job") return updateSyncJob(req, res);

    await serveStatic(req, res);
  } catch (error) {
    json(res, 500, { error: error.message });
  }
});

function isSensitiveApi(req, url) {
  return url.pathname.startsWith("/api/") && req.method !== "GET";
}

function isLoopbackRequest(req) {
  const address = req.socket.remoteAddress || "";
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1" ||
    address === "localhost"
  );
}

server.listen(port, () => {
  console.log(`Dashboard server listening on http://127.0.0.1:${port}`);
});

setInterval(async () => {
  try {
    const store = await loadStore();
    if (!store.syncJobs.enabled || !store.accounts.length) return;
    const intervalMs = Number(store.syncJobs.intervalHours || 6) * 3_600_000;
    const lastRun = store.syncJobs.lastRunAt ? new Date(store.syncJobs.lastRunAt).getTime() : 0;
    if (Date.now() - lastRun < intervalMs) return;
    await runAutoSync(store);
    await saveStore(store);
  } catch (error) {
    console.error(`Scheduled sync failed: ${error.message}`);
  }
}, 60_000);
