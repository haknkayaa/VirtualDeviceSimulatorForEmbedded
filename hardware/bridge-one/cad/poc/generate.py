#!/usr/bin/env python3
"""Deterministic S-expression POC. Dependency: sexpdata==1.0.2.
Copies real library symbols; derives wire endpoints from their pin coordinates.
Only unit 1 / rotation 0 instances needed here; fail rather than guess otherwise.
"""
from pathlib import Path
from copy import deepcopy
from uuid import uuid5, NAMESPACE_URL
import json
import hashlib
import sexpdata as sx
S=sx.Symbol
OUT=Path(__file__).resolve().parent
LIB=Path('/usr/share/kicad/symbols')
def n(tag,*args): return [S(tag),*args]
def tag(x,t): return isinstance(x,list) and bool(x) and x[0]==S(t)
def first(x,t): return next(v for v in x if tag(v,t))
def uid(key): return str(uuid5(NAMESPACE_URL,'bridge-one/task-h/'+key))
def fx(size=1.27,bold=False,justify=None):
 f=n('font',n('size',size,size))
 if bold:f.append(S('bold'))
 e=n('effects',f)
 if justify:e.append(n('justify',S(justify)))
 return e
root=uid('root')
doc=n('kicad_sch',n('version',20250114),n('generator',S('bridge_one_poc')),
      n('uuid',root),n('paper','A4'),
      n('title_block',n('title','Task H - grouped schematic tooling POC'),n('rev','POC'),n('date','2026-10-14')))
embedded=n('lib_symbols'); doc.append(embedded)
libraries={}; instances={}; manifest={}; pinlog={}
def source(lib,name):
 if lib not in libraries:
  path=LIB/(lib+'.kicad_sym'); raw=path.read_bytes()
  libraries[lib]=sx.loads(raw.decode())
  manifest[str(path)]={'sha256':hashlib.sha256(raw).hexdigest()}
 src=deepcopy(next(x for x in libraries[lib] if tag(x,'symbol') and x[1]==name))
 ext=next((x for x in src if tag(x,'extends')),None)
 if ext:
  base=source(lib,ext[1]); old=base[1]; base[1]=name
  for ch in base:
   if tag(ch,'symbol'): ch[1]=name+ch[1][len(old):]
  for ch in src[2:]:
   if tag(ch,'extends'):continue
   if tag(ch,'property'):
    base[:]=[x for x in base if not(tag(x,'property') and x[1]==ch[1])]
   base.append(ch)
  return base
 return src

def part(libid,ref,value,xy,props=None):
 lib,name=libid.split(':'); definition=source(lib,name)
 if not any(tag(x,'symbol') and x[1]==libid for x in embedded):
  emb=deepcopy(definition);emb[1]=libid;embedded.append(emb)
 x,y=xy; instance=n('symbol',n('lib_id',libid),n('at',x,y,0),n('unit',1),
  n('in_bom',S('no' if ref.startswith('#') else 'yes')),n('on_board',S('yes')),n('dnp',S('no')),n('uuid',uid(ref)))
 if props is None: props=((x+5.08,y-2.54),(x+5.08,y))
 for key,val,pt in [('Reference',ref,props[0]),('Value',value,props[1])]:
  effects=fx(1.1,justify='left')
  if ref.startswith('#') and key=='Reference': effects.append(n('hide',S('yes')))
  instance.append(n('property',key,val,n('at',*pt,0),effects))
 pins={}
 for sub in definition:
  if not tag(sub,'symbol'):continue
  # unit common (0) or unit 1, normal body style only
  unit,style=map(int,sub[1].rsplit('_',2)[1:])
  if unit not in (0,1) or style not in (0,1):continue
  for p in sub:
   if tag(p,'pin'):
    num=first(p,'number')[1]; at=first(p,'at')
    pins[num]=(round(x+at[1],6),round(y-at[2],6))
    instance.append(n('pin',num,n('uuid',uid(ref+'.'+num))))
 instance.append(n('instances',n('project','grouped',n('path','/'+root,n('reference',ref),n('unit',1)))))
 doc.append(instance);instances[ref]=pins;pinlog[ref]=pins

def net(ref,num,name,delta=(7.62,0)):
 a=instances[ref][num]; b=tuple(round(c+d,6) for c,d in zip(a,delta))
 key=f'{ref}.{num}'
 doc.append(n('wire',n('pts',n('xy',*a),n('xy',*b)),n('stroke',n('width',0),n('type',S('default'))),n('uuid',uid('wire/'+key))))
 # 0-degree labels extend to the right; flip those on left-facing stubs.
 angle=180 if delta[0]<0 else 0
 doc.append(n('global_label',name,n('shape',S('passive')),n('at',*b,angle),fx(1.1,justify='left'),n('uuid',uid('label/'+key))))

def text(content,x,y,size=1.27,bold=False):
 doc.append(n('text',content,n('at',x,y,0),fx(size,bold),n('uuid',uid(content))))
def block(x1,x2,title,note):
 doc.append(n('rectangle',n('start',x1,25.4),n('end',x2,147.32),
  n('stroke',n('width',0.254),n('type',S('solid'))),n('fill',n('type',S('none'))),n('uuid',uid(title))))
 text(title,(x1+x2)/2,31.75,1.8,True)
 doc.append(n('text_box',note,n('at',x1+5.08,119.38,0),n('size',x2-x1-10.16,20.32),
  n('margins',2,2,2,2),n('stroke',n('width',0.127),n('type',S('solid'))),
  n('fill',n('type',S('none'))),fx(1.05,justify='left'),n('uuid',uid(note))))

block(15.24,139.7,'USB-C connector / CC terminations',
 'ASSUMPTION: 5 V power-only demo; no PD or data function.\nSeparate CC termination resistors shown for tooling only.\nInput protection and source-current policy are not qualified.')
block(147.32,274.32,'LDO / local capacitors (tooling example)',
 'ASSUMPTION: capacitor values and load budget need review.\nDEMO_3V3 is a named net, not a measured output.\nRevision F uses AP63203 buck; do not copy this LDO into it.')
part('Connector:USB_C_Receptacle_USB2.0_16P','J1','USB-C power-only POC',(43.18,68.58),((27.94,41.91),(27.94,44.45)))
part('Device:R','R1','5k1',(93.98,83.82))
part('Device:R','R2','5k1',(119.38,83.82))
part('Regulator_Linear:AMS1117-3.3','U1','AMS1117-3.3',(210.82,66.04),((200.66,55.88),(200.66,58.42)))
part('Device:C','C1','22u (demo)',(175.26,86.36))
part('Device:C','C2','22u (demo)',(248.92,86.36))
net('J1','A4','DEMO_5V',(12.7,0));net('J1','A5','CC1',(12.7,0));net('J1','B5','CC2',(12.7,0))
net('J1','A1','GND',(0,10.16));net('J1','SH','GND',(0,15.24))
for num in ['A6','A7','B6','B7','A8','B8']:
 doc.append(n('no_connect',n('at',*instances['J1'][num]),n('uuid',uid('nc/'+num))))
for ref,cc in [('R1','CC1'),('R2','CC2')]:
 net(ref,'1',cc,(0,-7.62));net(ref,'2','GND',(0,10.16))
net('U1','3','DEMO_5V',(-12.7,0));net('U1','2','DEMO_3V3',(12.7,0));net('U1','1','GND',(0,27.94))
for ref,rail in [('C1','DEMO_5V'),('C2','DEMO_3V3')]:
 net(ref,'1',rail,(0,-10.16));net(ref,'2','GND',(0,10.16))
for ref,xy,rail in [('#FLG01',(88.9,45.72),'DEMO_5V'),('#FLG02',(119.38,106.68),'GND')]:
 part('power:PWR_FLAG',ref,'PWR_FLAG',xy,((xy[0]-8,xy[1]-6),(xy[0]-8,xy[1]-4)))
 net(ref,'1',rail,(7.62,0))
text('TOOLING PROOF ONLY - not the Bridge One schematic',144.78,162.56,1.8,True)
doc.append(n('sheet_instances',n('path','/',n('page','1'))))
(OUT/'grouped.kicad_sch').write_text(sx.dumps(doc)+'\n')
(OUT/'pin-positions.json').write_text(json.dumps(pinlog,indent=2)+'\n')
(OUT/'library-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Generated grouped.kicad_sch: 8 real library symbols, 18 wires/global labels, 2 rectangles, 2 text boxes')
