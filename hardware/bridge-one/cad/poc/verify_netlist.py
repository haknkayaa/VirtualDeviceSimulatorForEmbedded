"""Check actual KiCad-exported topology, independently of the emitter."""
from pathlib import Path
import xml.etree.ElementTree as ET
root=ET.parse(Path(__file__).parent/'grouped.net.xml').getroot()
actual={n.attrib['name']:{(p.attrib['ref'],p.attrib['pin']) for p in n.findall('node')} for n in root.findall('./nets/net')}
expected={
 'CC1':{('J1','A5'),('R1','1')},
 'CC2':{('J1','B5'),('R2','1')},
 'DEMO_5V':{('J1',p) for p in ['A4','A9','B4','B9']}|{('C1','1'),('U1','3')},
 'DEMO_3V3':{('U1','2'),('C2','1')},
 'GND':{('J1',p) for p in ['A1','A12','B1','B12','SH']}|{('R1','2'),('R2','2'),('C1','2'),('C2','2'),('U1','1')},
}
for name,pins in expected.items():
 assert actual[name]==pins,(name,actual[name],pins)
unused={('J1',p) for p in ['A6','A7','B6','B7','A8','B8']}
other={pin for name,pins in actual.items() if name not in expected for pin in pins}
assert other==unused,other
print('PASS: all five intended nets match exact pin sets; six intentional connector NC pins; no other nets.')
