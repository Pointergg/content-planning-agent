import { AgentError, hash, readJSON, validateRequest } from './common.mjs';
import { Store } from './store.mjs';
import { catalog, executeTool, validateAction } from './tools.mjs';

export function publicResult(s, extra = {}) {
  const selected = s.saved_plan?.estimate || Object.values(s.estimates).at(-1) || null;
  return {
    schema_version: 1, id: s.id, status: s.status, reason: s.reason,
    model: s.model, request: s.request, missing: s.missing || [],
    saved_plan: s.saved_plan ? 'plan.json' : null, selected_variant: s.saved_plan?.script.variant || null,
    cost: { currency: catalog.currency, total: s.saved_plan?.estimate.total ?? null, last_estimate: selected, tool_fees: s.tool_fees, api_cost: 'not_measured_separate_from_simulated_budget' },
    task_plan: s.saved_plan?.script.tasks || Object.values(s.scripts).at(-1)?.tasks || [],
    steps: s.events, retained_results: { materials: Object.values(s.materials), scripts: Object.values(s.scripts), estimates: Object.values(s.estimates) },
    limits: s.limits, model_usage: s.usage, planning_minutes: s.tool_minutes, ...extra
  };
}

function faultFor(state, action) {
  const selectors = [`${action.tool}:${action.args.variant || action.args.source || ''}`, action.tool];
  for (const key of selectors) {
    const spec = state.faults.failures?.[key];
    if (!spec) continue;
    const used = state.fault_counts[key] || 0;
    if (spec === 'always' || (Number.isInteger(spec) && used < spec)) {
      state.fault_counts[key] = used + 1;
      throw new AgentError('INJECTED_TOOL_FAILURE', `注入工具失败：${key}`, { retryable: true, successful_results_retained: true });
    }
  }
}

export async function runAgent(input, { model, root = '.runs', now = () => Date.now(), maxSteps = 16, maxToolCalls = 16, faults = {}, preference = '' } = {}) {
  if (!model?.decide) throw new AgentError('MODEL_CONFIG_ERROR', '必须显式指定 live 或 mock 模型');
  if (![maxSteps, maxToolCalls].every(v => Number.isInteger(v) && v >= 1 && v <= 100)) throw new AgentError('INVALID_LIMIT', '步数和工具调用上限须为 1-100 的整数');
  const validation = validateRequest(input, now());
  const id = input.id || `campaign-${hash(input).slice(0, 16)}`;
  const store = new Store(root, id);
  await store.lock();
  let state;
  try {
    const fingerprint = hash({ request: validation.request || input, version: catalog.version });
    state = await store.load();
    if (state && state.fingerprint !== fingerprint) {
      const onlyFillingMissing = state.status === 'needs_input' && state.events.length === 0 && ['theme','budget','deadline'].every(key => {
        if (state.missing.includes(key)) return true;
        if (key === 'deadline') return Date.parse(state.request[key]) === Date.parse(input[key]);
        return state.request[key] === input[key];
      });
      if (onlyFillingMissing) state = null;
      else throw new AgentError('REQUEST_CONFLICT', '同一个 id 的输入已改变；请使用新 id，避免覆盖已有结果');
    }
    if (state?.status === 'completed') {
      // A completed checkpoint alone is insufficient if its artifact was removed or changed.
      let artifact; try { artifact = await readJSON(store.artifactPath); } catch { throw new AgentError('ARTIFACT_MISSING', '已完成任务的方案文件缺失或损坏，请核查本地文件'); }
      if (hash(artifact) !== hash(state.saved_plan)) throw new AgentError('ARTIFACT_MISMATCH', '方案文件与检查点不一致，停止重复执行');
      return publicResult(state, { replayed: true, calls_this_session: 0 });
    }
    if (!state) state = {
      schema_version: 1, id, fingerprint, request: validation.request || input, started_at: new Date(now()).toISOString(),
      status: 'running', reason: '', missing: validation.missing || [], model: model.meta,
      materials: {}, scripts: {}, estimates: {}, cache: {}, saved_plan: null,
      events: [], fault_counts: {}, faults, tool_fees: 0, tool_minutes: 0,
      usage: { calls: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, sessions: 0
    };
    state.limits = { max_steps_per_session: maxSteps, max_tool_calls_per_session: maxToolCalls };
    if (validation.missing || validation.expired) {
      state.status = validation.missing ? 'needs_input' : 'incomplete';
      state.reason = validation.missing ? `缺少必填信息：${validation.missing.join(', ')}` : '截止时间已过，未执行工具';
      await store.save(state); return publicResult(state, { calls_this_session: 0 });
    }
    // Recover the only external side effect if the process stopped after artifact rename but before checkpoint rename.
    if (!state.saved_plan) {
      let artifact; try { artifact = await readJSON(store.artifactPath); } catch (e) { if (e.code !== 'ENOENT') throw new AgentError('ARTIFACT_INVALID', '方案文件损坏，不能自动覆盖'); }
      if (artifact) {
        if (artifact.run_id !== state.id || hash(artifact.request) !== hash(state.request)) throw new AgentError('ARTIFACT_MISMATCH', '无法恢复与当前任务不匹配的方案');
        state.saved_plan = artifact; state.status = 'completed'; state.reason = '从已保存方案恢复完成状态';
        await store.save(state); return publicResult(state, { recovered: true, calls_this_session: 0 });
      }
    }
    state.sessions += 1; state.status = 'running'; state.model = model.meta;
    let calls = 0;
    await store.save(state);
    for (let step = 0; step < maxSteps; step++) {
      if (calls >= maxToolCalls) break;
      const context = {
        request: state.request, preference, session: state.sessions,
        state: { materials: state.materials, scripts: state.scripts, estimates: state.estimates, saved_plan: state.saved_plan, planning_minutes_spent: state.tool_minutes, tool_fees: state.tool_fees },
        observations: state.events.slice(-30), now: new Date(now()).toISOString(), remaining_steps: maxSteps - step, remaining_tool_calls: maxToolCalls - calls
      };
      let action;
      try {
        state.usage.calls += 1;
        action = await model.decide(context);
        for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens']) state.usage[key] += Number(action.usage?.[key] || 0);
      } catch (error) {
        const code = error instanceof AgentError ? error.code : 'MODEL_ERROR';
        const message = error instanceof AgentError ? error.message : '模型适配器异常，未执行本轮工具';
        state.events.push({ seq: state.events.length + 1, session: state.sessions, kind: 'model_error', result: { status: 'error', code, message } });
        state.status = state.saved_plan ? 'completed' : 'incomplete'; state.reason = message;
        await store.save(state); return publicResult(state, { calls_this_session: calls });
      }
      calls += 1;
      const event = { seq: state.events.length + 1, session: state.sessions, at: new Date(now()).toISOString(), kind: 'tool', tool: action.tool, args: action.args, decision_basis: action.args?.rationale || '', model: model.meta, response_id: action.response_id || null, cached: false };
      try {
        validateAction(action);
        const { rationale, ...semanticArgs } = action.args;
        const cacheKey = hash({ tool: action.tool, args: semanticArgs });
        const cacheable = ['search_materials', 'generate_script'].includes(action.tool);
        if (cacheable && state.cache[cacheKey]) {
          event.result = state.cache[cacheKey]; event.cached = true;
        } else {
          const cost = catalog.tools[action.tool];
          state.tool_fees += cost.fee;
          state.tool_minutes += cost.duration_minutes;
          faultFor(state, action);
          event.result = await executeTool(action, state, store, now());
          if (cacheable) state.cache[cacheKey] = event.result;
        }
        event.step_status = 'succeeded';
      } catch (error) {
        event.step_status = 'failed';
        event.result = { status: 'error', code: error instanceof AgentError ? error.code : 'TOOL_ERROR', message: error instanceof AgentError ? error.message : '工具执行异常，成功结果已保留', details: error instanceof AgentError ? error.details : {} };
      }
      state.events.push(event);
      if (action.tool === 'finish' && event.step_status === 'succeeded') {
        state.status = event.result.status; state.reason = event.result.reason;
        await store.save(state); return publicResult(state, { calls_this_session: calls });
      }
      await store.save(state);
    }
    state.status = state.saved_plan ? 'completed' : 'incomplete';
    state.reason = state.saved_plan ? '方案已保存；达到本次执行上限' : '达到本次步数或工具调用上限；成功结果已保留，可用同一 id 续跑';
    await store.save(state); return publicResult(state, { calls_this_session: calls });
  } finally { await store.unlock(); }
}
