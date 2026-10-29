import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveModel } from '../src/model.mjs';
const env={MODEL_API_KEY:'test-key-not-real',MODEL_NAME:'test-model',MODEL_BASE_URL:'https://example.invalid/v1'};
test('真实适配器发送工具schema并解析工具调用与usage',async()=>{
  const m=new LiveModel(env,async(url,init)=>{
    assert.equal(url,'https://example.invalid/v1/chat/completions');
    const request=JSON.parse(init.body);
    assert.equal(request.tool_choice,'required');assert.equal(request.tools.length,5);
    assert.ok(!init.body.includes(env.MODEL_API_KEY));
    return Response.json({id:'test-response',choices:[{message:{tool_calls:[{function:{name:'search_materials',arguments:JSON.stringify({source:'primary',rationale:'检索素材'})}}]}}],usage:{total_tokens:123}});
  });
  const a=await m.decide({});assert.equal(a.tool,'search_materials');assert.equal(a.usage.total_tokens,123);
});
test('HTTP错误不暴露响应体或密钥',async()=>{
  const m=new LiveModel(env,async()=>new Response('sensitive-server-error',{status:401}));
  await assert.rejects(m.decide({}),e=>e.code==='MODEL_HTTP_ERROR'&&!e.message.includes('sensitive')&&!e.message.includes(env.MODEL_API_KEY));
});
test('网络失败报告未完成所需错误码',async()=>{
  const m=new LiveModel(env,async()=>{throw Error('private');});
  await assert.rejects(m.decide({}),{code:'MODEL_UNAVAILABLE'});
});
for(const calls of [[],[{function:{name:'x',arguments:'{bad'}}],[{},{}]])test(`拒绝无效模型工具调用 ${JSON.stringify(calls)}`,async()=>{
  const m=new LiveModel(env,async()=>Response.json({choices:[{message:{tool_calls:calls}}]}));
  await assert.rejects(m.decide({}),{code:'BAD_MODEL_RESPONSE'});
});
test('拒绝明文远程模型端点与缺少密钥',()=>{
  assert.throws(()=>new LiveModel({...env,MODEL_BASE_URL:'http://remote.invalid'}),{code:'MODEL_CONFIG_ERROR'});
  assert.throws(()=>new LiveModel({...env,MODEL_API_KEY:''}),{code:'MODEL_CONFIG_ERROR'});
});
