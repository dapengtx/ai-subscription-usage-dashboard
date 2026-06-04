# Codex for Open Source 申请表填写建议

表单地址：https://openai.com/zh-Hans-CN/form/codex-for-oss/

以下内容可直接复制到表单。请把姓名、邮箱和 OpenAI 组织 ID 替换为你自己的真实信息。

## 基本信息

### 姓氏

填写你的真实姓氏。

### 名字

填写你的真实名字。

### 电子邮箱

填写与你 ChatGPT / OpenAI 账号关联的邮箱。

### GitHub 用户名

```text
dapengtx
```

### GitHub 代码仓库 URL

```text
https://github.com/dapengtx/ai-subscription-usage-dashboard
```

### 说明你的角色

选择：

```text
主要维护者
```

## 为什么这个代码仓库符合要求？

500 字以内建议填写：

```text
这是一个本地优先的开源 AI 订阅用量分析仪表盘，用于帮助开发者和团队从本机 Claude Code 与 Codex CLI 日志中诊断订阅使用情况。项目不上传日志、不要求 API Key，也不调用 OpenAI 或 Anthropic Admin API，重点解决 AI 编程工具使用中的真实运营问题：模型级 Token 归因、5 小时窗口限额诊断、请求次数与 Token 限制区分、固定订阅成本与 Token 估算使用价值对比、本地历史留存和账号健康度监控。

虽然项目刚开源，但它面向的是正在快速增长的 AI coding 工具使用场景。很多个人开发者和小团队都会遇到“窗口限额触发后不知道是谁、哪个模型、哪类任务消耗最多”的问题。本项目以隐私保护的方式提供透明归因，有助于开发者更高效、更可控地使用 Codex CLI、Claude Code 等 AI 编程工具。
```

## 我感兴趣的是

建议选择：

```text
项目的 API 额度
```

如果后续希望把项目扩展到日志安全、敏感信息检测或本地安全审计，也可以再考虑选择 `Codex Security`。

## OpenAI 组织 ID

到 OpenAI Platform 的组织设置中查询你的 Organization ID，然后填写真实值。

## 你将如何针对自己的项目使用 API 额度？

500 字以内建议填写：

```text
我计划将 API 额度用于改进这个开源项目的维护和质量：为 Claude Code 与 Codex CLI JSONL 日志解析器生成测试用例，覆盖不同日志格式、缺失字段、重复记录、缓存 Token、推理 Token 和窗口切分等边界情况；辅助审查 Pull Request；改进 5 小时窗口归因逻辑，帮助用户判断限额是由请求次数还是 Token 消耗触发；生成和维护中英文文档、变更日志和兼容性说明。

项目会继续保持本地优先和隐私优先：用户日志和用量数据不会上传，API 额度主要用于项目开发、测试、文档和维护工作，而不是采集用户数据。
```

## 还有其他需要说明的事项吗？

500 字以内建议填写：

```text
这个项目刻意采用轻量、本地优先的架构：Node.js 本地服务 + 原生 HTML/CSS/JavaScript 前端。它不需要 API Key，不调用远程 Admin API，也默认将 data/store.json、本地截图、IDE 配置和环境变量排除在版本控制之外。

我会持续维护这个项目，重点完善 Codex CLI 与 Claude Code 的模型级归因、窗口限额诊断、隐私保护、本地历史留存和开发者使用体验。希望它能成为 AI 编程工具用户排查订阅用量、理解 Token 消耗和优化长上下文任务的实用开源工具。
```

## 申请前建议检查

- GitHub 仓库保持 Public。
- GitHub Profile 尽量公开可见。
- README 中有项目动机、功能、隐私说明和运行方式。
- `data/store.json` 不进入仓库。
- 添加 GitHub topics：`codex`、`claude-code`、`chatgpt`、`usage-dashboard`、`token-usage`、`local-first`、`developer-tools`、`ai-usage`。
