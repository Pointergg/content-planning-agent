# partial · live

状态：completed。原因：方案已保存：图文快讯，费用 5/10 模拟单位，预计完成 2026-10-29T08:51:00.000Z。制作、审核、发布仍为 planned，未实际执行。

|步|会话|工具|参数|实际返回摘要|依据|状态|
|---|---|---|---|---|---|---|
|1|1|search_materials|{"source":"primary"}|partial，素材 launch-image-01|先检索主素材库，确认是否有视频素材以支持用户偏好的 premium 估算。|succeeded|
|2|1|search_materials|{"source":"archive"}|ok，素材 launch-archive-01|主库视频索引不可用，检索备用库确认是否有视频素材；若无则按硬依赖只能选 lite。|succeeded|
|3|1|generate_script|{"variant":"lite","material_ids":["launch-image-01","launch-archive-01"]}|生成 script-6fc5683afa4b，规格 lite|主库与备用库均只有图片素材，无视频，按硬依赖只能选 lite 图文快讯。|succeeded|
|4|1|estimate_cost|{"script_id":"script-6fc5683afa4b"}|费用5，预算缺口0，时间缺口0分钟|已有 lite 脚本，先实际估算其费用与完成时间是否满足预算10与截止时间。|succeeded|
|5|1|save_plan|{"script_id":"script-6fc5683afa4b"}|{"status":"ok","artifact":"plan.json","script_id":"script-6fc5683afa4b","total":5}|lite 脚本已实际估算通过（总费用5≤预算10，预计完成早于截止），素材仅图片故按硬依赖保存 lite 方案。|succeeded|
|6|1|finish|{"status":"completed","reason":"已保存 lite 图文快讯方案（script-6fc5683afa4b）：实际估算总费用 5 模拟单位（预算 10），预计 2026-10-29T08:51 完成，早于截止 2026-10-30T10:00。素材方面主库视频索引不可用、备用库仅有图片，无视频素材，故按硬依赖未尝试 premium/standard（目录中 premium 12、standard 8 仅为目录参考，非实际估算）。方案已保存，制作、审核与发布仍为 planned，未实际执行。"}|{"status":"completed","reason":"方案已保存：图文快讯，费用 5/10 模拟单位，预计完成 2026-10-29T08:51:00.000Z。制作、审核、发布仍为 planned，未实际执行。","model_note":"已保存 lite 图文快讯方案（script-6fc5683afa4b）：实际估算总费用 5 模拟单位（预算 10），预计 2026-10-29T08:51 完成，早于截止 2026-10-30T10:00。素材方面主库视频索引不可用、备用库仅有图片，无视频素材，故按硬依赖未尝试 premium/standard（目录中 premium 12、standard 8 仅为目录参考，非实际估算）。方案已保存，制作、审核与发布仍为 planned，未实际执行。","model_note_is_unverified":true}|lite 方案已实际估算通过并成功保存，满足预算与截止时间约束。|succeeded|
