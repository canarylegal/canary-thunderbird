const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../open-handoff.js'),'utf8');
async function handoff(changes={},savedChanges={},permission=true){
 const values={origin:'https://canary.example.com:8443',state:'s'.repeat(32),code:'a'.repeat(43),...changes};
 const saved={canaryApiOrigin:'https://canary.example.com:8443',canaryPluginAuthState:'s'.repeat(32),...savedChanges};
 let status='',closed=false;
 const ext={runtime:{sendMessage:async()=>({})},storage:{local:{get:async()=>saved,set:async v=>Object.assign(saved,v)}},permissions:{contains:async p=>{assert.deepEqual(Array.from(p.origins),['https://canary.example.com/*']);return permission}}};
 vm.runInNewContext(source,{URL,location:{hash:'#'+encodeURIComponent('ext+canary:auth?'+new URLSearchParams(values))},document:{getElementById:()=>({set textContent(v){status=v}})},window:{close:()=>{closed=true}},messenger:ext});
 await new Promise(setImmediate);return {saved,status,closed};
}
test('valid handoff returns only code bound to expected state and site',async()=>{const x=await handoff();assert.equal(x.saved.canaryPluginAuthPending.code,'a'.repeat(43));assert.equal(x.saved.canary_jwt,undefined);assert(x.closed)});
for(const [name,changes,saved,permission] of [
 ['wrong state',{state:'wrong'}],['wrong site',{origin:'https://other.example.com'}],['HTTP',{origin:'http://canary.example.com'}],['wrong port',{origin:'https://canary.example.com:9443'}],['missing code',{code:''}],['bad code',{code:'<script>'}],['expired connection',{}, {canaryPluginAuthState:null}],['duplicate',{}, {canaryPluginAuthPending:{code:'existing'}}],['revoked permission',{}, {},false],
])test('reject '+name,async()=>{const x=await handoff(changes,saved,permission);assert(!x.closed);assert.match(x.status,/invalid or expired/);assert.equal(x.saved.canaryPluginAuthPending?.code,saved?.canaryPluginAuthPending?.code)});
