#!/usr/bin/env python3
"""Task H: two annotated blocks, real system-library symbols, no PCB changes.
Run with .venv/bin/python generate.py from any directory.
This is a power-only 5 V illustrative circuit, not revision F power capture.
"""
from pathlib import Path
import os
import uuid
import re
import json
from importlib.metadata import version
os.environ['KICAD_SYMBOL_DIR'] = '/usr/share/kicad/symbols'
import kicad_sch_api as ksa
import kicad_sch_api.library.cache as cache

OUT = Path(__file__).resolve().parent
# 0.5.6 otherwise writes under ~/.cache. Explicitly disable persistence here.
# This private singleton assignment is isolated to this pinned-version adapter.
cache._global_cache = cache.SymbolLibraryCache(enable_persistence=False)
cache._global_cache.discover_libraries(['/usr/share/kicad/symbols'])
sch = ksa.create_schematic('Task H - grouped schematic tooling POC')

def part(lib, ref, value, xy):
    return sch.components.add(lib_id=lib, reference=ref, value=value, position=xy)

def pin(ref, number):
    p = sch.get_component_pin_position(ref, number)
    if p is None:
        raise ValueError(f'Missing pin {ref}.{number}')
    return (round(p.x, 6), round(p.y, 6))

def net(ref, number, name, delta=(7.62, 0)):
    a = pin(ref, number)
    b = (round(a[0]+delta[0],6), round(a[1]+delta[1],6))
    sch.wires.add(start=a, end=b)
    sch.add_global_label(name, position=b, shape='passive')

def block(x1, x2, title, note):
    sch.add_rectangle((x1, 25.4), (x2, 147.32), stroke_width=0.254)
    sch.add_text(title, ((x1+x2)/2, 31.75), size=1.8, bold=True)
    sch.add_text_box(note, (x1+5.08, 119.38), (x2-x1-10.16, 20.32),
                     font_size=1.05, stroke_width=0.127,
                     margins=(2,2,2,2))

block(15.24, 139.7, 'USB-C connector / CC terminations',
      'ASSUMPTION: 5 V power-only demo; no PD or data function.\n'
      'R1/R2 values illustrate separate CC terminations.\n'
      'No input protection or source-current policy is qualified here.')
block(147.32, 274.32, 'LDO / local capacitors (tooling example)',
      'ASSUMPTION: capacitor values and load budget need review.\n'
      'DEMO_3V3 is a named net, not a measured output.\n'
      'Revision F uses AP63203 buck; do not copy this LDO into it.')
part('Connector:USB_C_Receptacle_USB2.0_16P','J1','USB-C (power-only POC)',(43.18,68.58))
part('Device:R','R1','5k1',(93.98,83.82))
part('Device:R','R2','5k1',(119.38,83.82))
part('Regulator_Linear:AMS1117-3.3','U1','AMS1117-3.3',(210.82,66.04))
part('Device:C','C1','22u (demo)',(175.26,86.36))
part('Device:C','C2','22u (demo)',(248.92,86.36))
# Stacked connector power pins share the exact library coordinate; one stub each.
net('J1','A4','DEMO_5V',(12.7,0))
net('J1','A5','CC1',(12.7,0))
net('J1','B5','CC2',(12.7,0))
net('J1','A1','GND',(0,10.16))
net('J1','SH','GND',(0,15.24))
for n in ['A6','A7','B6','B7','A8','B8']:
    sch.no_connects.add(position=pin('J1', n))
for ref, cc in [('R1','CC1'),('R2','CC2')]:
    net(ref,'1',cc,(0,-7.62))
    net(ref,'2','GND',(0,10.16))
net('U1','3','DEMO_5V',(-12.7,0))
net('U1','2','DEMO_3V3',(12.7,0))
net('U1','1','GND',(0,27.94))
for ref, rail in [('C1','DEMO_5V'),('C2','DEMO_3V3')]:
    net(ref,'1',rail,(0,-10.16))
    net(ref,'2','GND',(0,10.16))
# Flags declare external input/return supply to ERC; they are not protection parts.
for ref, xy, rail in [('#FLG01',(83.82,45.72),'DEMO_5V'),
                       ('#FLG02',(119.38,106.68),'GND')]:
    part('power:PWR_FLAG',ref,'PWR_FLAG',xy)
    net(ref,'1',rail,(7.62,0))
sch.add_text('TOOLING PROOF ONLY - not the Bridge One schematic', (144.78,162.56), size=1.8,bold=True)
sch.save(str(OUT/'api-trial.kicad_sch'))
# Stable UUIDs, including references to them: regenerated POC diffs remain readable.
p = OUT/'api-trial.kicad_sch'
s = p.read_text()
mapping = {}
pattern = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
def stable(m):
    old = m.group()
    if old not in mapping:
        mapping[old] = str(uuid.uuid5(uuid.NAMESPACE_URL, f'bridge-one-task-h/{len(mapping)}'))
    return mapping[old]
p.write_text(re.sub(pattern, stable, s))
(OUT/'api-trial-pin-positions.json').write_text(json.dumps({
    c.reference: {p.number: pin(c.reference,p.number) for p in c.pins}
    for c in sch.components}, indent=2)+'\n')
print(f'kicad-sch-api distribution {version("kicad-sch-api")}')
print(f'Generated {p.name}: {len(sch.components)} symbols; two rectangles and two note text boxes')
