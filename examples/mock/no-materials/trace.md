# no-materials · mock

状态：incomplete。原因：未保存方案。已保留 0 份素材、0 份成功脚本。尚无成功的工具估算。请查看素材结果及约束缺口；修改主题、预算或截止时间须新建 id。

|步|会话|工具|参数|实际返回摘要|依据|状态|
|---|---|---|---|---|---|---|
|1|1|search_materials|{"source":"primary"}|empty，素材 |先查询主题素材|succeeded|
|2|1|search_materials|{"source":"archive"}|empty，素材 |主库不可用或无素材，尝试备用库|succeeded|
|3|1|finish|{"status":"incomplete","reason":"两处素材库均无可用资料，请补充主题素材"}|{"status":"incomplete","reason":"未保存方案。已保留 0 份素材、0 份成功脚本。尚无成功的工具估算。请查看素材结果及约束缺口；修改主题、预算或截止时间须新建 id。","model_note":"两处素材库均无可用资料，请补充主题素材","model_note_is_unverified":true}|素材依赖未满足|succeeded|
