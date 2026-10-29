# deadline · mock

状态：incomplete。原因：未保存方案。已保留 2 份素材、3 份成功脚本。实际工具估算：premium 费用12，预算缺口0，时间缺口159分钟；standard 费用8，预算缺口0，时间缺口75分钟；lite 费用5，预算缺口0，时间缺口31分钟。请查看素材结果及约束缺口；修改主题、预算或截止时间须新建 id。

|步|会话|工具|参数|实际返回摘要|依据|状态|
|---|---|---|---|---|---|---|
|1|1|search_materials|{"source":"primary"}|ok，素材 launch-video-01,launch-image-01|先查询主题素材|succeeded|
|2|1|generate_script|{"variant":"premium","material_ids":["launch-video-01"]}|生成 script-f6ceeea3bc62，规格 premium|尝试该规格，复用已成功检索的素材|succeeded|
|3|1|estimate_cost|{"script_id":"script-f6ceeea3bc62"}|费用12，预算缺口0，时间缺口159分钟|先用实际工具核算约束|succeeded|
|4|1|generate_script|{"variant":"standard","material_ids":["launch-video-01"]}|生成 script-866c8df45141，规格 standard|尝试该规格，复用已成功检索的素材|succeeded|
|5|1|estimate_cost|{"script_id":"script-866c8df45141"}|费用8，预算缺口0，时间缺口75分钟|先用实际工具核算约束|succeeded|
|6|1|generate_script|{"variant":"lite","material_ids":["launch-image-01"]}|生成 script-19c9a83921e0，规格 lite|尝试该规格，复用已成功检索的素材|succeeded|
|7|1|estimate_cost|{"script_id":"script-19c9a83921e0"}|费用5，预算缺口0，时间缺口31分钟|先用实际工具核算约束|succeeded|
|8|1|finish|{"status":"incomplete","reason":"可用规格均不满足预算或截止时间，或保存工具失败；请查看估算缺口和失败步骤后续跑"}|{"status":"incomplete","reason":"未保存方案。已保留 2 份素材、3 份成功脚本。实际工具估算：premium 费用12，预算缺口0，时间缺口159分钟；standard 费用8，预算缺口0，时间缺口75分钟；lite 费用5，预算缺口0，时间缺口31分钟。请查看素材结果及约束缺口；修改主题、预算或截止时间须新建 id。","model_note":"可用规格均不满足预算或截止时间，或保存工具失败；请查看估算缺口和失败步骤后续跑","model_note_is_unverified":true}|保留成功结果并报告未完成|succeeded|
