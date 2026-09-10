import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createWorkbench } from '../server/index.mjs';
import { DEFAULT_BRAND, validateBrand, buildGeneration } from '../server/brand.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+c0ZkAAAAASUVORK5CYII=', 'base64');
const send = (method, data) => ({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
async function fixture(t, fetchImpl = () => { throw new Error('Unexpected external request'); }) {
  const dir=mkdtempSync(join(tmpdir(),'hipaw-test-'));
  let server=createWorkbench({dataDir:dir,fetchImpl,initialKey:''});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=()=>`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
  return {dir,request:(path,options)=>fetch(url()+path,options),restart:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));server=createWorkbench({dataDir:dir,fetchImpl,initialKey:''});server.listen(0,'127.0.0.1');await once(server,'listening');}};
}
test('LoRA is optional, requires configuration when selected, and uses a compatible base',()=>{
  assert.equal(buildGeneration({prompt:'一只猫'},DEFAULT_BRAND).loras.length,0);
  assert.throws(()=>buildGeneration({prompt:'吉祥物',useMascot:true},DEFAULT_BRAND),/LoRA/);
  const brand=structuredClone(DEFAULT_BRAND);brand.mascot.loraUrl='https://example.com/mascot.safetensors';brand.mascot.trigger='hipaw';
  brand.colors=['#121212','#FAFAFA','#65BDFF'];
  const payload=buildGeneration({prompt:'做康复训练',useMascot:true,count:2,ratio:'3:4'},brand);
  assert.deepEqual(payload.loras,[{path:brand.mascot.loraUrl,scale:0.8}]);
  assert.match(payload.prompt,/hipaw/);assert.match(payload.prompt,/#65BDFF/);assert.equal(payload.num_images,2);
  brand.mascot.baseModel='SDXL';assert.throws(()=>validateBrand(brand),/基础模型|FLUX/);
});
test('brand and credentials persist, secrets are never returned or statically exposed',async t=>{
  const f=await fixture(t);
  const brand=structuredClone(DEFAULT_BRAND);brand.name='保存测试品牌';brand.style='测试画风';
  assert.equal((await f.request('/api/brand',send('PUT',brand))).status,200);
  assert.equal((await f.request('/api/credentials',send('PUT',{falKey:'secret-for-test'}))).status,200);
  await f.restart();
  const response=await (await f.request('/api/brand')).json();assert.equal(response.brand.name,brand.name);assert.equal(response.brand.version,2);assert.equal(response.falConfigured,true);
  assert.deepEqual(response.brand.colors,[]);
  assert.ok(!JSON.stringify(response).includes('secret-for-test'));
  assert.equal(statSync(join(f.dir,'credentials.json')).mode&0o777,0o600);
  assert.equal((await f.request('/data/credentials.json')).status,404);
  assert.equal((await f.request('/api/brand',{...send('PUT',brand),headers:{'Content-Type':'application/json',Origin:'https://example.com'}})).status,403);
});
test('unconfigured generation makes no paid call; bad image uploads are rejected',async t=>{
  const f=await fixture(t);
  const result=await f.request('/api/generate',send('POST',{prompt:'一只猫'}));assert.equal(result.status,503);
  assert.equal((await f.request('/api/uploads',{method:'POST',body:'<svg onload="alert(1)"/>'})).status,400);
});
test('training result configuration flows into queued generation and durable results',async t=>{
  const calls=[];
  const mock=async(url,options={})=>{
    calls.push({url,options});
    if(options.method==='POST')return Response.json({request_id:'request-test',status_url:'https://queue.fal.run/jobs/test/status',response_url:'https://queue.fal.run/jobs/test',cancel_url:'https://queue.fal.run/jobs/test/cancel'});
    if(url.endsWith('/status'))return Response.json({status:'COMPLETED'});
    return Response.json({images:[{url:'data:image/png;base64,'+png.toString('base64'),width:1,height:1}],seed:123});
  };
  const f=await fixture(t,mock);
  await f.request('/api/credentials',send('PUT',{falKey:'test-key'}));
  const brand=structuredClone(DEFAULT_BRAND);brand.mascot.loraUrl='https://example.com/mascot.safetensors';brand.mascot.trigger='hipaw';
  await f.request('/api/brand',send('PUT',brand));
  const upload=await(await f.request('/api/uploads',{method:'POST',body:png})).json();
  const submitted=await f.request('/api/generate',send('POST',{prompt:'猫咪康复',useMascot:true,references:[upload.url],taskId:'d1'}));assert.equal(submitted.status,202);
  const job=await submitted.json();const payload=JSON.parse(calls[0].options.body);
  assert.equal(calls[0].url,'https://queue.fal.run/fal-ai/flux-2/lora/edit');assert.equal(payload.loras[0].path,brand.mascot.loraUrl);assert.ok(payload.image_urls[0].startsWith('data:image/png;'));
  const result=await(await f.request('/api/jobs/'+job.id)).json();assert.equal(result.status,'success');assert.equal(result.brandVersion,2);assert.equal(result.seed,123);assert.equal(result.taskId,'d1');
  assert.deepEqual(Buffer.from(await(await f.request(result.images[0].url)).arrayBuffer()),png);
  const asset=await(await f.request('/api/assets',send('POST',{url:result.images[0].url,title:'康复图',jobId:job.id}))).json();assert.equal(asset.asset.status,'pending_review');
  await f.restart();const restored=await(await f.request('/api/jobs')).json();assert.equal(restored.jobs[0].status,'success');assert.ok(!JSON.stringify(restored).includes('test-key'));assert.equal((await(await f.request('/api/assets')).json()).assets.length,1);
  const approved=await(await f.request('/api/assets/'+asset.asset.id,send('PATCH',{status:'approved'}))).json();assert.equal(approved.asset.status,'approved');
});
test('invalid color and reference URLs cannot be persisted',()=>{
  assert.deepEqual(validateBrand(DEFAULT_BRAND).colors,[]);
  assert.doesNotMatch(buildGeneration({prompt:'一只橘猫'},DEFAULT_BRAND).prompt,/参考配色|#17302D|#E0A21A|#EEF1EC/);
  const brand=structuredClone(DEFAULT_BRAND);brand.colors[0]='red';assert.throws(()=>validateBrand(brand),/颜色/);
  brand.colors=DEFAULT_BRAND.colors;brand.logoUrl='https://outside.example/logo.png';assert.throws(()=>validateBrand(brand),/本机/);
});
test('generation keeps the brand version used at submission when the brand changes during a request',async t=>{
  const entered=Promise.withResolvers();const release=Promise.withResolvers();
  const f=await fixture(t,async()=>{
    entered.resolve();await release.promise;
    return Response.json({request_id:'snapshot-test',status_url:'https://queue.fal.run/jobs/snapshot/status',response_url:'https://queue.fal.run/jobs/snapshot',cancel_url:'https://queue.fal.run/jobs/snapshot/cancel'});
  });
  await f.request('/api/credentials',send('PUT',{falKey:'test-key'}));
  const pending=f.request('/api/generate',send('POST',{prompt:'猫咪康复'}));
  await entered.promise;
  try{
    const revised=structuredClone(DEFAULT_BRAND);revised.style='修改后的新风格';
    assert.equal((await f.request('/api/brand',send('PUT',revised))).status,200);
  }finally{release.resolve();}
  assert.equal((await pending).status,202);
  const {jobs}=await(await f.request('/api/jobs')).json();
  assert.equal(jobs[0].brandVersion,1);
  assert.equal(jobs[0].brandSnapshot.style,DEFAULT_BRAND.style);
  assert.ok(!jobs[0].effectivePrompt.includes('修改后的新风格'));
});
