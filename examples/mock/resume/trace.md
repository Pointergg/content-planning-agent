# resume · mock

状态：incomplete。原因：达到本次步数或工具调用上限；成功结果已保留，可用同一 id 续跑

|步|会话|工具|参数|实际返回摘要|依据|状态|
|---|---|---|---|---|---|---|
|1|1|search_materials|{"source":"primary"}|ok，素材 launch-video-01,launch-image-01|先查询主题素材|succeeded|
|2|1|generate_script|{"variant":"premium","material_ids":["launch-video-01"]}|生成 script-f6ceeea3bc62，规格 premium|尝试该规格，复用已成功检索的素材|succeeded|
|3|1|estimate_cost|{"script_id":"script-f6ceeea3bc62"}|费用12，预算缺口0，时间缺口0分钟|先用实际工具核算约束|succeeded|
|4|1|save_plan|{"script_id":"script-f6ceeea3bc62"}|{"status":"error","code":"INJECTED_TOOL_FAILURE","message":"注入工具失败：save_plan","details":{"retryable":true,"successful_results_retained":true}}|估算通过，保存前由工具重新校验|failed|
