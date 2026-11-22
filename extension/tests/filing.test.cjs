const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('lookup hints never supply an automatic reply or filing context',async()=>{
 const ctx=vm.createContext({URL,Headers,Blob,FormData,console,fetch:()=>{throw Error('No lookup may bind a target')}})
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../canary-shared.js'),'utf8'),ctx)
 assert.equal(await ctx.canaryShared.fetchLinkedCase(),null)
 assert.equal(await ctx.canaryShared.fetchMessageContext(),null)
})
test('opening a message discards stale unconfirmed filing context',async()=>{
 let listener;const removed=[];const ext={storage:{session:{remove:async k=>removed.push(k)}},messageDisplay:{onMessageDisplayed:{addListener:fn=>listener=fn}}}
 const ctx=vm.createContext({canaryShared:{getGecko:()=>ext,getStoredAuth:async()=>({jwt:'token',origin:'https://synthetic.example'}),resolveMessageHeaderForLookup:async()=>({}),fetchMessageContext:async()=>null}})
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../message-view-cache.js'),'utf8'),ctx)
 listener(1,{id:5});await new Promise(setImmediate)
 assert.deepEqual(removed,['canary_last_viewed_filing_context'])
})
