# 03 验证结果、失败与限制

## 可复现验证

```sh
node scripts/verify.mjs
node scripts/evaluate.mjs --provider mock --output-dir .runs/review-mock
node --env-file=.env scripts/evaluate.mjs --provider live --output-dir .runs/review-live
```

在线验证需要自己的密钥并产生 API 费用。生成目录独立，避免把已完成缓存误当成新一次评估。所有案例使用明确标记的模拟时钟 `2026-10-29T08:00:00Z`，业务耗时来自合成目录；报告生成时间是实际系统时间。

## 当前证据

- [可执行测试结果](../examples/tests/results.json)及[原始测试输出](../examples/tests/output.txt)：运行时生成，47项工程/适配器测试。
- [离线汇总](../examples/mock/summary.json)：13个验收记录。规则型Mock只验证流程与状态，不证明模型决策。
- [真实DeepSeek汇总](../examples/live/summary.json)：13个验收记录，包含正常、缺信息、超预算、临时及持续工具失败、无可行预算、部分成功、无素材、截止不足、重复执行、失败续跑。

这是小型确定性合成场景的一次受控验收结果，**不是模型泛化准确率**。记录中每次API实际工具调用带 `response_id`，便于与 `model_usage` 和Trace核对；不记录API密钥、模型内部思维或真实用户数据。服务商即便温度0仍可能产生不同轨迹，不能保证每次步数相同。

## 预期与实际

|用例|预期|核对实际文件|
|---|---|---|
|normal|已保存，费用12，生产任务仍planned|[输出](../examples/live/normal/output.json)、[方案](../examples/live/normal/plan.json)|
|over-budget|12超10→改8→重估→保存|[Trace](../examples/live/over-budget/trace.md)|
|tool-failure|一次失败后调整，素材保留|[Trace](../examples/live/tool-failure/trace.md)|
|tool-failure-persistent|持续premium失败，换规格|[Trace](../examples/live/tool-failure-persistent/trace.md)|
|missing-budget/deadline|needs_input、零调用|[预算](../examples/live/missing-budget/output.json)、[截止](../examples/live/missing-deadline/output.json)|
|no-feasible|最低制作费5，预算4，未保存|[输出](../examples/live/no-feasible/output.json)|
|partial|保留图片结果，改lite|[Trace](../examples/live/partial/trace.md)|
|no-materials|无相关素材，未生成脚本|[Trace](../examples/live/no-materials/trace.md)|
|deadline|预计超过截止，未保存|[Trace](../examples/live/deadline/trace.md)|
|repeat|零新增调用、文件内容不变|[输出](../examples/live/repeat/output.json)、[汇总断言](../examples/live/summary.json)|
|resume→resumed|保存失败→续跑，未重复素材和脚本|[失败](../examples/live/resume/trace.md)、[续跑](../examples/live/resumed/trace.md)|

具体工具步数、token数和用时以JSON实际记录为准，不在文档中手工编造。`step_status=succeeded` 表示工具成功返回；估算的 `feasible=false` 不是工具异常，更不是方案已满足约束。

## 自动化测试覆盖

`tests/agent.test.mjs` 检查成本分项、任务依赖、预算缺口、资料缺失、失败和部分成功、时间不足、不可变需求、重复执行、故障续跑、动作上限、锁、文件缺失、保存/状态写入之间的恢复、非法模型动作、日期/预算输入、缓存工时、最终摘要的事实约束。

`tests/model.test.mjs` 使用HTTP替身检查原生工具schema、单动作响应、usage、认证/网络错误、非法JSON、远程HTTPS要求。这里的HTTP替身不计为真实模型验证；真实API证据独立存放于 `examples/live/`。

CI 在Windows/Linux、Node22/24上运行自动化测试与离线验收；未在GitHub Actions配置真实密钥，CI不运行付费模型。远程CI是否通过以仓库Actions实际状态为准，不能把本地通过写成已在全部平台跑过。

## 发现过的真实问题与修正

1. 图片部分成功时，早期模型曾尝试生成需要视频的premium。依赖守卫拒绝，没有伪成功。随后加强素材硬依赖提示；模型仍有时会检索备用图片，属于质量可优化项。
2. 早期模型把目录参考价称为“三档均已实际估算”，但Trace只支持部分规格的工具估算。现在工具证据生成最终原因，模型原文降为未验证备注；测试专门注入错误总结验证这一边界。
3. 检查发现两位小数存在浮点误判、日期自动进位、已完成任务截止后重放的指纹问题、保存工时可能重复计入。均加入回归测试并修复。

## 已知限制

- 仅有少量合成主题、三种固定规格，脚本是模板；不评估文案原创性和营销转化。
- 工具费用当前为0，非零实际支付与外部扣费补偿未实现。真实服务商账单未查询。
- 模型可能多试一次无效动作、重试过多或过早停止；守卫和上限防止伪成功，但不保证最优计划。
- 参考偏好让预算场景先走premium，属于受控演示输入；不把它当无提示泛化能力证明。
- 状态文件是可信本地存储，不支持多机、权限隔离、恶意篡改恢复或断电级fsync保障。
- 模拟时钟仅用于复现，不证明实际制作能按时完成。活动事实、素材授权、发布入口必须人工确认。
