"""Offline release-contract checks; requires the original reviewed ZIP as input."""
from pathlib import Path
import hashlib,json,subprocess,sys,tempfile,zipfile
D=Path(__file__).resolve().parents[1];source=Path(sys.argv[1]).resolve();release=D/'releases/1.5.36';checks=[]
def check(name,ok):
 if not ok:raise RuntimeError(name)
 checks.append(name)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
with zipfile.ZipFile(source) as z:original={n:z.read(n) for n in z.namelist() if not n.endswith('/')}
with zipfile.ZipFile(release/'canary-thunderbird-1.5.36.xpi') as z:built={n:z.read(n) for n in z.namelist()}
check('Runtime file inventory unchanged',set(original)==set(built))
check('All non-manifest runtime bytes unchanged',all(original[n]==built[n] for n in original if n!='manifest.json'))
a=json.loads(original['manifest.json']);b=json.loads(built['manifest.json']);g=b.get('browser_specific_settings',b.get('applications'))['gecko'];url=g.pop('update_url')
check('Only manifest semantic change is update_url',a==b)
check('Stable GitHub feed URL',url=='https://github.com/canarylegal/canary-thunderbird/releases/latest/download/updates.json')
f=json.loads((release/'updates.json').read_text());u=f['addons'][g['id']]['updates'][0]
check('Feed binds correct version, hash and asset URL',u['version']==b['version']=='1.5.36' and u['update_hash']=='sha256:'+sha(release/'canary-thunderbird-1.5.36.xpi') and u['update_link']=='https://github.com/canarylegal/canary-thunderbird/releases/download/v1.5.36/canary-thunderbird-1.5.36.xpi')
check('Minimum compatibility matches manifest',u['applications']['gecko']['strict_min_version']==g['strict_min_version'])
for line in (release/'SHA256SUMS.txt').read_text().splitlines():
 digest,name=line.split('  ');check('Checksum '+name,sha(release/name)==digest)
p=json.loads((release/'provenance.json').read_text());check('Input provenance verified',sha(source)==p['input_sha256'])
with tempfile.TemporaryDirectory() as tmp:
 subprocess.run([sys.executable,str(D/'tools/prepare_release.py'),str(source),'--source-commit',p['source_commit'],'--output',tmp],check=True,stdout=subprocess.DEVNULL)
 check('Rebuild byte-for-byte reproducible',all((Path(tmp)/'1.5.36'/n).read_bytes()==(release/n).read_bytes() for n in ['canary-thunderbird-1.5.36.xpi','updates.json','provenance.json','SHA256SUMS.txt']))
check('No scheduled or CI workflows',not (D/'.github/workflows').exists())
print(json.dumps({'status':'passed','checks':checks},indent=2))
