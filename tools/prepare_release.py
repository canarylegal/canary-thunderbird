"""Build a reproducible GitHub-distributed XPI from a reviewed listed ZIP. Never uploads."""
import argparse,hashlib,json,re,zipfile
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('candidate',type=Path);p.add_argument('--source-commit',required=True);p.add_argument('--repository',default='canarylegal/canary-thunderbird');p.add_argument('--output',type=Path,default=Path('releases'));a=p.parse_args()
if not re.fullmatch(r'[\w.-]+/[\w.-]+',a.repository):p.error('Expected owner/repository')
feed='https://github.com/'+a.repository+'/releases/latest/download/updates.json'
with zipfile.ZipFile(a.candidate) as z:
 entries={n:z.read(n) for n in z.namelist() if not n.endswith('/')}
manifest=json.loads(entries['manifest.json']);gecko=manifest.get('browser_specific_settings',manifest.get('applications',{}))['gecko'];version=manifest['version'];addon=gecko['id']
assert addon=='canary-file@canarylegal.co.uk'
assert re.fullmatch(r'\d+\.\d+\.\d+',version)
assert not any(n.startswith(('META-INF/','tests/','review/','scripts/','node_modules/')) or '..' in Path(n).parts or n.startswith('/') for n in entries)
gecko['update_url']=feed;entries['manifest.json']=(json.dumps(manifest,indent=2)+'\n').encode()
out=a.output/version;out.mkdir(parents=True,exist_ok=True);name='canary-thunderbird-'+version+'.xpi';target=out/name
with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for n,b in sorted(entries.items()):
  info=zipfile.ZipInfo(n,(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o644<<16;z.writestr(info,b,compresslevel=9)
digest=hashlib.sha256(target.read_bytes()).hexdigest()
updates={'addons':{addon:{'updates':[{'version':version,'update_link':'https://github.com/'+a.repository+'/releases/download/v'+version+'/'+name,'update_hash':'sha256:'+digest,'applications':{'gecko':{'strict_min_version':gecko['strict_min_version']}}}]}}}
(out/'updates.json').write_text(json.dumps(updates,indent=2)+'\n')
(out/'provenance.json').write_text(json.dumps({'version':version,'source_commit':a.source_commit,'input_sha256':hashlib.sha256(a.candidate.read_bytes()).hexdigest(),'xpi_sha256':digest,'repository':a.repository,'update_url':feed,'runtime_changes':['manifest.json: gecko.update_url'],'published':False},indent=2)+'\n')
(out/'SHA256SUMS.txt').write_text(''.join(hashlib.sha256((out/n).read_bytes()).hexdigest()+'  '+n+'\n' for n in [name,'updates.json','provenance.json']))
print(json.dumps({'xpi':str(target),'sha256':digest,'feed':feed},indent=2))
