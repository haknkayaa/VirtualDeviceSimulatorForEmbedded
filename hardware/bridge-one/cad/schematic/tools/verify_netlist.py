#!/usr/bin/env python3
"""Compare KiCad's exported netlist with design.py (independent connectivity check).

Usage: verify_netlist.py <netlist.net>   (kicadsexpr format from kicad-cli)
Fails if any design net's pin set differs from the electrical netlist.
"""

import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import design  # noqa: E402


def kicad_nets(path):
    from render import parse, tokenize, unq, head, child
    root = parse(tokenize(open(path, encoding="utf-8").read()))[0]
    nets = {}
    for net in child(root, "nets")[1:]:
        name = unq(child(net, "name")[1]).rsplit("/", 1)[-1]
        nodes = [n for n in net if head(n) == "node"]
        nets[name] = {f"{unq(child(n, 'ref')[1])}.{unq(child(n, 'pin')[1])}" for n in nodes
                      if not unq(child(n, "ref")[1]).startswith("#")}
    return nets


def design_nets():
    nets = {}
    for g in design.GROUPS:
        for p in g.parts:
            if p.ref.startswith("#"):
                continue
            for pin, net in p.nets.items():
                nets.setdefault(net, set()).add(f"{p.ref}.{pin}")
    return nets


def main():
    actual = kicad_nets(sys.argv[1])
    expected = design_nets()
    by_members = {frozenset(v): k for k, v in actual.items()}
    bad = 0
    for net, members in sorted(expected.items()):
        got = actual.get(net)
        if got != members:
            alt = by_members.get(frozenset(members))
            print(f"MISMATCH {net}: expected {sorted(members)}"
                  f"{'' if got is None else ' got ' + str(sorted(got))}{' (as ' + alt + ')' if alt else ''}")
            bad += 1
    extra = [n for n, v in actual.items() if n not in expected and len(v) > 1]
    for n in extra:
        print(f"UNEXPECTED net {n}: {sorted(actual[n])}")
        bad += 1
    print(f"design nets {len(expected)}, kicad nets {len(actual)}, mismatches {bad}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
