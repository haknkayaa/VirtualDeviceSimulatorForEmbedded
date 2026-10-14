import json, math, pathlib, re

base = pathlib.Path(__file__).resolve().parent.parent / 'core'
tokens = re.findall(r'"(?:\\.|[^"\\])*"|[()]|[^\s()]+', (base/'bridge-one-core.kicad_sch').read_text())
it = iter(tokens)
def parse():
    out=[]
    for t in it:
        if t == ')': return out
        out.append(parse() if t == '(' else json.loads(t) if t.startswith('"') else t)
    return out
root=parse()[0]
def children(x,k): return [v for v in x if isinstance(v,list) and v and v[0]==k]
def first(x,k):
    found=children(x,k)
    return found[0] if found else None
def walk(x,k):
    if not isinstance(x,list): return
    if x and x[0]==k: yield x
    for v in x:
        if isinstance(v,list): yield from walk(v,k)
def point(x): return tuple(round(float(v),3) for v in x[1:3])
libs={x[1]:x for x in children(first(root,'lib_symbols'),'symbol')}
pins={}; names={}; nc=set(); nodes=set(); instances=[]
for x in children(root,'symbol'):
    ident=first(x,'lib_id')
    if not ident: continue
    props={p[1]:p[2] for p in children(x,'property')}
    ref=props['Reference']; instances.append(ref)
    at=first(x,'at'); ox,oy=point(at); a=math.radians(float(at[3])); c,s=math.cos(a),math.sin(a)
    for pin in walk(libs[ident[1]],'pin'):
        pat=first(pin,'at')
        if pat is None: continue
        px,py=point(pat)
        p=(round(ox+c*px-s*py,3),round(oy-s*px-c*py,3)); nodes.add(p)
        num=first(pin,'number')[1]; pins[f'{ref}:{num}']=p
        if ref.startswith('#PWR'): names.setdefault(props['Value'],[]).append(p)
for kind in ('label','global_label'):
    for x in children(root,kind):
        p=point(first(x,'at')); nodes.add(p); names.setdefault(x[1],[]).append(p)
for x in children(root,'junction'): nodes.add(point(first(x,'xy')))
for x in children(root,'no_connect'):
    p=point(first(x,'at')); nodes.add(p); nc.add(p)
wires=[]
for x in children(root,'wire'):
    a,b=children(first(x,'pts'),'xy'); a,b=point(a),point(b); nodes.update((a,b)); wires.append((a,b))
parent={p:p for p in nodes}
def find(p):
    while parent[p]!=p:
        parent[p]=parent[parent[p]]; p=parent[p]
    return p
def join(a,b): parent[find(a)]=find(b)
def on(p,a,b):
    return abs((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]))<0.0001 and min(a[0],b[0])-0.0001<=p[0]<=max(a[0],b[0])+0.0001 and min(a[1],b[1])-0.0001<=p[1]<=max(a[1],b[1])+0.0001
for a,b in wires:
    for p in nodes:
        if on(p,a,b): join(a,p)
for ps in names.values():
    for p in ps: join(ps[0],p)
groups={}
for pin,p in pins.items(): groups.setdefault(find(p),{'pins':[],'names':[]})['pins'].append(pin)
for name,ps in names.items(): groups.setdefault(find(ps[0]),{'pins':[],'names':[]})['names'].append(name)
manifest=json.loads((base/'core-net-manifest.json').read_text())
issues=[]
for name,expected in manifest['nets'].items():
    missing=[p for p in expected if p not in pins]
    if missing: issues.append({'net':name,'missing_pins':missing}); continue
    roots={find(pins[p]) for p in expected}
    if len(roots)>1: issues.append({'net':name,'split_groups':[groups[r] for r in roots]})
    actual_names={n for r in roots for n in groups[r]['names']}
    if actual_names and name not in actual_names: issues.append({'net':name,'actual_labels':sorted(actual_names)})
shorts=[v for v in groups.values() if len(v['names'])>1]
nc_bad=[p for p in manifest['no_connect_pins'] if p not in pins or pins[p] not in nc]
report={'placed_instances':len(instances),'instance_references':instances,'wire_count':len(wires),'manifest_issues':issues,'multiple_named_nets':shorts,'NC_not_at_pin':nc_bad}
(base/'connectivity-review.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
