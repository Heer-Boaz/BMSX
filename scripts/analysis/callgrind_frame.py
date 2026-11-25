"""Partition one Callgrind dump by caller context, without adding inclusive edges.

Collect with --separate-callers=16 (or deeper). Pass ordered NAME=REGEX scopes:
the first scope matching a symbol in the recorded chain owns that self cost.
For example: callgrind_frame.py PART 'JIT=CPU::prepareNativeBlock' 'resize=TableRecord::resize'
Use @scripts/analysis/blua_frame.scopes for the BMSX execution-owner breakdown.
Unmatched costs stay visible. Inlined work belongs to the enclosing symbol.
"""

import argparse
import re
from collections import Counter


def read_costs(lines):
    symbols = {}
    costs = Counter()
    edge = False
    for line in lines:
        if line.startswith("events:"):
            event = line.split()[1:].index("Ir")
        elif line.startswith("positions:"):
            positions = len(line.split()) - 1
        elif line.startswith(("fn=", "cfn=")):
            kind, value = line.rstrip().split("=", 1)
            encoded = re.fullmatch(r"\((\d+)\)(?: (.*))?", value)
            if encoded:
                key, name = encoded.groups()
                if name is not None:
                    symbols[key] = name
                if kind == "fn":
                    value = symbols[key]
            if kind == "fn":
                current = value
        elif line.startswith(("calls=", "jump=", "jcnd=")):
            edge = True
        elif line[:1] in "0123456789*+-":
            if not edge:
                fields = line.split()
                # The format omits trailing zero event columns.
                if len(fields) > positions + event:
                    costs[current] += int(fields[positions + event])
            edge = False
        elif line.startswith("totals:"):
            total = int(line.split()[1 + event])
    if sum(costs.values()) != total:
        raise ValueError(f"exclusive costs sum to {sum(costs.values())}, expected {total}")
    return costs, total


def main():
    parser = argparse.ArgumentParser(description=__doc__, fromfile_prefix_chars="@")
    parser.add_argument("part", type=argparse.FileType("r"))
    parser.add_argument("scopes", nargs="+", metavar="NAME=REGEX")
    args = parser.parse_args()
    scopes = [(name, re.compile(pattern)) for name, pattern in
              (arg.split("=", 1) for arg in args.scopes)]
    costs, total = read_costs(args.part)
    groups = Counter()
    unmatched = Counter()
    for context, count in costs.items():
        for name, pattern in scopes:
            if pattern.search(context):
                groups[name] += count
                break
        else:
            unmatched[context.partition("'")[0]] += count
    for group, count in groups.most_common():
        print(f"{count:12,d}  {group}")
    print(f"{sum(unmatched.values()):12,d}  unmatched")
    print(f"{total:12,d}  total Ir")
    for symbol, count in unmatched.most_common(10):
        print(f"{count:12,d}    unmatched: {symbol}")


if __name__ == "__main__":
    main()
