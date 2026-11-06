import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { UsageStore, normalizeUsage } from '../server/usage-store.mjs';
import { callVlm } from '../server/provider.mjs';
import { Recognizer } from '../server/recognition.mjs';
import { Taxonomy } from '../server/taxonomy.mjs';
import sharp from 'sharp';

const artifacts = resolve('artifacts');
async function temporary(t) {
  await mkdir(artifacts,{recursive:true}); const dir = await mkdtemp(resolve(artifacts,'usage-'));
  t.after(async () => { assert.ok(resolve(dir).startsWith(artifacts+sep)); await rm(dir,{recursive:true,force:true}); });
  return dir;
}
const event = (overrides = {}) => ({ kind:'request', contextId:'batch-a', provider:'https://api.example.com/v1', model:'vision', stage:'primary', outcome:'ok', attempt:1, durationMs:100, usage:{ prompt_tokens:100, completion_tokens:20, total_tokens:120, prompt_tokens_details:{cached_tokens:70}, completion_tokens_details:{reasoning_tokens:10} }, ...overrides });
const config = {baseUrl:'https://api.example.com/v1',apiKey:'private-secret-test',model:'vision'};

test('usage normalization preserves unknown versus zero and keeps cached/reasoning as subsets', () => {
  assert.deepEqual(normalizeUsage(event().usage),{input:100,output:20,total:120,cached:70,reasoning:10});
  assert.deepEqual(normalizeUsage(null),{input:null,output:null,total:null,cached:null,reasoning:null});
  assert.equal(normalizeUsage({prompt_tokens:0,completion_tokens:0}).total,0);
  assert.deepEqual(normalizeUsage({input_tokens:50,output_tokens:5,input_tokens_details:{cached_tokens:30}}),{input:50,output:5,total:55,cached:30,reasoning:null});
  assert.equal(normalizeUsage({prompt_tokens:50,prompt_cache_hit_tokens:40}).cached,40);
  assert.equal(normalizeUsage({prompt_tokens:-1,completion_tokens:'20'}).input,null);
  assert.equal(normalizeUsage({prompt_tokens:20,prompt_tokens_details:{cached_tokens:30}}).cached,20);
});
test('concurrent requests persist once and restore batch/model counters without double counting subsets', async t => {
  const dir = await temporary(t), store = new UsageStore(dir);
  await Promise.all(Array.from({length:20},(_,i) => store.record(event({contextId:i%2?'batch-a':'batch-b',stage:i%2?'review':'primary',model:i%2?'reviewer':'vision'}))));
  await store.record(event({kind:'cache_hit'}));
  const summary = await store.summary();
  assert.equal(summary.requests,20); assert.equal(summary.inputTokens,2000); assert.equal(summary.outputTokens,400); assert.equal(summary.totalTokens,2400);
  assert.equal(summary.cachedInputTokens,1400); assert.equal(summary.reasoningTokens,200); assert.equal(summary.cacheHits,1); assert.equal(summary.models.length,2);
  assert.equal((await store.summary('batch-a')).requests,10); assert.equal((await store.summary('batch-a')).reviewRequests,10);
  const restored = await new UsageStore(dir).summary(); assert.equal(restored.totalTokens,2400); assert.equal(restored.cacheHits,1);
  const lines = (await readFile(resolve(dir,'requests.jsonl'),'utf8')).trim().split('\n'); assert.equal(lines.length,21);
  assert.equal(new Set(lines.map(line => JSON.parse(line).id)).size,21);
});
test('unknown usage and failed attempts are counted distinctly from zero-token requests', async t => {
  const store = new UsageStore(await temporary(t));
  await store.record(event({outcome:'transport_error',usage:null}));
  await store.record(event({outcome:'http_error',attempt:2,usage:{total_tokens:7}}));
  await store.record(event({attempt:3,usage:{prompt_tokens:0,completion_tokens:0}}));
  const s = await store.summary();
  assert.equal(s.requests,3); assert.equal(s.failedRequests,2); assert.equal(s.retryRequests,2); assert.equal(s.missingUsageRequests,2);
  assert.equal(s.inputReports,1); assert.equal(s.outputReports,1); assert.equal(s.totalTokens,7);
});
test('usage log excludes keys, prompts, photos, reference/location data and URL credentials', async t => {
  const dir = await temporary(t), store = new UsageStore(dir);
  await store.record(event({provider:'https://account:embedded-secret@example.com/key-in-path?api_key=query-secret#private',apiKey:config.apiKey,image:'private-image-bytes',messages:['private-prompt'],location:'private-location',usage:{prompt_tokens:1,completion_tokens:2,sensitive:'private-reference'}}));
  const raw = await readFile(resolve(dir,'requests.jsonl'),'utf8');
  for (const value of [config.apiKey,'embedded-secret','key-in-path','query-secret','private-image-bytes','private-prompt','private-location','private-reference']) assert.ok(!raw.includes(value));
  assert.equal(JSON.parse(raw).provider,'https://example.com');
});
test('truncated or invalid model output still accounts for returned usage before raising an error', async t => {
  const store = new UsageStore(await temporary(t));
  for (const choice of [{finish_reason:'length',message:{content:'{}'}},{finish_reason:'stop',message:{content:'not json'}}]) {
    await assert.rejects(callVlm(config,{model:'vision',messages:[],onUsage:e => store.record(e)},async () => Response.json({choices:[choice],usage:event().usage})));
  }
  const s = await store.summary(); assert.equal(s.requests,2); assert.equal(s.totalTokens,240); assert.equal(s.failedRequests,2);
});
test('transport failures and pre-dispatch cancellation do not fabricate token counts', async t => {
  const store = new UsageStore(await temporary(t));
  await assert.rejects(callVlm(config,{model:'vision',messages:[],onUsage:e => store.record(e)},async () => { throw new Error('network'); }));
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(callVlm(config,{model:'vision',messages:[],signal:aborted.signal,onUsage:e => store.record(e)},async () => { throw new Error('must not run'); }));
  const s = await store.summary(); assert.equal(s.requests,1); assert.equal(s.missingUsageRequests,1); assert.equal(s.inputReports,0);
});
test('retry records are individual attempts, including any usage returned in HTTP error responses', async t => {
  const store = new UsageStore(await temporary(t)); let calls=0;
  const valid = {subject:'bird',candidates:[],needs_review:true,confidence:0,evidence:[],missing_features:[]};
  await callVlm(config,{model:'vision',messages:[],stage:'review',onUsage:e => store.record(e)},async () => ++calls === 1 ? Response.json({usage:{prompt_tokens:10,completion_tokens:0}},{status:503}) : Response.json({choices:[{message:{content:JSON.stringify(valid)}}],usage:{prompt_tokens:20,completion_tokens:5}}));
  const s = await store.summary(); assert.equal(s.requests,2); assert.equal(s.retryRequests,1); assert.equal(s.failedRequests,1); assert.equal(s.reviewRequests,2); assert.equal(s.totalTokens,35);
  assert.equal(s.inferences,1); assert.equal(s.reviewInferences,1);
});
test('damaged/truncated lines are skipped and a newline is repaired before new appends', async t => {
  const dir = await temporary(t), store = new UsageStore(dir); await store.record(event());
  const file = resolve(dir,'requests.jsonl'); const saved = await readFile(file,'utf8');
  await appendFile(file,saved+'{"partial');
  const restored = new UsageStore(dir); const initial = await restored.summary();
  assert.equal(initial.requests,1); assert.equal(initial.corruptRecords,1);
  await restored.record(event());
  const final = await new UsageStore(dir).summary(); assert.equal(final.requests,2); assert.equal(final.corruptRecords,1);
});
test('failed disk writes retain pending records and recover on the next write', async t => {
  const dir = await temporary(t), blocked = resolve(dir,'blocked'); await writeFile(blocked,'not a directory');
  const store = new UsageStore(blocked); await store.record(event());
  const initial = await store.summary(); assert.equal(initial.requests,1); assert.equal(initial.pendingRecords,1); assert.ok(initial.storageError);
  assert.ok(resolve(blocked).startsWith(artifacts+sep)); await rm(blocked); await mkdir(blocked);
  await store.record(event()); const recovered = await store.summary(); assert.equal(recovered.pendingRecords,0);
  assert.equal((await new UsageStore(blocked).summary()).requests,2);
});
test('local recognition cache records a hit without replaying historic API usage', async t => {
  const dir = await temporary(t), store = new UsageStore(resolve(dir,'usage'));
  const taxon = {species_code:'baleag',english_name:'Bald Eagle',scientific_name:'Haliaeetus leucocephalus',category:'species'};
  const observation = {subject:'bird',candidates:[taxon],needs_review:false,confidence:.99,evidence:['white head','yellow hooked bill'],missing_features:[]};
  const provider = (c,r) => callVlm(c,r,async () => Response.json({choices:[{message:{content:JSON.stringify(observation)}}],usage:event().usage}));
  const engine = new Recognizer({catalog:new Taxonomy([taxon]),cacheDirectory:resolve(dir,'cache'),provider,onUsage:e => store.record(e)});
  const image = (await sharp({create:{width:60,height:80,channels:3,background:'#abc'}}).jpeg().toBuffer()).toString('base64');
  await engine.recognize({image},config); const cached = await engine.recognize({image},config);
  const s = await store.summary(); assert.equal(s.requests,1); assert.equal(s.totalTokens,120); assert.equal(s.cacheHits,1); assert.equal(cached.calls,0); assert.deepEqual(cached.usage,[]);
  assert.equal(s.processedImages,2); assert.equal(s.inferences,1); assert.equal(s.legacyProcessingRecords,0);
  await engine.recognize({image,force:true},config);
  const repeated = await store.summary(); assert.equal(repeated.processedImages,3); assert.equal(repeated.inferences,2); assert.equal(repeated.requests,2);
  const restored = await new UsageStore(resolve(dir,'usage')).summary(); assert.equal(restored.processedImages,3); assert.equal(restored.inferences,2);
});

test('one image with review and transport retry counts one process, two inferences and three API attempts', async t => {
  const dir = await temporary(t), store = new UsageStore(resolve(dir,'usage'));
  const taxon = {species_code:'baleag',english_name:'Bald Eagle',scientific_name:'Haliaeetus leucocephalus',category:'species'};
  const value = {subject:'bird',candidates:[taxon],needs_review:true,confidence:.6,evidence:['white head'],missing_features:['tail'],bbox:null};
  let reviewAttempts=0;
  const provider = (c,r) => callVlm(c,r,async () => r.stage === 'review' && ++reviewAttempts === 1 ? Response.json({}, {status:503}) : Response.json({choices:[{message:{content:JSON.stringify(value)}}],usage:event().usage}));
  const engine = new Recognizer({catalog:new Taxonomy([taxon]),provider,onUsage:e => store.record({...e,contextId:'batch-review'})});
  const image = (await sharp({create:{width:60,height:80,channels:3,background:'#abc'}}).jpeg().toBuffer()).toString('base64');
  const result = await engine.recognize({image},config); assert.equal(result.retry,true);
  const first = await store.summary('batch-review'); assert.equal(first.processedImages,1); assert.equal(first.inferences,2); assert.equal(first.requests,3); assert.equal(first.retryRequests,1);
  await engine.recognize({image,force:true},config);
  const repeated = await store.summary('batch-review'); assert.equal(repeated.processedImages,2); assert.equal(repeated.inferences,4); assert.equal(repeated.requests,5);
});

test('decode failures count as processing without inference, and legacy API logs do not invent image counts', async t => {
  const dir = await temporary(t), store = new UsageStore(dir);
  const engine = new Recognizer({catalog:new Taxonomy([]),onUsage:e => store.record(e)});
  await assert.rejects(engine.recognize({image:Buffer.from('not an image').toString('base64')},config));
  const failed = await store.summary(); assert.equal(failed.processedImages,1); assert.equal(failed.inferences,0); assert.equal(failed.requests,0);
  await store.record(event()); await store.record(event({stage:'review'})); await store.record(event({stage:'review',attempt:2}));
  const file = resolve(dir,'requests.jsonl');
  // Old persisted records did not have the processId field at all.
  const records = (await readFile(file,'utf8')).trim().split('\n').map(line => JSON.parse(line));
  for (const row of records) if (row.kind === 'request') delete row.processId;
  await writeFile(file,records.map(r => JSON.stringify(r)).join('\n')+'\n');
  const restored = await new UsageStore(dir).summary(); assert.equal(restored.processedImages,1); assert.equal(restored.inferences,2); assert.equal(restored.requests,3); assert.equal(restored.legacyProcessingRecords,3);
});
