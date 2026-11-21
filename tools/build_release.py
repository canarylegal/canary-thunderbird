"""Build only: no network, ATN, GitHub publication or deployment."""
from pathlib import Path
import argparse,hashlib,json,subprocess,sys,tempfile,zipfile
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--output',type=Path,default=ROOT/'dist');a=p.parse_args()
source=ROOT/'extension';files=json.loads((source/'scripts/runtime-files.json').read_text())
if len(set(files))!=len(files):raise ValueError('Duplicate runtime path')
for name in files:
 if Path(name).is_absolute() or '..' in Path(name).parts or not (source/name).is_file():raise ValueError('Invalid runtime path: '+name)
commit=subprocess.check_output(['git','-C',str(ROOT),'rev-parse','HEAD'],text=True).strip()
with tempfile.TemporaryDirectory(prefix='canary-build-') as tmp:
 candidate=Path(tmp)/'candidate.zip'
 with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED) as z:
  for name in sorted(files):
   data=(source/name).read_bytes()
   if name=='manifest.json':
    m=json.loads(data);m['applications']['gecko'].pop('update_url',None);data=(json.dumps(m,indent=2)+'\n').encode()
   info=zipfile.ZipInfo(name,(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o644<<16;z.writestr(info,data,compresslevel=9)
 subprocess.run([sys.executable,str(ROOT/'tools/prepare_release.py'),str(candidate),'--source-commit',commit,'--output',str(a.output.resolve())],check=True)

# Preserve source traceability even for an intentionally uncommitted local build.
version=json.loads((source/'manifest.json').read_text())['version'];out=a.output.resolve()/version
provenance=json.loads((out/'provenance.json').read_text())
provenance['source_dirty']=bool(subprocess.check_output(['git','-C',str(ROOT),'status','--porcelain'],text=True).strip())
provenance['source_files_sha256']={n:hashlib.sha256((source/n).read_bytes()).hexdigest() for n in sorted(files)}
(out/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
(out/'SHA256SUMS.txt').write_text(''.join(hashlib.sha256((out/n).read_bytes()).hexdigest()+'  '+n+'\n' for n in ['canary-thunderbird-'+version+'.xpi','updates.json','provenance.json']))
