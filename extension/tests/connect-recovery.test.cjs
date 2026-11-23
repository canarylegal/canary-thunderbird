const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path')
const source=n=>fs.readFileSync(path.join(__dirname,'..',n),'utf8'),tick=()=>new Promise(setImmediate)
function setup(){
 const data={canaryApiOrigin:'https://canary.example.org'},opened=[];let handler,fetcher=async()=>({ok:true,json:async()=>({access_token:'synthetic-token'})})
 const ext={runtime:{onMessage:{addListener:f=>handler=f}},storage:{local:{async get(keys){return Object.fromEntries([].concat(keys).map(k=>[k,data[k]]))},async set(v){Object.assign(data,v)},async remove(keys){for(const k of [].concat(keys))delete data[k]}}},permissions:{contains:async()=>true},windows:{openDefaultBrowser:async url=>opened.push(url)}}
 const context=vm.createContext({URL,Headers,Blob,FormData,AbortController,crypto:require('node:crypto').webcrypto,console,setTimeout:f=>setImmediate(f),fetch:(...args)=>fetcher(...args),messenger:ext})
 vm.runInContext(source('canary-shared.js'),context);vm.runInContext(source('background.js'),context)
 function send(type='canary-plugin-connect'){return new Promise(resolve=>handler({type,origin:data.canaryApiOrigin},{},resolve))}
 function handoff(index=opened.length-1){const u=new URL(opened[index]);data.canaryPluginAuthPending={origin:u.origin,state:u.searchParams.get('state'),code:'a'.repeat(43)}}
 async function waitOpen(n){for(let i=0;i<30&&opened.length<n;i++)await tick();assert.equal(opened.length,n)}
 return {data,opened,send,handoff,waitOpen,context,setFetch:f=>fetcher=f}
}
test('closing browser then Connect restarts instead of locking for five minutes',async()=>{
 const s=setup(),first=s.send();await s.waitOpen(1);const second=s.send();await s.waitOpen(2)
 assert.match((await first).detail,/cancelled/);assert.notEqual(new URL(s.opened[0]).searchParams.get('state'),new URL(s.opened[1]).searchParams.get('state'))
 s.handoff();assert.equal((await second).ok,true);assert.equal(s.data.canary_jwt,'synthetic-token');assert.equal(s.data.canaryPluginAuthState,undefined)
})
test('cancel clears the waiting attempt and allows immediate reconnect',async()=>{
 const s=setup(),pending=s.send();await s.waitOpen(1);assert.equal((await s.send('canary-plugin-connect-cancel')).ok,true);assert.match((await pending).detail,/cancelled/);assert.equal(s.data.canaryPluginAuthState,undefined)
 const next=s.send();await s.waitOpen(2);s.handoff();assert.equal((await next).ok,true)
})
test('stale handoff from abandoned browser cannot authorize the fresh attempt',async()=>{
 const s=setup(),first=s.send();await s.waitOpen(1);const next=s.send();await s.waitOpen(2);await first;s.handoff(0);await tick();await tick();assert.equal(s.data.canary_jwt,undefined)
 s.handoff(1);assert.equal((await next).ok,true)
})
test('rapid repeated Connect requests leave only the newest attempt active',async()=>{
 const s=setup(),first=s.send();await s.waitOpen(1);const second=s.send(),third=s.send();await s.waitOpen(2)
 assert.equal((await first).ok,false);assert.equal((await second).ok,false);s.handoff();assert.equal((await third).ok,true)
})
test('cancel during token exchange never stores a late successful token',async()=>{
 const s=setup();let finish,started=false
 s.setFetch(async()=>{started=true;return new Promise(resolve=>finish=()=>resolve({ok:true,json:async()=>({access_token:'late-token'})}))})
 const pending=s.send();await s.waitOpen(1);s.handoff();while(!started)await tick()
 const cancelled=s.send('canary-plugin-connect-cancel');finish();await cancelled;assert.equal((await pending).ok,false);assert.equal(s.data.canary_jwt,undefined);assert.equal(s.data.canaryPluginAuthState,undefined)
})
test('lost saved state exits promptly instead of retaining the in-progress lock',async()=>{
 const s=setup(),pending=s.send();await s.waitOpen(1);delete s.data.canaryPluginAuthState
 assert.match((await pending).detail,/authorization changed/);assert.equal(s.context.__canaryPluginConnectAttempt,null)
})
