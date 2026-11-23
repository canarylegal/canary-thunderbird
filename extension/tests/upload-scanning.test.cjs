const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path')
const source=fs.readFileSync(path.join(__dirname,'../canary-shared.js'),'utf8')
const body=source.slice(source.indexOf('  async function fileTbMessageById('),source.indexOf('  function isPopoutWindow('))
test('pending email is not cached or tagged as filed',async()=>{
 const context=vm.createContext({resolveMessageHeaderForLookup:async()=>({id:1,subject:'synthetic',headerMessageId:'id@example.com'}),normalizeTbMessageId:x=>x,rawToBlob:x=>new Blob([x]),sanitizeFilename:x=>x,resolveImapRefs:async()=>({}),uploadCaseFile:async()=>({id:'file',scan_state:'pending'}),recordFiledTbMessage:()=>{throw Error('Must not record pending filing')},applyFiledTagForMessage:()=>{throw Error('Must not tag pending filing')},Blob})
 vm.runInContext(body+'\nglobalThis.file=fileTbMessageById',context)
 const result=await context.file({messages:{getRaw:async()=> 'mail'}},'token','https://synthetic.example','case',1,{})
 assert.equal(result.scanState,'pending');assert.equal(result.fileId,'file')
})
