const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../tag-apply.js'),'utf8');
const body=source.slice(source.indexOf('  async function canaryRunApplyFiledTag('),source.indexOf('  globalThis.canaryRunApplyFiledTag ='));
for(const fail of ['key','read','update',null])test('strict tag completion preserves existing tags and retries '+fail,async()=>{
 const updates=[];const ext={messages:{get:async()=>{if(fail==='read')throw Error('read');return {tags:['existing']}},update:async(id,patch)=>{updates.push(patch);if(fail==='update')throw Error('write')}}};
 const ctx=vm.createContext({normalizeMessageId:x=>x,getGecko:()=>ext,resolveOrCreateCanaryTagKey:async()=>fail==='key'?{err:'no key'}:{key:'canary'}});vm.runInContext(body+'\nglobalThis.apply=canaryRunApplyFiledTag',ctx);
 const result=await ctx.apply(1,{strict:true});assert.equal(result.ok,!fail);
 if(fail==='key'||fail==='read')assert.equal(updates.length,0);else {assert.equal(updates.length,1);assert.deepEqual(Array.from(updates[0].tags),['existing','canary']);assert.equal(updates[0].flagged,undefined)}
});
