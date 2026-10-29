# 内容任务规划 Agent

帮助运营人员在给定预算与截止时间内保存一份内容活动方案。重点是**模型观察工具结果后重规划**，以及预算、依赖、失败状态与重复执行的工程约束。

运行形式：CLI。Node.js **22+**，原生 ESM、`fetch`、`node:test`，**零第三方运行依赖，无需 npm install**。真实决策接入 DeepSeek `deepseek-chat`；工具是本地合成模拟。

## 评审先看这里

|要核验的行为|实际在线证据|
|---|---|
|正常生成并保存方案|[normal/trace.md](examples/live/normal/trace.md) · [保存方案](examples/live/normal/plan.json)|
|预算10，实际估算12，换8再估算保存|[over-budget/trace.md](examples/live/over-budget/trace.md)|
|工具一次失败后处理，保留成功素材|[tool-failure/trace.md](examples/live/tool-failure/trace.md)|
|持续失败后改用替代规格|[tool-failure-persistent/trace.md](examples/live/tool-failure-persistent/trace.md)|
|资料部分成功，保留图片改用图文|[partial/trace.md](examples/live/partial/trace.md)|
|预算不足时停止并报告缺口|[no-feasible/output.json](examples/live/no-feasible/output.json)|
|缺少预算 / 截止时间|[missing-budget](examples/live/missing-budget/output.json) · [missing-deadline](examples/live/missing-deadline/output.json)|
|相同任务重复执行，零新增模型调用|[repeat/output.json](examples/live/repeat/output.json)|
|保存失败后续跑，不重复检索和生成|[失败](examples/live/resume/trace.md) → [续跑](examples/live/resumed/trace.md)|
|无素材 / 截止时间不足|[no-materials](examples/live/no-materials/trace.md) · [deadline](examples/live/deadline/trace.md)|

[在线验收汇总](examples/live/summary.json)与[离线验收汇总](examples/mock/summary.json)分开保存；每个目录都有输入、实际输出、JSON Trace、可读 Trace，完成用例另含 `plan.json`。**Mock 是规则型测试替身，不作为真实模型决策效果证据。** [测试结果](examples/tests/results.json)由脚本执行生成。

## 一分钟离线复现

在仓库根目录执行（Windows PowerShell、macOS、Linux 均可）：

```sh
node --version
node --test --test-reporter=spec
node scripts/evaluate.mjs --provider mock --output-dir .runs/review-mock
```

单用例：

```sh
node src/cli.mjs --provider mock --input examples/inputs/over-budget.json --root .runs/review --now 2026-10-29T08:00:00Z
```

应看到 `status: completed`、`selected_variant: standard`、`cost.total: 8`，Trace 内有 `12 → 8` 两次估算。再次执行同一命令，返回 `replayed: true`、`calls_this_session: 0`，文件内容不变。

## 真实模型运行

复制 `.env.example` 为 `.env`（PowerShell：`Copy-Item .env.example .env`；其他终端：`cp .env.example .env`），填入自己的 API key：

```dotenv
MODEL_BASE_URL=https://api.deepseek.com
MODEL_NAME=deepseek-chat
MODEL_API_KEY=填写自己的密钥
MODEL_TIMEOUT_MS=60000
```

```sh
node --env-file=.env src/cli.mjs --provider live --input examples/inputs/over-budget.json --root .runs/live-review --now 2026-10-29T08:00:00Z --preference "素材支持时先估算premium；超限后选可行替代"
node --env-file=.env scripts/evaluate.mjs --provider live --output-dir .runs/review-live
```

真实运行会产生服务商 API 费用；该费用与题目的“模拟预算单位”分开。默认不传 `--provider` 时使用 **live**；不自动降级 Mock。仓库中的在线记录来自真实 API 调用，但其素材、费用和工时仍为合成模拟。

`--now` 是**可复现的模拟业务时钟**，用于历史固定日期样例。实际使用请去掉 `--now`，并在新输入文件中填写未来的截止时间。例如：

```json
{"id":"my-campaign-001","theme":"新品发布","budget":10,"deadline":"2030-01-01T18:00:00+08:00"}
```

支持的合成主题：`新品发布`、`环保活动`、`校园招聘`。其他主题会返回资料不足，不会借用不相关素材。

## 注入失败与续跑

```sh
node src/cli.mjs --provider mock --input examples/inputs/resume.json --root .runs/resume-review --faults examples/faults/save-once.json --max-steps 4 --now 2026-10-29T08:00:00Z
node src/cli.mjs --provider mock --input examples/inputs/resume.json --root .runs/resume-review --now 2026-10-29T08:00:00Z
```

第一次在保存处失败并返回 `incomplete`；第二次读取同一检查点，复用成功素材、脚本与估算后保存。故障计数跨会话持久化，一次失败不会在续跑时重新注入。

- 同 `id` + 同输入：已完成直接读结果；未完成继续；缺少必填字段时可以在原 `id` 补齐。
- 同 `id` 改主题、已有预算或已有截止时间：`REQUEST_CONFLICT`，须新建 `id`。
- 每次最多16步/16次动作，可通过 `--max-steps`、`--max-tool-calls` 设置1–100的上限。达到上限返回明确未完成；每次模型选择均计入上限，错误和缓存命中也占一次动作。
- CLI 退出码：`0` 已保存；`2` 未完成/缺信息（预期业务结果）；`1` 配置、输入或I/O错误。退出码2不是程序崩溃。
- `--output result.json` 保存结构化输出；运行检查点和方案在 `--root/<id>/`。

## 设计

```mermaid
flowchart LR
  U[主题 / 预算 / 截止时间] --> V[输入校验与任务锁]
  V --> S[恢复持久状态]
  S --> M[模型选择一个动作]
  M --> G[参数与依赖校验]
  G --> T[检索 / 脚本 / 估算 / 保存]
  T --> O[成功 / 部分成功 / 失败结果]
  O --> C[保存检查点与Trace]
  C --> M
  C --> E[已保存 / 未完成 / 达到上限]
```

引擎没有“预算超了就选 standard”的业务分支。在线模式的重试、换规格、换素材源、停止由模型选择；工具层只限制合法性。估算通过也不等于保存成功，保存前重新核算。最终交付状态、费用和未完成摘要来自工具证据，模型自由文字仅作未验证审计备注。

制作费用为 `premium=12`、`standard=8`、`lite=5`。总费用 = 选定方案制作费 + 已发生工具费 + 待发生保存费。当前本地工具均免费，失败/重试消耗模拟工时。未选中的备选方案不重复计入制作费，因为它们尚未实际制作。

**completed 仅表示方案文件已保存**。方案内“核实 → 制作 → 发布”任务带有依赖，状态仍是 `planned`，并不声称内容已生产或上线。

## 目录与材料

```text
src/       agent / model / tools / store / CLI
data/      合成素材、方案价格、工具费用与工时
tests/     可执行工程与模型适配器测试
examples/  inputs、faults、live、mock、tests 的实际证据
scripts/   在线/离线验收和测试结果生成
docs/      需求、方案、评估、AI使用、复盘与会话计时
.github/   Windows/Linux、Node22/24 CI
```

- [01 需求与成功标准](docs/01-requirements.md)
- [02 方案、状态与取舍](docs/02-solution.md)
- [03 评估与限制](docs/03-evaluation.md)
- [04 AI使用范围与贡献](docs/04-ai-usage.md)
- [05 复盘与实际用时](docs/05-retrospective.md)

题目：**内容任务规划 Agent**。数字题号未在当前提供材料中明确，提交时按卷面填写，不推测编号。最终 GitHub URL 与 commit SHA 在交付消息中给出；仓库内用 `git rev-parse HEAD` 验证。未接入数据库、真实制作/发布服务、付费素材平台或分布式运行时。
