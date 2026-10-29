# partial · mock

状态：completed。原因：方案已保存：图文快讯，费用 5/10 模拟单位，预计完成 2026-10-29T08:49:00.000Z。制作、审核、发布仍为 planned，未实际执行。

|步|会话|工具|参数|实际返回摘要|依据|状态|
|---|---|---|---|---|---|---|
|1|1|search_materials|{"source":"primary"}|partial，素材 launch-image-01|先查询主题素材|succeeded|
|2|1|generate_script|{"variant":"lite","material_ids":["launch-image-01"]}|生成 script-19c9a83921e0，规格 lite|尝试该规格，复用已成功检索的素材|succeeded|
|3|1|estimate_cost|{"script_id":"script-19c9a83921e0"}|费用5，预算缺口0，时间缺口0分钟|先用实际工具核算约束|succeeded|
|4|1|save_plan|{"script_id":"script-19c9a83921e0"}|{"status":"ok","artifact":"plan.json","script_id":"script-19c9a83921e0","total":5}|估算通过，保存前由工具重新校验|succeeded|
|5|1|finish|{"status":"completed","reason":"方案已经保存"}|{"status":"completed","reason":"方案已保存：图文快讯，费用 5/10 模拟单位，预计完成 2026-10-29T08:49:00.000Z。制作、审核、发布仍为 planned，未实际执行。","model_note":"方案已经保存","model_note_is_unverified":true}|检查到持久化保存结果|succeeded|
