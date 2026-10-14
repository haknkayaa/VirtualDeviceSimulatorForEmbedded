import os
os.environ['KICAD_SYMBOL_DIR']='/usr/share/kicad/symbols'
import kicad_sch_api as ksa
from importlib.metadata import version
import kicad_sch_api.library.cache as cache
cache._global_cache = cache.SymbolLibraryCache(enable_persistence=False)
cache._global_cache.discover_libraries(['/usr/share/kicad/symbols'])
s=ksa.create_schematic('probe')
print('distribution',version('kicad-sch-api'))
for lib,ref in [('Connector:USB_C_Receptacle_USB2.0_16P','J1'),('Regulator_Linear:AMS1117-3.3','U1'),('Device:R','R1'),('Device:C','C1')]:
 c=s.components.add(lib,reference=ref,position=(50.8,50.8))
 print(ref,c.pins)
 for pin in c.pins:
  print(pin)
print('data keys',s._data.keys())
