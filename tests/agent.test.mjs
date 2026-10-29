import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgent } from '../src/agent.mjs';
import { MockModel, LiveModel } from '../src/model.mjs';
import { Store } from '../src/store.mjs';

const START = Date.parse('2026-10-29T08:00:00Z');
const base = { id: 'test', theme: '新品发布', budget: 20, deadline: '2026-10-30T10:00:00Z' };
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'content-agent-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, now: () => START, model: new MockModel() };
}
const tool = (tool, args) => ({ tool, args: { ...args, rationale: '测试指定动作验证工具边界' } });
class SequenceModel {
  constructor(actions) { this.actions = actions; this.meta = { provider: 'test-sequence', mock: true }; }
  async decide() { return this.actions.shift() || tool('finish', {status:'incomplete', reason:'测试结束'}); }
}

test('正常完成：保存真实文件，成本12，生产任务仍为planned', async t => {
  const o = await setup(t), r = await runAgent(base, o);
  assert.equal(r.status, 'completed'); assert.equal(r.cost.total, 12);
  const plan = JSON.parse(await readFile(join(o.root, base.id, 'plan.json'), 'utf8'));
  assert.equal(plan.estimate.total, r.cost.total);
  assert.ok(plan.script.tasks.every(x=>x.status === 'planned'));
  assert.equal(plan.script.tasks.reduce((s,x)=>s+x.minutes,0), plan.estimate.production_minutes);
  assert.deepEqual(plan.script.tasks.at(-1).depends_on, ['produce']);
});
test('预算10：观察12超限后选择8，保留原成功脚本', async t => {
  const r = await runAgent({...base,budget:10}, await setup(t));
  assert.equal(r.status, 'completed'); assert.equal(r.cost.total, 8);
  assert.deepEqual(r.steps.filter(x=>x.tool==='estimate_cost').map(x=>x.result.estimate.total), [12,8]);
  assert.equal(r.retained_results.scripts.length, 2);
  assert.equal(r.steps.filter(x=>x.tool==='search_materials').length,1);
});
test('所有规格超预算：未完成、明确缺口、没有保存', async t => {
  const r = await runAgent({...base,budget:4}, await setup(t));
  assert.equal(r.status,'incomplete'); assert.equal(r.saved_plan,null);
  assert.equal(r.cost.total,null); assert.equal(r.cost.last_estimate.budget_gap,1);
  assert.ok(r.retained_results.estimates.every(x=>!x.feasible));
});
for (const missing of ['budget','deadline','theme']) test(`缺少${missing}：不调用模型或工具`, async t => {
  const input = {...base}; delete input[missing];
  const r = await runAgent(input, await setup(t));
  assert.equal(r.status,'needs_input'); assert.ok(r.missing.includes(missing)); assert.equal(r.steps.length,0); assert.equal(r.model_usage.calls,0);
});
test('脚本失败：切换规格并保留素材，失败不记成功', async t => {
  const o = await setup(t);
  const r = await runAgent(base,{...o,faults:{failures:{'generate_script:premium':1}}});
  assert.equal(r.status,'completed'); assert.equal(r.selected_variant,'standard');
  assert.equal(r.steps.filter(x=>x.tool==='search_materials').length,1);
  const failure = r.steps.find(x=>x.result.code==='INJECTED_TOOL_FAILURE');
  assert.equal(failure.step_status,'failed'); assert.equal(r.retained_results.scripts.length,1);
});
test('部分成功：保留图片，选图文方案', async t => {
  const r = await runAgent(base,{...await setup(t),faults:{partial_sources:['primary']}});
  assert.equal(r.steps[0].result.status,'partial'); assert.equal(r.selected_variant,'lite'); assert.equal(r.cost.total,5);
});
test('主库失败：检索备用库，保存图文方案', async t => {
  const r = await runAgent(base,{...await setup(t),faults:{failures:{'search_materials:primary':'always'}}});
  assert.equal(r.status,'completed'); assert.equal(r.selected_variant,'lite');
  assert.equal(r.steps[1].args.source,'archive');
});
test('无主题资料：不伪造素材，不生成脚本', async t => {
  const r = await runAgent({...base,theme:'量子咖啡节'},await setup(t));
  assert.equal(r.status,'incomplete'); assert.equal(r.retained_results.materials.length,0); assert.equal(r.retained_results.scripts.length,0);
});
test('截止时间不足：工具估算时间缺口，禁止保存', async t => {
  const r = await runAgent({...base,deadline:new Date(START+30*60000).toISOString()},await setup(t));
  assert.equal(r.status,'incomplete'); assert.ok(r.cost.last_estimate.deadline_gap_minutes>0); assert.equal(r.saved_plan,null);
});
test('截止已过：零工具调用', async t => {
  const r = await runAgent({...base,deadline:new Date(START-1).toISOString()},await setup(t));
  assert.equal(r.status,'incomplete'); assert.equal(r.steps.length,0);
});
test('重复执行：零新增模型调用、文件内容不变、成本不叠加', async t => {
  const o=await setup(t), a=await runAgent(base,o);
  const path=join(o.root,base.id,'plan.json'), before=await readFile(path,'utf8');
  const b=await runAgent(base,{...o,model:new SequenceModel([])});
  assert.equal(b.replayed,true); assert.equal(b.calls_this_session,0); assert.equal(a.model_usage.calls,b.model_usage.calls);
  assert.equal(b.cost.total,12); assert.equal(await readFile(path,'utf8'),before);
});
test('同id不同输入：拒绝覆盖原方案', async t => {
  const o=await setup(t); await runAgent(base,o);
  await assert.rejects(runAgent({...base,budget:10},o),{code:'REQUEST_CONFLICT'});
});
test('保存失败续跑：已完成素材和脚本不重做，最终保存成功', async t => {
  const o=await setup(t), faults={failures:{save_plan:1}};
  const first=await runAgent(base,{...o,faults,maxSteps:4});
  assert.equal(first.status,'incomplete'); assert.equal(first.steps.at(-1).step_status,'failed');
  assert.equal(first.retained_results.scripts.length,1);
  const resumed=await runAgent(base,o);
  assert.equal(resumed.status,'completed');
  assert.equal(resumed.steps.filter(x=>x.tool==='generate_script').length,1);
  assert.equal(resumed.steps.filter(x=>x.tool==='search_materials').length,1);
  assert.equal(resumed.steps.filter(x=>x.tool==='save_plan').length,2);
});
test('执行上限：明确未完成并可以继续', async t => {
  const o=await setup(t), first=await runAgent(base,{...o,maxSteps:1});
  assert.equal(first.status,'incomplete'); assert.match(first.reason,/上限/);
  assert.equal((await runAgent(base,o)).status,'completed');
});
test('工具调用上限与步数上限独立生效', async t => {
  const r=await runAgent(base,{...await setup(t),maxSteps:16,maxToolCalls:2});
  assert.equal(r.status,'incomplete'); assert.equal(r.steps.length,2);
});
test('没有保存时模型不能伪报完成', async t => {
  const r=await runAgent(base,{...await setup(t),model:new SequenceModel([tool('finish',{status:'completed',reason:'声称已完成'})]),maxSteps:1});
  assert.equal(r.status,'incomplete'); assert.equal(r.steps[0].result.code,'FALSE_COMPLETION');
});
test('依赖校验：不能估算未生成脚本，不能越过估算保存', async t => {
  const o=await setup(t);
  const r=await runAgent(base,{...o,model:new SequenceModel([tool('estimate_cost',{script_id:'invented'}),tool('save_plan',{script_id:'invented'})]),maxSteps:2});
  assert.ok(r.steps.every(x=>x.result.code==='DEPENDENCY_MISSING'));
});
test('成功素材检索缓存：重复动作不增加模拟工时', async t => {
  const a=tool('search_materials',{source:'primary'});
  const r=await runAgent(base,{...await setup(t),model:new SequenceModel([a,a]),maxSteps:2});
  assert.equal(r.steps[1].cached,true); assert.equal(r.planning_minutes,2);
});
test('不信任模型参数：拒绝额外字段和未知工具', async t => {
  const r=await runAgent(base,{...await setup(t),maxSteps:2,model:new SequenceModel([
    tool('save_plan',{script_id:'x',total:0}),tool('shell',{command:'bad'})
  ])});
  assert.deepEqual(r.steps.map(x=>x.result.code),['INVALID_ARGUMENTS','UNKNOWN_TOOL']);
});
test('模型中断：保留已成功检索，不切换mock，恢复后续跑', async t => {
  const o=await setup(t); let count=0;
  const broken={meta:{provider:'broken-test',mock:false},async decide(){if(count++)throw Error('do-not-leak-secret');return tool('search_materials',{source:'primary'});}};
  const a=await runAgent(base,{...o,model:broken});
  assert.equal(a.status,'incomplete'); assert.equal(a.retained_results.materials.length,2);
  assert.ok(!JSON.stringify(a).includes('do-not-leak-secret'));
  assert.equal((await runAgent(base,o)).status,'completed');
});
test('保存前重验截止：估算后时钟变化不能绕过约束', async t => {
  const o=await setup(t); let clock=START;
  const delegate=new MockModel();
  const m={meta:delegate.meta, async decide(c){const a=await delegate.decide(c); if(a.tool==='save_plan')clock=START+48*3600000;return a;}};
  const r=await runAgent(base,{...o,now:()=>clock,model:m,maxSteps:4});
  assert.equal(r.status,'incomplete'); assert.equal(r.steps.at(-1).result.code,'CONSTRAINT_VIOLATION');
});
test('锁防止同id并行写入', async t => {
  const o=await setup(t), store=new Store(o.root,base.id); await store.lock();
  try {await assert.rejects(runAgent(base,o),{code:'RUN_LOCKED'});} finally {await store.unlock();}
});
test('已完成artifact丢失不能静默返回成功', async t => {
  const o=await setup(t);await runAgent(base,o);await rm(join(o.root,base.id,'plan.json'));
  await assert.rejects(runAgent(base,o),{code:'ARTIFACT_MISSING'});
});
test('保存后checkpoint前崩溃：从artifact恢复，不重做工具', async t => {
  const o=await setup(t);await runAgent(base,o);
  const path=join(o.root,base.id,'state.json'), s=JSON.parse(await readFile(path,'utf8'));
  s.saved_plan=null;s.status='running';await writeFile(path,JSON.stringify(s));
  const r=await runAgent(base,o);assert.equal(r.recovered,true);assert.equal(r.status,'completed');assert.equal(r.calls_this_session,0);
});
for(const budget of [-1,NaN,Infinity,'10',.001]) test(`非法预算 ${String(budget)}`,async t=>{
  await assert.rejects(runAgent({...base,budget},await setup(t)),{code:'INVALID_BUDGET'});
});
test('必须带时区，防止跨机时间歧义',async t=>{
  await assert.rejects(runAgent({...base,deadline:'2026-10-30T18:00:00'},await setup(t)),{code:'INVALID_DEADLINE'});
});
test('id禁止目录穿越',async t=>{
  await assert.rejects(runAgent({...base,id:'../escape'},await setup(t)),{code:'INVALID_ID'});
});
test('合法两位小数预算不受浮点误差影响',async t=>{
  const r=await runAgent({...base,budget:10.12},await setup(t));assert.equal(r.status,'completed');assert.equal(r.cost.total,8);
});
test('不存在的日期不自动进位',async t=>{
  await assert.rejects(runAgent({...base,deadline:'2027-02-30T18:00:00+08:00'},await setup(t)),{code:'INVALID_DEADLINE'});
});
test('完成任务在截止后重复读取仍返回同一已保存方案',async t=>{
  const o=await setup(t);await runAgent(base,o);
  const r=await runAgent(base,{...o,now:()=>START+72*3600000});assert.equal(r.status,'completed');assert.equal(r.replayed,true);
});
test('缺少预算补充后可沿用同id，但不能更改已有主题',async t=>{
  const o=await setup(t), input={...base};delete input.budget;await runAgent(input,o);
  await assert.rejects(runAgent({...base,theme:'环保活动'},o),{code:'REQUEST_CONFLICT'});
  assert.equal((await runAgent(base,o)).status,'completed');
});
test('持续脚本失败时可换规格，不丢失成功素材',async t=>{
  const r=await runAgent(base,{...await setup(t),faults:{failures:{'generate_script:premium':'always'}}});
  assert.equal(r.status,'completed');assert.equal(r.selected_variant,'standard');assert.equal(r.steps.filter(e=>e.tool==='search_materials').length,1);
});
test('估算时间与保存结果一致，保存失败同样计入耗时',async t=>{
  const o=await setup(t),r=await runAgent(base,o);
  assert.equal(r.steps.find(e=>e.tool==='estimate_cost').result.estimate.expected_finish,r.cost.last_estimate.expected_finish);
  const fail=await runAgent({...base,id:'savefail'},{...o,maxSteps:4,faults:{failures:{save_plan:1}}});assert.equal(fail.planning_minutes,9);
});
test('最终原因由执行证据构造，模型错误表述只作为未验证审计备注',async t=>{
  const r=await runAgent(base,{...await setup(t),maxSteps:1,model:new SequenceModel([tool('finish',{status:'incomplete',reason:'编造：实际三档均已估算，费用1'})])});
  assert.ok(!r.reason.includes('实际三档'));assert.match(r.reason,/尚无成功的工具估算/);
  assert.equal(r.steps[0].result.model_note_is_unverified,true);assert.match(r.steps[0].result.model_note,/编造/);
});
