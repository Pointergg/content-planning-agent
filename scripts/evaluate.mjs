import { parseArgs } from 'node:util';
import { resolve, join } from 'node:path';
import { mkdtemp, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { runAgent } from '../src/agent.mjs';
import { LiveModel, MockModel } from '../src/model.mjs';
import { atomicJSON, ensureDir, readJSON } from '../src/common.mjs';

const { values } = parseArgs({options:{provider:{type:'string',default:'mock'},'output-dir':{type:'string'}}});
if (!['mock','live'].includes(values.provider)) throw Error('provider must be mock or live');
const provider=values.provider;
const out=resolve(values['output-dir'] || `examples/${provider}`);
await ensureDir(out);
// A fresh isolated root guarantees a rerun measures execution, not stale cached success.
const root=await mkdtemp(join(tmpdir(),'content-agent-eval-'));
const clock='2026-10-29T08:00:00.000Z';
const preference='评审演示偏好：素材支持时先尝试 premium 并用工具实际估算，以观察真实报价；超限再考虑 standard 或 lite。部分成功只用可用素材；没有可行方案时通过工具确认缺口后停止。';
const cases=[
  {name:'normal',expect:'completed'},
  {name:'missing-budget',expect:'needs_input'},
  {name:'missing-deadline',expect:'needs_input'},
  {name:'over-budget',expect:'completed'},
  {name:'tool-failure',expect:'completed',faults:'script-once'},
  {name:'tool-failure-persistent',expect:'completed',faults:'script-persistent'},
  {name:'no-feasible',expect:'incomplete'},
  {name:'partial',expect:'completed',faults:'partial'},
  {name:'no-materials',expect:'incomplete'},
  {name:'deadline',expect:'incomplete'},
  {name:'resume',expect:'incomplete',faults:'save-once',maxSteps:4}
];
const report={provider,model:null,generated_at:new Date().toISOString(),simulated_clock:clock,scenario_preference:preference,cases:[],notes:provider==='mock'?'规则型Mock只验证工程流程，不证明真实模型决策':'真实模型通过API选择工具；业务工具与时钟仍是本地合成模拟'};
const esc=s=>String(s??'').replaceAll('|','\\|').replaceAll('\n',' ');
async function persist(name,input,result) {
  const dir=join(out,name);await ensureDir(dir);
  await atomicJSON(join(dir,'input.json'),input);await atomicJSON(join(dir,'output.json'),result);
  await atomicJSON(join(dir,'trace.json'),result.steps);
  await writeFile(join(dir,'trace.md'),`# ${name} · ${provider}\n\n状态：${result.status}。原因：${result.reason}\n\n|步|会话|工具|参数|实际返回摘要|依据|状态|\n|---|---|---|---|---|---|---|\n`+result.steps.map(e=>{
    const {rationale,...args}=e.args||{};
    const summary=e.result?.estimate ? `费用${e.result.estimate.total}，预算缺口${e.result.estimate.budget_gap}，时间缺口${e.result.estimate.deadline_gap_minutes}分钟` : e.result?.script ? `生成 ${e.result.script.id}，规格 ${e.result.script.variant}` : e.result?.materials ? `${e.result.status}，素材 ${e.result.materials.map(x=>x.id).join(',')}` : JSON.stringify(e.result);
    return `|${e.seq}|${e.session}|${e.tool||e.kind}|${esc(JSON.stringify(args))}|${esc(summary)}|${esc(e.decision_basis)}|${e.step_status||'failed'}${e.cached?' (cached)':''}|`;
  }).join('\n')+'\n');
  if(result.saved_plan)await copyFile(join(root,input.id,'plan.json'),join(dir,'plan.json'));
  else await rm(join(dir,'plan.json'),{force:true});
}
function check(result,expected,name){
  const checks={expected_status:result.status===expected,no_false_success:result.status!=='completed'||!!result.saved_plan,budget_guard:!result.saved_plan||result.cost.total<=result.request.budget,deadline_guard:!result.saved_plan||Date.parse(result.cost.last_estimate.expected_finish)<=Date.parse(result.request.deadline),failed_steps_honest:result.steps.filter(x=>x.result?.status==='error').every(x=>x.step_status==='failed'||x.kind==='model_error')};
  if(name==='over-budget')checks.observed_12_to_8=JSON.stringify(result.steps.filter(e=>e.tool==='estimate_cost'&&e.result.estimate).map(e=>e.result.estimate.total))==='[12,8]';
  if(name.startsWith('tool-failure')){checks.failure_injected=result.steps.some(e=>e.result?.code==='INJECTED_TOOL_FAILURE');checks.materials_not_repeated=result.steps.filter(e=>e.tool==='search_materials').length===1;}
  if(name==='tool-failure-persistent')checks.changed_variant=['standard','lite'].includes(result.selected_variant);
  if(name==='partial')checks.used_partial=result.steps.some(e=>e.result?.status==='partial')&&result.selected_variant==='lite';
  return checks;
}
for(const item of cases){
  const input=await readJSON(new URL(`../examples/inputs/${item.name}.json`,import.meta.url));
  const faults=item.faults?await readJSON(new URL(`../examples/faults/${item.faults}.json`,import.meta.url)):{};
  const options={root,model:provider==='live'?new LiveModel():new MockModel(),now:()=>Date.parse(clock),faults,maxSteps:item.maxSteps||16,preference};
  console.log(`[${provider}] ${item.name} started`);
  const started=performance.now();
  const result=await runAgent(input,options);
  report.model=result.model;
  await persist(item.name,input,result);
  const checks=check(result,item.expect,item.name);
  report.cases.push({name:item.name,status:result.status,total:result.cost.total,steps:result.steps.length,model_calls:result.model_usage.calls,tokens:result.model_usage.total_tokens,wall_seconds:Number(((performance.now()-started)/1000).toFixed(2)),checks,passed:Object.values(checks).every(Boolean)});
  console.log(`[${provider}] ${item.name}: ${result.status} ${Object.values(checks).every(Boolean)?'PASS':'FAIL'}`);
  if(item.name==='normal'){
    const path=join(root,input.id,'plan.json'),before=await readFile(path,'utf8');
    const repeated=await runAgent(input,options);await persist('repeat',input,repeated);
    const repeatChecks={replayed:repeated.replayed===true,zero_new_calls:repeated.calls_this_session===0,unchanged_artifact:before===await readFile(path,'utf8'),unchanged_usage:repeated.model_usage.calls===result.model_usage.calls};
    report.cases.push({name:'repeat',status:repeated.status,checks:repeatChecks,passed:Object.values(repeatChecks).every(Boolean)});
  }
  if(item.name==='resume'){
    const resumed=await runAgent(input,{...options,maxSteps:16});await persist('resumed',input,resumed);
    const newSteps=resumed.steps.slice(result.steps.length);
    const checks={completed:resumed.status==='completed',kept_successful_scripts:result.retained_results.scripts.length>0,new_script_not_required:!newSteps.some(e=>e.tool==='generate_script'),new_search_not_required:!newSteps.some(e=>e.tool==='search_materials'),original_failure_retained:resumed.steps.some(e=>e.result?.code==='INJECTED_TOOL_FAILURE')};
    report.cases.push({name:'resumed',status:resumed.status,checks,passed:Object.values(checks).every(Boolean)});
    console.log(`[${provider}] resumed: ${resumed.status} ${Object.values(checks).every(Boolean)?'PASS':'FAIL'}`);
  }
  await atomicJSON(join(out,'summary.json'),report);
}
report.passed=report.cases.filter(c=>c.passed).length;report.total=report.cases.length;
await atomicJSON(join(out,'summary.json'),report);
console.log(JSON.stringify({provider,passed:report.passed,total:report.total,output:out}));
process.exitCode=report.passed===report.total?0:1;
