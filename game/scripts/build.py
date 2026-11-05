#!/usr/bin/env python3
"""Bundle the already-verified runtime assets. Standard library only."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import hashlib,json,runpy
root=Path(__file__).resolve().parents[1];runpy.run_path(str(root/'scripts'/'restore-assets.py'));out=root/'dist';out.mkdir(exist_ok=True)
manifest=json.loads((root/'素材来源.json').read_text())
for item in manifest.values():
 assert hashlib.sha256((root/'assets'/item['runtime_file']).read_bytes()).hexdigest()==item['runtime_sha256']
package=out/'blue-bay-shipping-shift-1.0.0.zip'
files=[root/'index.html',root/'README.md',root/'开始试玩.txt',root/'素材来源.json',root/'qa'/'TEST-REPORT.md',root/'qa'/'PUBLISH-REPORT.md',root/'qa'/'PUBLISH-TEST-RESULTS.txt',root/'qa'/'ASSET-BUILD-RESULTS.txt',root/'ASSET-NOTICE.md',*sorted((root/'assets').glob('*.webp'))]
with ZipFile(package,'w',ZIP_DEFLATED,compresslevel=9) as z:
 for f in files:
  info=ZipInfo('blue-bay-shipping/'+f.relative_to(root).as_posix(),date_time=(2026,11,5,0,0,0));info.compress_type=ZIP_DEFLATED;info.external_attr=0o644<<16;z.writestr(info,f.read_bytes())
assert package.stat().st_size<20971520
print(json.dumps({'file':package.name,'bytes':package.stat().st_size,'sha256':hashlib.sha256(package.read_bytes()).hexdigest()},indent=2))
