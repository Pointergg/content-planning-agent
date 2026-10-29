import { AgentError, hash, readJSON } from './common.mjs';
export const catalog = await readJSON(new URL('../data/catalog.json', import.meta.url));
const materials = await readJSON(new URL('../data/materials.json', import.meta.url));

function parameters(properties, required = Object.keys(properties)) {
  return { type: 'object', properties: { ...properties, rationale: { type: 'string', description: '一句话说明基于已知结果的动作依据；不要输出内部思维过程' } }, required: [...required, 'rationale'], additionalProperties: false };
}
const text = { type: 'string' };
export const toolDefinitions = [
  { name: 'search_materials', description: '在合成素材库检索；primary 有视频和图片，archive 只有备用图片。返回结果可能部分成功。', parameters: parameters({ source: { type: 'string', enum: ['primary', 'archive'] } }) },
  { name: 'generate_script', description: '基于已成功检索的素材生成本地模板脚本与制作任务计划。可换制作方案；成功结果缓存，失败不缓存。', parameters: parameters({ variant: { type: 'string', enum: Object.keys(catalog.variants) }, material_ids: { type: 'array', items: text, minItems: 1, maxItems: 5 } }) },
  { name: 'estimate_cost', description: '核算指定脚本方案的费用、预计完成时间、缺口与可替代选项。必须先生成该方案脚本。估算成功不等于约束满足。', parameters: parameters({ script_id: text }) },
  { name: 'save_plan', description: '保存已生成且估算通过的方案；服务器会重新校验预算和截止时间，保存失败不能记成功。', parameters: parameters({ script_id: text }) },
  { name: 'finish', description: '结束本次任务。completed 只能用于已保存方案；不能完成时写明原因。', parameters: parameters({ status: { type: 'string', enum: ['completed', 'incomplete'] }, reason: text }) }
].map(f => ({ type: 'function', function: f }));

export function validateAction(action) {
  const definition = toolDefinitions.find(t => t.function.name === action?.tool)?.function;
  if (!definition) throw new AgentError('UNKNOWN_TOOL', '未知工具');
  const args = action.args;
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new AgentError('INVALID_ARGUMENTS', '工具参数必须为对象');
  const schema = definition.parameters;
  if (Object.keys(args).some(k => !Object.hasOwn(schema.properties, k)) || schema.required.some(k => !Object.hasOwn(args, k)))
    throw new AgentError('INVALID_ARGUMENTS', '存在缺失或未知参数');
  for (const [key, spec] of Object.entries(schema.properties)) {
    const value = args[key];
    if (spec.type === 'string' && (typeof value !== 'string' || !value.trim() || value.length > 2000)) throw new AgentError('INVALID_ARGUMENTS', `${key} 须为非空字符串`);
    if (spec.enum && !spec.enum.includes(value)) throw new AgentError('INVALID_ARGUMENTS', `${key} 不在允许范围`);
    if (spec.type === 'array' && (!Array.isArray(value) || value.length < spec.minItems || value.length > spec.maxItems || value.some(v => typeof v !== 'string' || !v))) throw new AgentError('INVALID_ARGUMENTS', `${key} 数组不合法`);
  }
}

export function effectiveNow(state, now) { return Math.max(now, Date.parse(state.started_at) + state.tool_minutes * 60000); }
export function estimate(state, script, now, savePending = true) {
  const selected = catalog.variants[script.variant];
  const items = Object.entries(selected.costs).map(([name, amount]) => ({ name, amount }));
  const production = items.reduce((sum, line) => sum + line.amount, 0);
  const total = production + state.tool_fees + (savePending ? catalog.tools.save_plan.fee : 0);
  const finishAt = effectiveNow(state, now) + (selected.duration_minutes + (savePending ? catalog.tools.save_plan.duration_minutes : 0)) * 60000;
  return {
    script_id: script.id, variant: script.variant, currency: catalog.currency, items,
    production_cost: production, tool_fees: state.tool_fees, save_fee: savePending ? catalog.tools.save_plan.fee : 0, total,
    budget: state.request.budget, budget_gap: Math.max(0, total - state.request.budget),
    production_minutes: selected.duration_minutes, planning_minutes_spent: state.tool_minutes,
    expected_finish: new Date(finishAt).toISOString(), deadline: state.request.deadline,
    deadline_gap_minutes: Math.max(0, Math.ceil((finishAt - Date.parse(state.request.deadline)) / 60000)),
    feasible: total <= state.request.budget && finishAt <= Date.parse(state.request.deadline),
    alternatives: Object.entries(catalog.variants).filter(([id]) => id !== script.variant).map(([id, v]) => ({ variant: id, name: v.name, production_cost: Object.values(v.costs).reduce((a,b)=>a+b,0), production_minutes: v.duration_minutes, required_kind: v.required_kind }))
  };
}

function makeScript(state, args) {
  const selected = args.material_ids.map(id => state.materials[id]);
  if (selected.some(x => !x)) throw new AgentError('DEPENDENCY_MISSING', '素材必须来自本任务已成功检索结果');
  if (new Set(args.material_ids).size !== args.material_ids.length) throw new AgentError('INVALID_ARGUMENTS', '素材 ID 不可重复');
  const variant = catalog.variants[args.variant];
  if (!selected.some(x => x.kind === variant.required_kind)) throw new AgentError('MATERIAL_KIND_MISMATCH', `该方案需要 ${variant.required_kind} 素材`);
  const id = `script-${hash({ theme: state.request.theme, variant: args.variant, materials: [...args.material_ids].sort(), version: catalog.version }).slice(0, 12)}`;
  const theme = state.request.theme;
  return {
    id, variant: args.variant, name: variant.name, material_ids: args.material_ids,
    title: `${theme}｜${variant.name}`, generator: 'local-template-v1',
    content: args.variant === 'lite' ? [
      { scene: '卡片1', visual: selected[0].title, copy: `${theme}开启：用一张图介绍活动价值`, duration_seconds: null },
      { scene: '卡片2', visual: '信息分区排版', copy: '展示活动亮点、参与方式；时间地点由运营确认', duration_seconds: null },
      { scene: '卡片3', visual: '行动按钮与留白', copy: '查看活动详情并参与；发布前核验入口', duration_seconds: null }
    ] : [
      { scene: '吸引注意', visual: selected[0].title, copy: `${theme}，发现值得参与的新体验`, duration_seconds: args.variant === 'premium' ? 10 : 5 },
      { scene: '价值展示', visual: selected.map(x=>x.title).join('；'), copy: '展示活动亮点与参与流程，不编造效果、销量或优惠承诺', duration_seconds: args.variant === 'premium' ? 35 : 15 },
      { scene: '行动引导', visual: '活动信息与报名入口占位', copy: '了解活动详情并参与；具体信息待运营核实', duration_seconds: args.variant === 'premium' ? 15 : 10 }
    ],
    tasks: [
      { id: 'verify', name: '核实活动事实与素材授权', depends_on: [], minutes: Math.round(variant.duration_minutes * .2), status: 'planned' },
      { id: 'produce', name: args.variant === 'lite' ? '制作三张图文卡片' : '按分镜剪辑视频', depends_on: ['verify'], minutes: Math.round(variant.duration_minutes * .6), status: 'planned' },
      { id: 'publish', name: '运营审核并发布', depends_on: ['produce'], minutes: variant.duration_minutes - Math.round(variant.duration_minutes * .2) - Math.round(variant.duration_minutes * .6), status: 'planned' }
    ],
    requires_human_review: true
  };
}

export async function executeTool(action, state, store, now) {
  const a = action.args;
  switch (action.tool) {
    case 'search_materials': {
      const hits = materials.filter(m => m.source === a.source && (state.request.theme.includes(m.topic) || m.topic.includes(state.request.theme)));
      // Fault injection can return valid, usable partial data; it is not a success fabrication.
      const filtered = state.faults.partial_sources?.includes(a.source) ? hits.filter(m => m.kind === 'image') : hits;
      for (const m of filtered) state.materials[m.id] = m;
      return { status: filtered.length === 0 ? 'empty' : filtered.length < hits.length ? 'partial' : 'ok', materials: filtered, warning: filtered.length < hits.length ? '视频索引不可用，图片结果仍可使用' : filtered.length ? null : '未找到匹配主题素材，请补充资料或停止；不可把其他主题素材冒充匹配结果' };
    }
    case 'generate_script': {
      const script = makeScript(state, a); state.scripts[script.id] = script;
      return { status: 'ok', script };
    }
    case 'estimate_cost': {
      const script = state.scripts[a.script_id];
      if (!script) throw new AgentError('DEPENDENCY_MISSING', '必须先成功生成脚本');
      const quote = estimate(state, script, now); state.estimates[a.script_id] = quote;
      return { status: 'ok', estimate: quote };
    }
    case 'save_plan': {
      const script = state.scripts[a.script_id], quote = state.estimates[a.script_id];
      if (!script || !quote) throw new AgentError('DEPENDENCY_MISSING', '保存前必须有成功脚本和估算');
      const fresh = estimate(state, script, now, false);
      if (!fresh.feasible) throw new AgentError('CONSTRAINT_VIOLATION', '保存时约束未满足，须重规划或停止', { estimate: fresh });
      const plan = { schema_version: 1, run_id: state.id, request: state.request, script, estimate: fresh, saved_at: new Date(now).toISOString(), completion_scope: '方案已保存；制作、审核、发布仍为 planned，未实际执行' };
      await store.saveArtifact(plan);
      state.saved_plan = plan;
      return { status: 'ok', artifact: 'plan.json', script_id: script.id, total: fresh.total };
    }
    case 'finish': {
      if (a.status === 'completed' && !state.saved_plan) throw new AgentError('FALSE_COMPLETION', '没有已保存方案，不允许宣称完成');
      if (a.status === 'incomplete' && state.saved_plan) throw new AgentError('INVALID_FINISH', '方案已保存，请报告 completed');
      const quotes = Object.values(state.estimates);
      const summary = state.saved_plan
        ? `方案已保存：${state.saved_plan.script.name}，费用 ${state.saved_plan.estimate.total}/${state.request.budget} ${catalog.currency}，预计完成 ${state.saved_plan.estimate.expected_finish}。制作、审核、发布仍为 planned，未实际执行。`
        : `未保存方案。已保留 ${Object.keys(state.materials).length} 份素材、${Object.keys(state.scripts).length} 份成功脚本。` +
          (quotes.length ? `实际工具估算：${quotes.map(q=>`${q.variant} 费用${q.total}，预算缺口${q.budget_gap}，时间缺口${q.deadline_gap_minutes}分钟`).join('；')}。` : '尚无成功的工具估算。') +
          (state.events.some(e=>e.result?.status==='error') ? `存在失败步骤，请查看 Trace；可在相同输入下续跑，修改预算等约束须新建 id。` : '请查看素材结果及约束缺口；修改主题、预算或截止时间须新建 id。');
      // Model prose is retained for audit, but cannot override the verified user-facing outcome.
      return { status: a.status, reason: summary, model_note: a.reason, model_note_is_unverified: true };
    }
    default: throw new AgentError('UNKNOWN_TOOL', '工具不存在');
  }
}
