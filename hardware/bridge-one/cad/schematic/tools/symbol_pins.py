#!/usr/bin/env python3
"""Print the pins (number, name, electrical type) of KiCad library symbols.

Usage: symbol_pins.py Library:Symbol [Library:Symbol ...]
Resolves `extends` and reads /usr/share/kicad/symbols/<Library>.kicad_sym.
"""

import re
import sys

LIB_DIR = "/usr/share/kicad/symbols"


def tokenize(text):
    return re.findall(r'"(?:\\.|[^"\\])*"|[()]|[^\s()]+', text)


def parse(tokens):
    stack = [[]]
    for tok in tokens:
        if tok == "(":
            stack.append([])
        elif tok == ")":
            node = stack.pop()
            stack[-1].append(node)
        else:
            stack[-1].append(tok.strip('"') if tok.startswith('"') else tok)
    return stack[0][0]


def symbols(lib):
    with open(f"{LIB_DIR}/{lib}.kicad_sym", encoding="utf-8") as f:
        root = parse(tokenize(f.read()))
    return {n[1]: n for n in root if isinstance(n, list) and n and n[0] == "symbol"}


def pins(sym, table):
    for node in sym:
        if isinstance(node, list) and node and node[0] == "extends":
            yield from pins(table[node[1]], table)
    for node in sym:
        if isinstance(node, list) and node and node[0] == "symbol":
            for p in node:
                if isinstance(p, list) and p and p[0] == "pin":
                    name = next(x[1] for x in p if isinstance(x, list) and x[0] == "name")
                    num = next(x[1] for x in p if isinstance(x, list) and x[0] == "number")
                    yield num, name, p[1]


def main():
    for ref in sys.argv[1:]:
        lib, name = ref.split(":", 1)
        table = symbols(lib)
        rows = sorted(set(pins(table[name], table)),
                      key=lambda r: (len(r[0]), r[0]))
        print(f"== {ref} ({len(rows)} pins)")
        print("  " + "  ".join(f"{n}:{nm}[{t[:3]}]" for n, nm, t in rows))


if __name__ == "__main__":
    main()
