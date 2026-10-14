"""Explicit Task H requested checks. Run from repository root."""
from pathlib import Path
import subprocess
import shutil
import os
out=Path('cad/poc')
env=dict(os.environ,KICAD10_SYMBOL_DIR='/usr/share/kicad/symbols')
shutil.copyfile(out/'grouped.kicad_sch',out/'grouped-source.kicad_sch')
commands=[
 ['/usr/bin/kicad-cli','version'],
 ['/usr/bin/kicad-cli','sch','upgrade','--force',str(out/'grouped.kicad_sch')],
 ['/usr/bin/kicad-cli','sch','erc','--severity-all','--exit-code-violations','-o',str(out/'erc.rpt'),str(out/'grouped.kicad_sch')],
 ['/usr/bin/kicad-cli','sch','export','pdf','-o',str(out/'grouped.pdf'),str(out/'grouped.kicad_sch')],
 ['/usr/bin/kicad-cli','sch','export','netlist','--format','kicadxml','-o',str(out/'grouped.net.xml'),str(out/'grouped.kicad_sch')],
]
log=[]
failed=False
for cmd in commands:
 p=subprocess.run(cmd,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 failed = failed or p.returncode != 0
 log += ['$ '+' '.join(cmd),p.stdout.rstrip(),f'[exit {p.returncode}]','']
text='\n'.join(log)
(out/'validation.log').write_text(text)
print(text)
raise SystemExit(1 if failed else 0)
