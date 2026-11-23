const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path')
async function scenario(status){
 let queued=true,downloads=0,requeues=0;const notices=[]
 const ext={runtime:{getURL:p=>p,onMessage:{addListener(){}}},notifications:{create:n=>notices.push(n.message)}}
 const ctx=vm.createContext({messenger:ext,console:{info(){},warn(){}},setInterval:()=>1,setTimeout,clearTimeout,canaryShared:{getStoredAuth:async()=>({jwt:'synthetic',origin:'https://canary.test'}),apiRoot:o=>o+'/api',authHeaders:()=>({}),jsonAuthHeaders:()=>({}),secureFetch:async(url,opts)=>{
  if(url.endsWith('/claim')){const active=queued;queued=false;return {ok:true,status:200,json:async()=>active?{active:true,case_id:'case',file_id:'file',filename:'test.eml',open_token:'synthetic'}:{active:false}}}
  if(opts?.method==='PUT'){requeues++;queued=true;return {ok:true}}
  downloads++;if(status==='network')throw Error('offline');return {ok:false,status}
 }}})
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../pending-eml-open.js'),'utf8'),ctx)
 await new Promise(setImmediate)
 for(let i=0;i<8;i++){await ctx.canaryPollPendingEmlOpen();await new Promise(setImmediate)}
 return {ctx,notices,downloads,requeues,reopen(){queued=true}}
}
for(const status of [423,401,403,404,429,500,503,'network'])test('failed open '+status+' is not requeued or repeatedly notified',async()=>{
 const s=await scenario(status);assert.equal(s.downloads,1);assert.equal(s.requeues,0);assert.equal(s.notices.length,1)
 if(status===423)assert.match(s.notices[0],/quarantined/)
})
test('a later explicit open request is still handled after the previous failure',async()=>{
 const s=await scenario(423);s.reopen();await s.ctx.canaryPollPendingEmlOpen();assert.equal(s.notices.length,2)
})
