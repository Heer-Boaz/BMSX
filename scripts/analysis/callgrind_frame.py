"""Partition one Callgrind dump by caller context, without adding inclusive edges.

Collect with --separate-callers=16 (or deeper). Pass ordered NAME=REGEX scopes:
the first scope matching a symbol in the recorded chain owns that self cost.
For example: callgrind_frame.py PART 'JIT=CPU::prepareNativeBlock' 'resize=TableRecord::resize'
Use @scripts/analysis/blua_frame.scopes for the BMSX execution-owner breakdown.
For native attribution build with BMSX_NATIVE_PERF_MAP=ON, add --dump-instr=yes
to Callgrind, and save /tmp/perf-<pid>.map with the dump. Example:
  callgrind_frame.py PART --perf-map perf-123.map --rom-listing 0:0=cart.asm @scripts/analysis/blua_frame.scopes
Generate cart.asm with inspectrom.sh CART --blua32-asm from the matching ROM.
A region's first public entry identifies its source, not every instruction in
the region. JIT self rows are detail, not additional frame costs. Unmatched
costs stay visible. Inlined work belongs to the enclosing symbol.
"""

import argparse
import re
from bisect import bisect_right
from collections import Counter, defaultdict
from pathlib import Path


class PerfRanges:
    """Partition half-open perf ranges; a reused address has no unique owner."""

    def __init__(self, lines):
        events = defaultdict(list)
        for line in lines:
            start, size, name = line.rstrip().split(maxsplit=2)
            start = int(start, 16)
            events[start].append((name, 1))
            events[start + int(size, 16)].append((name, -1))
        self.starts = sorted(events)
        self.names = []
        active = Counter()
        for start in self.starts:
            for name, change in events[start]:
                active[name] += change
                if not active[name]:
                    del active[name]
            self.names.append(next(iter(active)) if len(active) == 1 else
                              "[overlapping JIT symbols]" if active else None)

    def lookup(self, address):
        index = bisect_right(self.starts, address) - 1
        return self.names[index] if index >= 0 else None


def read_costs(lines, perf_map=None, native=None):
    symbols = {"fn": {}, "ob": {}}
    obj = None
    costs = Counter()
    edge = False
    address = 0
    for line in lines:
        if line.startswith("pid:") and perf_map:
            if perf_map.name != f"perf-{line.split()[1]}.map":
                raise ValueError("use the perf-<pid>.map saved from this recording")
            with perf_map.open() as file:
                ranges = PerfRanges(file)
        elif line.startswith("events:"):
            event = line.split()[1:].index("Ir")
        elif line.startswith("positions:"):
            columns = line.split()[1:]
            positions = len(columns)
            if perf_map:
                instr = columns.index("instr")  # requires --dump-instr=yes
        elif line.startswith(("fn=", "cfn=", "ob=", "cob=")):
            kind, value = line.rstrip().split("=", 1)
            table = symbols[kind.removeprefix("c")]
            encoded = re.fullmatch(r"\((\d+)\)(?: (.*))?", value)
            if encoded:
                key, name = encoded.groups()
                if name is not None:
                    table[key] = name
                if kind in ("fn", "ob"):
                    value = table[key]
            if kind == "fn":
                current = value
            elif kind == "ob":
                obj = value
        elif line.startswith(("calls=", "jump=", "jcnd=")):
            edge = True
        elif line[:1] in "0123456789*+-":
            fields = line.split()
            if perf_map:
                position = fields[instr]
                if position != "*":
                    value = int(position, 0)
                    address = address + value if position[0] in "+-" else value
            if not edge:
                # The format omits trailing zero event columns.
                if len(fields) > positions + event:
                    count = int(fields[positions + event])
                    owner = current
                    if perf_map and obj == "???" and current.startswith("0x"):
                        # Named ELF addresses may be object-relative. Only resolve
                        # anonymous functions, using the row PC, not the fn label.
                        symbol = ranges.lookup(address)
                        if symbol:
                            native[symbol] += count
                            owner = symbol + current[len(current.split("'", 1)[0]):]
                    costs[owner] += count
            edge = False
        elif line.startswith("totals:"):
            total = int(line.split()[1 + event])
    if sum(costs.values()) != total:
        raise ValueError(f"exclusive costs sum to {sum(costs.values())}, expected {total}")
    return costs, total


class RomFunctions:
    """Function byte intervals emitted by rominspector --blua32-asm."""

    def __init__(self, listing):
        functions = []
        for line in listing:
            match = re.match(r"; function=\w+h id=(.*?) entry=([0-9a-fA-F]+)h len=(\d+) ", line)
            if match:
                name, entry, size = match.groups()
                first = int(entry, 16)
                functions.append((first, first + int(size), name))
        self.functions = sorted(functions)
        self.starts = [start for start, _, _ in self.functions]

    def entry_owner(self, pc):
        index = bisect_right(self.starts, pc) - 1
        if index >= 0:
            _, end, name = self.functions[index]
            if pc < end:
                return name


def main():
    parser = argparse.ArgumentParser(description=__doc__, fromfile_prefix_chars="@")
    parser.add_argument("part", type=argparse.FileType("r"))
    parser.add_argument("--perf-map", type=Path,
                        help="matching perf-<pid>.map; collect with --dump-instr=yes")
    parser.add_argument("--rom-listing", action="append", default=[], metavar="DOMAIN:SLOT=FILE",
                        help="identify a region entry using rominspector --blua32-asm")
    parser.add_argument("scopes", nargs="+", metavar="NAME=REGEX")
    args = parser.parse_args()
    scopes = [(name, re.compile(pattern)) for name, pattern in
              (arg.split("=", 1) for arg in args.scopes)]
    native = Counter()
    costs, total = read_costs(args.part, args.perf_map, native)
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
    listings = {}
    for listing in args.rom_listing:
        image, path = listing.split("=", 1)
        with open(path) as file:
            listings[image] = RomFunctions(file)
    for symbol, count in native.most_common(15):
        region = re.fullmatch(r"bmsx_native_region_domain(-?\d+)_slot(\d+)_pc([0-9a-fA-F]+)", symbol)
        if region:
            domain, slot, pc = region.groups()
            listing = listings.get(f"{domain}:{slot}")
            if listing and (owner := listing.entry_owner(int(pc, 16))):
                symbol += f"  [entry in {owner}]"
        print(f"{count:12,d}    JIT self: {symbol}")
    for symbol, count in unmatched.most_common(10):
        print(f"{count:12,d}    unmatched: {symbol}")


if __name__ == "__main__":
    main()
