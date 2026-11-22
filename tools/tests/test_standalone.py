from pathlib import Path
import unittest,tempfile,subprocess,sys,hashlib,json,zipfile
ROOT=Path(__file__).resolve().parents[2]
class StandaloneBuild(unittest.TestCase):
 def test_build_is_reproducible_without_cms(self):
  with tempfile.TemporaryDirectory() as tmp:
   subprocess.run([sys.executable,str(ROOT/'tools/build_release.py'),'--output',tmp],check=True,stdout=subprocess.DEVNULL)
   version=json.loads((ROOT/'extension/manifest.json').read_text())['version']
   out=Path(tmp)/version;xpi=out/f'canary-thunderbird-{version}.xpi'
   first=xpi.read_bytes()
   subprocess.run([sys.executable,str(ROOT/'tools/build_release.py'),'--output',tmp],check=True,stdout=subprocess.DEVNULL)
   self.assertEqual(xpi.read_bytes(),first)
   feed=json.loads((out/'updates.json').read_text());update=feed['addons']['canary-file@canarylegal.co.uk']['updates'][0]
   self.assertEqual(update['update_hash'],'sha256:'+hashlib.sha256(xpi.read_bytes()).hexdigest())
   with zipfile.ZipFile(xpi) as z:
    self.assertEqual(set(z.namelist()),set(json.loads((ROOT/'extension/scripts/runtime-files.json').read_text())))
    self.assertFalse(any(n.startswith(('tests/','scripts/','linux/')) for n in z.namelist()))

   provenance=json.loads((out/'provenance.json').read_text())
   self.assertEqual(provenance['source_commit'],subprocess.check_output(['git','-C',str(ROOT),'rev-parse','HEAD'],text=True).strip())
   self.assertEqual(provenance['source_files_sha256']['manifest.json'],hashlib.sha256((ROOT/'extension/manifest.json').read_bytes()).hexdigest())
   for line in (out/'SHA256SUMS.txt').read_text().splitlines():
    digest,name=line.split('  ');self.assertEqual(digest,hashlib.sha256((out/name).read_bytes()).hexdigest())
