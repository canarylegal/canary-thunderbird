const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path')
function setup(){
 let granted=true,requests=0,removed;const origin='https://canary.example.org'
 const ext={storage:{local:{get:async()=>({canaryApiOrigin:origin})}},permissions:{contains:async()=>granted,request:()=>{requests++;return new Promise(()=>{})},onRemoved:{addListener:f=>removed=f}}}
 const context=vm.createContext({URL,Headers,AbortController,setTimeout,clearTimeout,messenger:ext,fetch:async()=>({ok:true,status:200,text:async()=>'{"status":"ok"}'})})
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../canary-shared.js'),'utf8'),context)
 return {sh:context.canaryShared,ext,origin,context,requests:()=>requests,revoke(){granted=false;removed()}}
}
test('already-granted site bypasses a redundant permission request that never resolves',async()=>{
 const s=setup();assert.equal(await s.sh.primeSitePermission(s.ext,s.origin),true);assert.equal(await s.sh.requestSitePermission(s.ext,s.origin),s.origin);assert.equal(s.requests(),0)
 assert.equal((await s.sh.checkSiteHealth(s.origin)).status,200)
})
test('permission revocation removes the cached grant and cancelled prompt does not hang',async()=>{
 const s=setup();await s.sh.primeSitePermission(s.ext,s.origin);s.revoke();const controller=new AbortController();const p=s.sh.requestSitePermission(s.ext,s.origin,controller.signal);assert.equal(s.requests(),1);controller.abort();await assert.rejects(p,/cancelled/)
})
test('each stalled setup stage reports its own bounded timeout',async()=>{
 const s=setup();for(const label of ['Reading Thunderbird settings','Saving Thunderbird settings','Thunderbird permission'])await assert.rejects(s.sh.connectionStep(new Promise(()=>{}),label,null,5),new RegExp(label+' timed out'))
})
for(const stage of ['request','body'])test('stalled health '+stage+' times out and aborts transport',async()=>{
 const s=setup();let signal
 s.context.fetch=async(url,opts)=>{signal=opts.signal;if(stage==='request')return new Promise(()=>{});return {ok:true,status:200,text:()=>new Promise(()=>{})}}
 await assert.rejects(s.sh.checkSiteHealth(s.origin,null,5),/Contacting Canary.*timed out/);assert.equal(signal.aborted,true)
})
test('cancel interrupts a health check and a fresh retry succeeds',async()=>{
 const s=setup();let signal; s.context.fetch=async(url,opts)=>{signal=opts.signal;return new Promise(()=>{})}
 const controller=new AbortController(),p=s.sh.checkSiteHealth(s.origin,controller.signal)
 await new Promise(setImmediate);controller.abort();await assert.rejects(p,/cancelled/);assert.equal(signal.aborted,true)
 s.context.fetch=async()=>({ok:true,status:200,text:async()=>'{"status":"ok"}'});assert.equal((await s.sh.checkSiteHealth(s.origin)).status,200)
})
