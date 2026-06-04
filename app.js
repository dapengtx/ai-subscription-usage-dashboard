const emptyData = {
  source: "local",
  accounts: [],
  daily: [],
  activities: [],
  syncJobs: { enabled: false, intervalHours: 6, lastRunAt: null },
};

let usageData = emptyData;
let connectors = [];
let chartBars = [];

const providerMeta = {
  chatgpt: { label: "ChatGPT", color: "#17a673" },
  claude: { label: "Claude", color: "#c86a2b" },
};

const state = {
  provider: "all",
  period: "30d",
  editingAccountId: null,
  syncing: false,
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function getVisibleAccounts() {
  if (state.provider === "all") return usageData.accounts;
  return usageData.accounts.filter((account) => account.provider === state.provider);
}

async function loadUsage() {
  try {
    const response = await fetch(`/api/usage?period=${encodeURIComponent(state.period)}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    usageData = await response.json();
  } catch (error) {
    usageData = {
      ...emptyData,
      source: "fallback",
      activities: [
        {
          title: "本地服务未启动",
          detail: `请使用 npm start 启动本地代理服务。当前错误：${error.message}`,
          level: "danger",
          time: "当前",
        },
      ],
    };
  }

  renderAll();
  await loadConnectors();
}

async function loadConnectors() {
  try {
    const response = await fetch("/api/connectors", { cache: "no-store" });
    const data = await response.json();
    connectors = data.connectors || [];
    renderConnectors();
  } catch {
    connectors = [];
    renderConnectors();
  }
}

async function runAutoSync() {
  state.syncing = true;
  renderSyncStatus();
  try {
    const result = await postJson("/api/sync", { mode: "auto" });
    await loadUsage();
    return result;
  } finally {
    state.syncing = false;
    renderSyncStatus();
  }
}

async function postJson(url, payload = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function putJson(url, payload = {}) {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function getStatusLabel(status) {
  return {
    ok: "健康",
    warn: "关注",
    danger: "高风险",
    ready: "可用",
    not_found: "未发现",
    not_configured: "未配置",
    unsupported: "不支持",
  }[status];
}

function connectorStatusClass(status) {
  if (status === "ready") return "ok";
  if (status === "unsupported") return "danger";
  return "warn";
}

function renderMetrics() {
  const accounts = getVisibleAccounts();
  const totalMessages = accounts.reduce((sum, item) => sum + item.messages, 0);
  const totalCost = accounts.reduce((sum, item) => sum + Number(item.fixedCost ?? item.cost ?? 0), 0);
  const totalUsageValue = accounts.reduce((sum, item) => sum + Number(item.usageValue || 0), 0);
  const activeAccounts = accounts.filter((item) => item.activeInPeriod).length;
  const periodLabel = usageData.range?.label || "当前周期";

  document.querySelector("#totalMessages").textContent = totalMessages.toLocaleString();
  document.querySelector("#totalCost").textContent = totalCost ? money.format(totalCost) : "N/A";
  document.querySelector("#activeAccounts").textContent = activeAccounts.toString();
  document.querySelector("#totalUsageValue").textContent = money.format(totalUsageValue);
  document.querySelector("#messageTrend").textContent =
    usageData.source === "local" ? `${periodLabel} · 来自本地留存` : "等待服务连接";
  document.querySelector("#costTrend").textContent = totalCost
    ? `使用价值 ${money.format(totalUsageValue)} · ${totalUsageValue ? (totalUsageValue / totalCost).toFixed(1) : "0.0"}x`
    : `使用价值 ${money.format(totalUsageValue)}`;
  document.querySelector("#seatText").textContent = `${periodLabel} · ${activeAccounts} 个周期活跃账号`;
  document.querySelector("#valueRatioText").textContent = totalCost
    ? `价值 / 固定成本 ${(totalUsageValue / totalCost).toFixed(1)}x`
    : "按 Token 价格估算，统一按 USD 展示";
  document.querySelector("#budgetText").textContent = totalCost ? money.format(totalCost) : "$0";
  const budgetMeter = document.querySelector("#budgetMeter");
  if (budgetMeter) budgetMeter.style.width = `${Math.min(100, Math.round((totalUsageValue / Math.max(totalCost, 1)) * 100))}%`;
}

function renderAccounts() {
  const accounts = getVisibleAccounts();
  if (!accounts.length) {
    document.querySelector("#accountRows").innerHTML = `
      <tr>
        <td colspan="10" class="empty-cell">暂无自动采集数据。点击“自动采集”，或配置可用的本地 CLI 日志连接器。</td>
      </tr>
    `;
    return;
  }

  const rows = accounts
    .map((account) => {
      const meta = providerMeta[account.provider];
      return `
        <tr>
        <td><strong>${account.name}</strong><span>${account.owner} · ${account.members == null ? "本地日志" : `${account.members} 成员`} · 续费 ${account.renewal}</span></td>
          <td>
            <span class="provider-pill">
              <i class="provider-dot" style="background:${meta.color}"></i>${meta.label}
            </span>
          </td>
          <td>${account.plan}</td>
          <td>${account.messages.toLocaleString()}</td>
          <td>${Number(account.tokens || 0).toFixed(2)}M</td>
          <td>${money.format(Number(account.fixedCost ?? account.cost ?? 0))}</td>
          <td>${money.format(Number(account.usageValue || 0))}</td>
          <td>
            <div class="usage-meter" aria-label="${account.quota == null ? "无额度数据" : `额度使用 ${account.quota}%`}">
              <span style="width:${account.quota ?? 0}%"></span>
            </div>
            <span>${account.quota == null ? "未设周期额度" : `${account.quota}% 周期已用`}</span>
          </td>
          <td><span class="status ${account.status}">${getStatusLabel(account.status)}</span></td>
          <td><button class="text-button edit-account-button" type="button" data-account-id="${account.id}">编辑</button></td>
        </tr>
      `;
    })
    .join("");

  document.querySelector("#accountRows").innerHTML = rows;
  document.querySelectorAll(".edit-account-button").forEach((button) => {
    button.addEventListener("click", () => openAccountEditor(button.dataset.accountId));
  });
}

function renderHealth() {
  const items = getVisibleAccounts()
    .map((account) => {
      const sessionText = formatSessionWindow(account);
      const limitMeters = renderHealthLimits(account);
      const qualityText = formatQuality(account);
      const reasonText = formatStatusReasons(account);
      return `
        <div class="health-item">
          <div class="health-top">
            <strong>${account.name}</strong>
            <span class="status ${account.status}">${getStatusLabel(account.status)}</span>
          </div>
          <div class="usage-meter" aria-hidden="true">
            <span style="width:${account.quota ?? Math.min(100, account.messages / 100)}%"></span>
          </div>
          <div class="health-top">
            <span>${account.quota == null ? `${account.messages.toLocaleString()} 次请求` : `${account.quota}% 周期额度已用`}</span>
            <span>${money.format(Number(account.usageValue || 0))} 价值 / ${formatFixedCost(account)}</span>
          </div>
          ${limitMeters}
          ${reasonText ? `<p class="health-detail">${reasonText}</p>` : ""}
          ${sessionText ? `<p class="health-detail">${sessionText}</p>` : ""}
          ${qualityText ? `<p class="health-detail">${qualityText}</p>` : ""}
        </div>
      `;
    })
    .join("");

  document.querySelector("#healthList").innerHTML =
    items || '<div class="empty-box">暂无账号健康度。添加账号后会自动计算额度风险。</div>';
}

function renderSessionWindowTrends() {
  const accounts = getVisibleAccounts().filter((account) => (account.sessionWindows || []).length);
  const target = document.querySelector("#sessionWindowList");
  if (!target) return;
  target.innerHTML = accounts.length
    ? renderWindowAttribution(accounts)
    : '<div class="empty-box">暂无 5 小时窗口数据。Claude Code / Codex CLI 本地日志采集后会自动生成窗口归因。</div>';
}

function formatSessionWindow(account) {
  if (!account.sessionWindow) return "";
  const session = account.sessionWindow;
  const end = new Date(session.endAt);
  const p90 = account.p90Tokens ? `${(account.p90Tokens / 1_000_000).toFixed(2)}M` : "暂无";
  const tokens = `${(Number(session.tokens || 0) / 1_000_000).toFixed(2)}M`;
  const cachedTokens = formatTokenCount(session.billableTokens);
  const value = money.format(Number(session.cost || 0));
  const suffix = session.active ? `窗口结束 ${end.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : "最近窗口已结束";
  return `实时 5 小时窗口：${tokens} tokens，含缓存 ${cachedTokens}，估算价值 ${value}，P90 参考 ${p90}，${suffix}`;
}

function renderHealthLimits(account) {
  const items = [
    {
      label: "实时 5 小时限额",
      used: account.sessionWindow?.tokens || 0,
      limit: account.sessionTokenLimit,
      quota: account.sessionTokenQuota,
      empty: account.sessionWindow ? "未设置 5 小时限额" : "暂无 5 小时窗口",
    },
    {
      label: "近 7 天周限额",
      used: account.weeklyTokens || 0,
      limit: account.weeklyTokenLimit,
      quota: account.weeklyTokenQuota,
      empty: "未设置周限额",
    },
  ];

  return `
    <div class="limit-list">
      ${items.map((item) => renderLimitMeter(item)).join("")}
    </div>
  `;
}

function renderLimitMeter(item) {
  if (!item.limit) {
    return `
      <div class="limit-item muted">
        <div class="limit-top">
          <strong>${item.label}</strong>
          <span>${item.empty}</span>
        </div>
      </div>
    `;
  }

  const quota = Math.min(100, Number(item.quota || 0));
  const remaining = Math.max(0, Number(item.limit || 0) - Number(item.used || 0));
  const status = quota >= 95 ? "danger" : quota >= 80 ? "warn" : "ok";
  return `
    <div class="limit-item">
      <div class="limit-top">
        <strong>${item.label}</strong>
        <span class="status ${status}">${quota}%</span>
      </div>
      <div class="usage-meter ${status}" aria-label="${item.label}已用 ${quota}%">
        <span style="width:${quota}%"></span>
      </div>
      <div class="limit-meta">
        <span>${formatTokenCount(item.used)} / ${formatTokenCount(item.limit)}</span>
        <span>剩余 ${formatTokenCount(remaining)}</span>
      </div>
    </div>
  `;
}

function renderWindowAttribution(accounts) {
  const rows = buildWindowAttributionRows(accounts);
  const totalRequests = rows.reduce((total, row) => total + row.requests, 0);
  const totalTokens = rows.reduce((total, row) => total + row.tokens, 0);
  const totalValue = rows.reduce((total, row) => total + row.usageValue, 0);
  const requestLeader = rows.toSorted((a, b) => b.requests - a.requests)[0];
  const tokenLeader = rows.toSorted((a, b) => b.tokens - a.tokens)[0];
  const riskAccounts = accounts.filter((account) => Number(account.sessionTokenQuota || 0) >= 80);
  return `
    <div class="window-attribution">
      <div class="window-attribution-head">
        <div>
          <strong>当前窗口归因</strong>
          <span>用来判断窗口限额触发后，主要由哪个平台 / 模型贡献了请求和 Token。</span>
        </div>
        <span class="status ${riskAccounts.length ? "warn" : "ok"}">${riskAccounts.length ? `${riskAccounts.length} 个账号接近限额` : "窗口正常"}</span>
      </div>

      <div class="window-summary-grid attribution-summary">
        ${renderWindowStat("窗口请求", totalRequests.toLocaleString(), requestLeader ? `${requestLeader.providerLabel} / ${requestLeader.model} 最多` : "暂无")}
        ${renderWindowStat("窗口 Token", formatTokenCount(totalTokens), tokenLeader ? `${tokenLeader.providerLabel} / ${tokenLeader.model} 最多` : "暂无")}
        ${renderWindowStat("估算价值", money.format(totalValue), "按 Token 价格估算")}
        ${renderWindowStat("限额口径", formatLimitBasisSummary(accounts), "请求数或 Token 阈值")}
      </div>

      <div class="attribution-grid">
        ${renderContributionPanel("按请求次数", rows, "requests", totalRequests)}
        ${renderContributionPanel("按 Token", rows, "tokens", totalTokens)}
      </div>

      <div class="window-insight">
        <span>${formatAttributionAdvice(requestLeader, tokenLeader, accounts)}</span>
        <span>请求最多：${requestLeader ? `${requestLeader.providerLabel} / ${requestLeader.model} · ${requestLeader.requests.toLocaleString()} 次` : "暂无"}</span>
        <span>Token 最多：${tokenLeader ? `${tokenLeader.providerLabel} / ${tokenLeader.model} · ${formatTokenCount(tokenLeader.tokens)}` : "暂无"}</span>
      </div>

      ${renderAttributionTable(rows, totalRequests, totalTokens)}
      ${renderCombinedWindowTrend(accounts)}
    </div>
  `;
}

function buildWindowAttributionRows(accounts) {
  return accounts.flatMap((account) => {
    const current = account.sessionWindow || (account.sessionWindows || []).at(-1);
    if (!current) return [];
    const modelStats = current.modelStats && Object.keys(current.modelStats).length
      ? current.modelStats
      : { [account.modelStats?.[0]?.model || account.plan || "unknown"]: current };
    return Object.entries(modelStats).map(([model, stat]) => ({
      key: `${account.id}:${model}`,
      account,
      accountName: account.name,
      provider: account.provider,
      providerLabel: providerMeta[account.provider].label,
      providerColor: providerMeta[account.provider].color,
      model,
      requests: Number(stat.requests || stat.messages || 0),
      tokens: Number(stat.tokens || 0),
      inputTokens: Number(stat.inputTokens || 0),
      outputTokens: Number(stat.outputTokens || 0),
      cacheReadTokens: Number(stat.cacheReadTokens || 0),
      reasoningTokens: Number(stat.reasoningTokens || 0),
      usageValue: Number(stat.usageValue || current.cost || 0),
      limitBasis: getLimitBasis(account),
      resetText: formatWindowReset(current),
    }));
  }).sort((a, b) => b.tokens - a.tokens);
}

function renderContributionPanel(title, rows, key, total) {
  const sorted = rows.toSorted((a, b) => Number(b[key] || 0) - Number(a[key] || 0));
  return `
    <div class="contribution-panel">
      <div class="contribution-head">
        <strong>${title}</strong>
        <span>${key === "tokens" ? formatTokenCount(total) : total.toLocaleString()}</span>
      </div>
      <div class="contribution-bars">
        ${sorted.map((row) => renderContributionBar(row, key, total)).join("")}
      </div>
    </div>
  `;
}

function renderContributionBar(row, key, total) {
  const value = Number(row[key] || 0);
  const percent = total ? Math.round((value / total) * 100) : 0;
  const label = key === "tokens" ? formatTokenCount(value) : value.toLocaleString();
  return `
    <div class="contribution-row">
      <div class="contribution-label">
        <span><i class="provider-dot" style="background:${row.providerColor}"></i>${row.providerLabel} · ${row.model}</span>
        <strong>${label} · ${percent}%</strong>
      </div>
      <div class="contribution-track" aria-label="${row.providerLabel} ${row.model} ${label}">
        <span style="width:${percent}%; background:${row.providerColor}"></span>
      </div>
    </div>
  `;
}

function renderAttributionTable(rows, totalRequests, totalTokens) {
  return `
    <div class="attribution-table-wrap">
      <table class="attribution-table">
        <thead>
          <tr>
            <th>平台 / 模型</th>
            <th>账号</th>
            <th>请求贡献</th>
            <th>Token 贡献</th>
            <th>输入 / 输出</th>
            <th>缓存 / 推理</th>
            <th>限额口径</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td><strong><i class="provider-dot" style="background:${row.providerColor}"></i>${row.providerLabel}</strong><span>${row.model}</span></td>
              <td>${row.accountName}<span>${row.resetText}</span></td>
              <td>${row.requests.toLocaleString()}<span>${formatPercent(row.requests, totalRequests)}</span></td>
              <td>${formatTokenCount(row.tokens)}<span>${formatPercent(row.tokens, totalTokens)}</span></td>
              <td>${formatTokenCount(row.inputTokens)} / ${formatTokenCount(row.outputTokens)}</td>
              <td>${formatTokenCount(row.cacheReadTokens)} / ${formatTokenCount(row.reasoningTokens)}</td>
              <td><span class="limit-basis">${row.limitBasis}</span></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderCombinedWindowTrend(accounts) {
  return `
    <div class="combined-trend">
      <div class="combined-trend-head">
        <strong>最近窗口走势</strong>
        <span>每个平台独立窗口，合并查看请求和 Token 峰值</span>
      </div>
      ${accounts.map((account) => renderAccountWindowTrend(account)).join("")}
    </div>
  `;
}

function renderAccountWindowTrend(account) {
  const windows = (account.sessionWindows || []).slice(-12);
  if (!windows.length) return "";
  const maxRequests = Math.max(...windows.map((item) => Number(item.messages || 0)), 1);
  const maxTokens = Math.max(...windows.map((item) => Number(item.tokens || 0)), 1);
  return `
    <div class="account-trend-row">
      <div class="account-trend-title">
        <strong><i class="provider-dot" style="background:${providerMeta[account.provider].color}"></i>${providerMeta[account.provider].label}</strong>
        <span>${account.name}</span>
      </div>
      <div class="session-trend">
        ${renderSessionChartRow("请求", windows, "messages", maxRequests, "requests")}
        ${renderSessionChartRow("Token", windows, "tokens", maxTokens, "tokens")}
      </div>
    </div>
  `;
}

function getLimitBasis(account) {
  const tokenLimit = Number(account.sessionTokenLimit || 0);
  const messageLimit = Number(account.messageLimit || 0);
  if (tokenLimit && messageLimit) return `Token 优先 · 请求 ${messageLimit.toLocaleString()}`;
  if (tokenLimit) return `Token · 5 小时 ${formatTokenCount(tokenLimit)}`;
  if (messageLimit) return `请求 · 周期 ${messageLimit.toLocaleString()}`;
  return "未设置";
}

function formatLimitBasisSummary(accounts) {
  const tokenCount = accounts.filter((account) => Number(account.sessionTokenLimit || 0)).length;
  const requestCount = accounts.filter((account) => Number(account.messageLimit || 0) && !Number(account.sessionTokenLimit || 0)).length;
  const unsetCount = accounts.length - tokenCount - requestCount;
  if (tokenCount && requestCount) return `Token ${tokenCount} 个 · 请求 ${requestCount} 个`;
  if (tokenCount && unsetCount) return `Token 阈值 ${tokenCount} 个 · 未设 ${unsetCount} 个`;
  if (tokenCount) return `${tokenCount} 个账号按 Token 阈值`;
  if (requestCount) return `${requestCount} 个账号按请求额度`;
  return "所有账号未设置";
}

function formatAttributionAdvice(requestLeader, tokenLeader, accounts) {
  const hasTokenLimit = accounts.some((account) => Number(account.sessionTokenLimit || 0));
  if (!requestLeader || !tokenLeader) return "建议：先运行自动采集，建立窗口归因。";
  if (!hasTokenLimit) return "建议：当前缺少 5 小时 Token 阈值，无法判断是否由 Token 限额触发。";
  if (!Number(tokenLeader.account.sessionTokenLimit || 0)) {
    return "建议：Token 主要来自未设置窗口阈值的平台；若实际触发限额，请优先核对已设置 Token 阈值的账号。";
  }
  if (requestLeader.key !== tokenLeader.key) {
    return "建议：请求最多和 Token 最多来源不同，限额排查应优先看 Token 贡献最高的模型。";
  }
  return "建议：请求和 Token 主要来自同一来源，可优先检查该平台 / 模型的长上下文任务。";
}

function formatPercent(value, total) {
  if (!total) return "0%";
  return `${Math.round((Number(value || 0) / total) * 100)}%`;
}

function renderWindowStat(label, value, detail) {
  return `
    <div class="window-stat">
      <span>${label}</span>
      <strong>${value}</strong>
      <em>${detail}</em>
    </div>
  `;
}

function formatWindowAdvice(account) {
  if (!account.sessionWindow) return "建议：先运行自动采集，建立实时窗口。";
  if (!account.sessionTokenLimit) return "建议：根据订阅页或 CLI 限额设置 5 小时 Token 阈值。";
  const quota = Number(account.sessionTokenQuota || 0);
  if (quota >= 95) return "建议：暂停高上下文任务，等待窗口重置。";
  if (quota >= 80) return "建议：减少长上下文会话，必要时 compact 或 clear。";
  return "建议：当前窗口余量正常，可继续观察峰值变化。";
}

function formatWindowReset(windowItem) {
  if (!windowItem?.endAt) return "暂无重置时间";
  const end = new Date(windowItem.endAt);
  const remaining = end.getTime() - Date.now();
  const time = end.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  if (remaining <= 0) return `已结束 · ${time}`;
  if (remaining < 3_600_000) return `${Math.ceil(remaining / 60_000)} 分钟后重置`;
  return `${Math.ceil(remaining / 3_600_000)} 小时后重置 · ${time}`;
}

function formatWindowSummary(windows) {
  const requests = windows.reduce((total, item) => total + Number(item.messages || 0), 0);
  const tokens = windows.reduce((total, item) => total + Number(item.tokens || 0), 0);
  return `${requests.toLocaleString()} 次 · ${formatTokenCount(tokens)} Token`;
}

function renderSessionChartRow(label, windows, key, maxValue, className) {
  const peakValue = Math.max(...windows.map((item) => Number(item[key] || 0)), 0);
  return `
    <div class="session-chart-row ${className}">
      <span>${label}</span>
      <div class="session-bars">
        ${windows
          .map((windowItem) => {
            const value = Number(windowItem[key] || 0);
            const height = Math.max(4, Math.round((value / maxValue) * 54));
            const time = formatSessionRange(windowItem);
            const title = `${time} · ${label} ${key === "tokens" ? formatTokenCount(value) : value.toLocaleString()} · 价值 ${money.format(Number(windowItem.cost || 0))}`;
            const classes = [
              windowItem.active ? "active" : "",
              value && value === peakValue ? "peak" : "",
            ].filter(Boolean).join(" ");
            return `<i class="${classes}" style="height:${height}px" title="${title}" aria-label="${title}"></i>`;
          })
          .join("")}
      </div>
    </div>
  `;
}

function formatSessionRange(windowItem) {
  const start = new Date(windowItem.startAt);
  const end = new Date(windowItem.endAt);
  const options = { hour: "2-digit", minute: "2-digit" };
  const day = `${start.getMonth() + 1}/${start.getDate()}`;
  return `${day} ${start.toLocaleTimeString("zh-CN", options)}-${end.toLocaleTimeString("zh-CN", options)}`;
}

function formatFixedCost(account) {
  const value = Number(account.fixedCost ?? account.cost ?? 0);
  return value ? `${money.format(value)} 成本` : "未设置成本";
}

function formatQuality(account) {
  if (!account.lastQuality) return "";
  const quality = account.lastQuality;
  return `数据质量：解析 ${Number(quality.parsed || 0).toLocaleString()} 条，去重 ${Number(quality.duplicate || 0).toLocaleString()} 条，坏 JSON ${Number(quality.invalidJson || 0).toLocaleString()} 条`;
}

function formatStatusReasons(account) {
  const reasons = account.statusReasons || [];
  if (reasons.length) return `状态原因：${reasons.join("；")}`;
  return account.status === "ok" ? "状态原因：当前周期未触发额度、窗口或续费风险。" : "";
}

function renderModelRows() {
  const accounts = getVisibleAccounts();
  const rows = accounts.flatMap((account) => {
    return (account.modelStats || []).map((model) => ({ account, model }));
  });

  document.querySelector("#modelRows").innerHTML =
    rows
      .map(({ account, model }) => {
        return `
          <tr>
            <td><strong>${account.name}</strong><span>${providerMeta[account.provider].label}</span></td>
            <td>${model.model}</td>
            <td>${Number(model.requests || 0).toLocaleString()}</td>
            <td>${formatTokenCount(model.inputTokens)}</td>
            <td>${formatTokenCount(model.outputTokens)}</td>
            <td>${formatTokenCount(model.cacheCreationTokens)}</td>
            <td>${formatTokenCount(model.cacheReadTokens)}</td>
            <td>${formatTokenCount(model.reasoningTokens)}</td>
            <td>${formatTokenCount(model.tokens)}</td>
            <td>${formatTokenCount(model.billableTokens)}</td>
            <td>${money.format(Number(model.usageValue || 0))}</td>
          </tr>
        `;
      })
      .join("") || '<tr><td colspan="11" class="empty-cell">当前周期暂无模型级 Token 明细。</td></tr>';
}

function formatTokenCount(value) {
  const number = Number(value || 0);
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(2)}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(1)}K`;
  return number.toLocaleString();
}

function renderConnectors() {
  const target = document.querySelector("#connectorList");
  if (!target) return;
  target.innerHTML =
    connectors
      .map((item) => {
        return `
          <div class="connector-item">
            <strong>${item.name}</strong>
            <p>${item.detail}</p>
            <span class="status ${connectorStatusClass(item.status)}">${getStatusLabel(item.status)}</span>
          </div>
        `;
      })
      .join("") || '<div class="empty-box">正在读取自动采集源。</div>';
}

function drawChart() {
  const canvas = document.querySelector("#usageChart");
  const ctx = canvas.getContext("2d");
  chartBars = [];
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  ctx.scale(ratio, ratio);

  const width = rect.width;
  const height = rect.height;
  const padding = { top: 26, right: 20, bottom: 44, left: 54 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const visibleKeys =
    state.provider === "all" ? ["chatgpt", "claude"] : [state.provider];
  const maxValue = Math.max(
    ...usageData.daily.map((day) => visibleKeys.reduce((sum, key) => sum + day[key], 0)),
    1,
  );

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fbfcff";
  roundRect(ctx, padding.left, padding.top, chartWidth, chartHeight, 8);
  ctx.fill();

  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.textBaseline = "middle";

  for (let i = 0; i <= 4; i += 1) {
    const y = padding.top + chartHeight * (i / 4);
    ctx.strokeStyle = i === 4 ? "#d7deea" : "#e8edf4";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();

    ctx.fillStyle = "#667085";
    ctx.textAlign = "right";
    const label = formatChartAxisValue(maxValue - maxValue * (i / 4), maxValue);
    ctx.fillText(label, padding.left - 12, y);
  }

  const groupWidth = chartWidth / Math.max(usageData.daily.length, 1);
  const barWidth = Math.max(4, Math.min(18, (groupWidth - 12) / visibleKeys.length));
  const labelStep = Math.max(1, Math.ceil(usageData.daily.length / Math.max(6, Math.floor(chartWidth / 56))));

  usageData.daily.forEach((day, index) => {
    const startX = padding.left + index * groupWidth + groupWidth / 2;

    visibleKeys.forEach((key, keyIndex) => {
      const value = day[key];
      const barHeight = Math.max(value ? 3 : 0, (value / maxValue) * chartHeight);
      const x =
        startX -
        (barWidth * visibleKeys.length + 5 * (visibleKeys.length - 1)) / 2 +
        keyIndex * (barWidth + 5);
      const y = padding.top + chartHeight - barHeight;

      const gradient = ctx.createLinearGradient(0, y, 0, padding.top + chartHeight);
      gradient.addColorStop(0, providerMeta[key].color);
      gradient.addColorStop(1, withAlpha(providerMeta[key].color, 0.68));
      ctx.fillStyle = gradient;
      roundRect(ctx, x, y, barWidth, barHeight, Math.min(5, barWidth / 2));
      ctx.fill();
      chartBars.push({
        x,
        y,
        width: barWidth,
        height: Math.max(barHeight, 1),
        day: day.day,
        provider: providerMeta[key].label,
        value,
        color: providerMeta[key].color,
      });
    });

    if (index % labelStep === 0 || index === usageData.daily.length - 1) {
      ctx.fillStyle = "#667085";
      ctx.textAlign = "center";
      ctx.fillText(day.day, startX, height - 18);
    }
  });

  if (!usageData.daily.length) {
    ctx.fillStyle = "#687083";
    ctx.textAlign = "center";
    ctx.font = "14px Inter, system-ui, sans-serif";
    ctx.fillText("等待本地服务返回用量数据", width / 2, height / 2);
  }

  window.__usageChartBars = chartBars;
}

function formatChartAxisValue(value, maxValue = value) {
  const number = Number(value || 0);
  if (Number(maxValue || 0) >= 1_000 && number > 0) return `${(number / 1_000).toFixed(1)}K`;
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(1)}K`;
  return Math.round(number).toLocaleString();
}

function withAlpha(hex, alpha) {
  const value = hex.replace("#", "");
  const bigint = Number.parseInt(value, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function renderSyncStatus() {
  const target = document.querySelector("#syncStatus");
  if (!target) return;
  const button = document.querySelector("#importButton");
  if (button) {
    button.disabled = state.syncing;
    button.textContent = state.syncing ? "采集中..." : "自动采集";
  }

  if (state.syncing) {
    target.textContent = "正在采集可用连接器...";
    return;
  }

  const lastRunAt = usageData.syncJobs?.lastRunAt;
  if (!lastRunAt) {
    target.textContent = "上次采集：尚未采集";
    return;
  }

  const absolute = new Date(lastRunAt).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  target.textContent = `上次采集：${formatRelativeTime(lastRunAt)} · ${absolute}`;
}

function formatRelativeTime(value) {
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  if (!Number.isFinite(diff)) return "未知";
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

function showChartTooltip(event) {
  const canvas = document.querySelector("#usageChart");
  const tooltip = document.querySelector("#chartTooltip");
  if (!canvas || !tooltip) return;
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const slop = 8;
  let bar = chartBars.find((item) => {
    return (
      x >= item.x - slop &&
      x <= item.x + item.width + slop &&
      y >= item.y - slop &&
      y <= item.y + item.height + slop
    );
  });

  if (!bar) {
    bar = getNearestChartPoint(x, y, rect);
  }

  if (!bar) {
    hideChartTooltip();
    return;
  }

  tooltip.innerHTML = `
    <strong>${bar.day} · ${bar.provider}</strong>
    <span><b>请求数</b><em>${Number(bar.value || 0).toLocaleString()}</em></span>
    <span><b>周期</b><em>${usageData.range?.label || "当前"}</em></span>
  `;
  tooltip.style.left = `${Math.min(Math.max(x, 96), rect.width - 96)}px`;
  tooltip.style.top = `${Math.max(y, 72)}px`;
  tooltip.style.borderColor = `${bar.color}55`;
  tooltip.classList.add("visible");
  tooltip.setAttribute("aria-hidden", "false");
}

function getNearestChartPoint(x, y, rect) {
  if (!usageData.daily.length) return null;
  const padding = { top: 22, right: 18, bottom: 42, left: 44 };
  const chartWidth = rect.width - padding.left - padding.right;
  const chartHeight = rect.height - padding.top - padding.bottom;
  if (
    x < padding.left ||
    x > rect.width - padding.right ||
    y < padding.top ||
    y > padding.top + chartHeight
  ) {
    return null;
  }

  const visibleKeys = state.provider === "all" ? ["chatgpt", "claude"] : [state.provider];
  const groupWidth = chartWidth / Math.max(usageData.daily.length, 1);
  const groupIndex = Math.max(0, Math.min(usageData.daily.length - 1, Math.floor((x - padding.left) / groupWidth)));
  const localX = x - padding.left - groupIndex * groupWidth;
  const keyIndex = Math.max(0, Math.min(visibleKeys.length - 1, Math.floor((localX / groupWidth) * visibleKeys.length)));
  const key = visibleKeys[keyIndex];
  const day = usageData.daily[groupIndex];
  return {
    x,
    y,
    width: 1,
    height: 1,
    day: day.day,
    provider: providerMeta[key].label,
    value: day[key],
    color: providerMeta[key].color,
  };
}

function hideChartTooltip() {
  const tooltip = document.querySelector("#chartTooltip");
  if (!tooltip) return;
  tooltip.classList.remove("visible");
  tooltip.setAttribute("aria-hidden", "true");
}

function roundRect(ctx, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x, y + height);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
}

function setProvider(provider) {
  state.provider = provider;
  document.querySelectorAll(".segment").forEach((button) => {
    const isActive = button.dataset.provider === provider;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", isActive.toString());
  });
  renderAll();
}

function renderAll() {
  renderMetrics();
  renderAccounts();
  renderHealth();
  renderSessionWindowTrends();
  renderModelRows();
  renderSyncStatus();
  drawChart();
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("visible"), 2600);
}

function openInfo(title, body) {
  document.querySelector("#infoTitle").textContent = title;
  document.querySelector("#infoBody").textContent = body;
  document.querySelector("#infoModal").showModal();
}

function serializeForm(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function setAccountModalMode(mode) {
  const isEdit = mode === "edit";
  document.querySelector("#accountModal h2").textContent = isEdit ? "编辑订阅账号" : "新增订阅账号";
  document.querySelector("#accountModal .modal-heading p").textContent = isEdit
    ? "可修改基础信息和本地日志统计阈值。"
    : "仅配置订阅档案和本地日志统计口径；系统不会读取外部服务。";
  document.querySelector("#accountForm button[type='submit']").textContent = isEdit ? "保存修改" : "保存档案";
}

function openAccountEditor(accountId) {
  const account = usageData.accounts.find((item) => item.id === accountId);
  if (!account) return;
  const form = document.querySelector("#accountForm");
  state.editingAccountId = accountId;
  setAccountModalMode("edit");
  form.reset();
  form.elements.provider.value = account.provider;
  form.elements.plan.value = account.plan || "Plus";
  form.elements.name.value = account.name || "";
  form.elements.owner.value = account.owner || "";
  form.elements.members.value = account.members ?? "";
  form.elements.renewalDate.value = /^\d{4}-\d{2}-\d{2}$/.test(account.renewal) ? account.renewal : "";
  form.elements.historyStartDate.value = account.historyStartDate || "";
  form.elements.monthlyPrice.value = account.monthlyPrice ?? "";
  form.elements.messageLimit.value = account.messageLimit ?? "";
  form.elements.sessionTokenLimit.value = account.sessionTokenLimit || "";
  form.elements.weeklyTokenLimit.value = account.weeklyTokenLimit || "";
  document.querySelector("#accountModal").showModal();
}

document.querySelectorAll(".segment").forEach((button) => {
  button.addEventListener("click", () => setProvider(button.dataset.provider));
});

document.querySelector("#periodSelect").addEventListener("change", (event) => {
  state.period = event.target.value;
  loadUsage();
});

document.querySelector("#addAccountButton").addEventListener("click", () => {
  const today = new Date().toISOString().slice(0, 10);
  const form = document.querySelector("#accountForm");
  state.editingAccountId = null;
  setAccountModalMode("create");
  form.reset();
  form.elements.historyStartDate.value = today.slice(0, 8) + "01";
  form.elements.sessionTokenLimit.value = "";
  form.elements.weeklyTokenLimit.value = "";
  document.querySelector("#accountModal").showModal();
});

document.querySelector("#accountForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const payload = serializeForm(form);
    if (state.editingAccountId) {
      await putJson(`/api/accounts/${encodeURIComponent(state.editingAccountId)}`, payload);
    } else {
      await postJson("/api/accounts", payload);
    }
    form.reset();
    document.querySelector("#accountModal").close();
    const wasEditing = Boolean(state.editingAccountId);
    state.editingAccountId = null;
    await loadUsage();
    showToast(wasEditing ? "账号已更新。" : "账号已添加；自动采集仅读取本机日志。");
  } catch (error) {
    showToast(`保存失败：${error.message}`);
  }
});

document.querySelectorAll("[data-close-modal]").forEach((button) => {
  button.addEventListener("click", () => {
    const dialog = button.closest("dialog");
    dialog.close();
    if (dialog.id === "accountModal") state.editingAccountId = null;
  });
});

document.querySelector("#importButton").addEventListener("click", () => {
  runAutoSync()
    .then((result) => showToast(`自动采集完成，更新 ${result.imported || 0} 条记录。`))
    .catch((error) => showToast(`自动采集失败：${error.message}`));
});

document.querySelector("#uploadCsvButton").addEventListener("click", () => {
  openInfo(
    "本地日志自动采集",
    "Claude Code 的订阅用量会从 ~/.claude/projects 下的 JSONL 日志自动读取；ChatGPT 相关用量当前从 ~/.codex/sessions 与 ~/.codex/archived_sessions 下的 Codex CLI JSONL 日志读取。",
  );
});

document.querySelector("#syncJobButton").addEventListener("click", async () => {
  try {
    await postJson("/api/sync-job", { intervalHours: 6 });
    const result = await runAutoSync();
    await loadUsage();
    showToast(`已开启 6 小时自动同步，本次更新 ${result.imported || 0} 条记录。`);
  } catch (error) {
    showToast(`同步任务失败：${error.message}`);
  }
});

document.querySelector("#connectorStatusButton").addEventListener("click", () => {
  openInfo(
    "自动连接器",
    connectors.map((item) => `${item.name}：${getStatusLabel(item.status)}。${item.detail}`).join(" "),
  );
});

document.querySelector("#rulesButton").addEventListener("click", () => {
  openInfo(
    "健康规则",
    "额度达到 80% 标记为关注，达到 95% 标记为高风险；续费 7 天内也会进入关注状态。自动采集会读取本机日志并保留历史记录。",
  );
});

window.addEventListener("resize", drawChart);
document.querySelector("#usageChart").addEventListener("mousemove", showChartTooltip);
document.querySelector("#usageChart").addEventListener("mouseleave", hideChartTooltip);
loadUsage();
