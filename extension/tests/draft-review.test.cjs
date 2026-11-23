const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../compose-apply.js'),'utf8');
test('reviewed HTML insertion preserves draft, embedded images and signature in a valid body',async()=>{
 const original='<html><body><p>My draft</p><img src="cid:kept"><div class="moz-signature">Signature</div></body></html>';let patch;
 const ext={compose:{getComposeDetails:async()=>({isPlainText:false,body:original,subject:'Keep',to:['keep@example.org']}),setComposeDetails:async(id,p)=>patch=p}};
 const c=vm.createContext({canaryShared:{},setTimeout,clearTimeout});vm.runInContext(code,c);await c.canaryApplyComposeBundle(ext,1,{body:'Thanks <script>',subject:'Replace',to:'other@example.org',attachments:[]},{skipTo:true,preserveSubject:true,bodyMode:'append'});
 assert.equal(patch.subject,undefined);assert.equal(patch.to,undefined);assert.match(patch.body,/<p>My draft<\/p><img src="cid:kept">/);assert(patch.body.indexOf('Thanks &lt;script&gt;')<patch.body.indexOf('moz-signature'));assert(patch.body.endsWith('</body></html>'));
});
test('unreadable draft fails before any reviewed compose mutation',async()=>{let writes=0;const c=vm.createContext({canaryShared:{},setTimeout,clearTimeout});vm.runInContext(code,c);await assert.rejects(c.canaryApplyComposeBundle({compose:{getComposeDetails:async()=>{throw Error('unreadable')},setComposeDetails:async()=>writes++}},1,{body:'New'},{bodyMode:'append',preserveSubject:true,skipTo:true}),/unreadable/);assert.equal(writes,0)});
