# BLua32 private symbols

`__blua32_symbols__` contains the private tooling graph embedded in a debug ROM.
The compiler/linker produces it; the symbol codec owns its wire
representation. Debuggers, source inspection and Hot Resume consume it. Neither
the CPU nor the cartridge linker consumes these symbols. BIOS public targets
are resolved from the ROM's executable header and published function slots;
see [Named BIOS function imports](book1/blua-programs.md#sec-blua-programs-named-bios-function-imports).

## Independent metadata consumers

The public BIOS diagnostic directory supplies the console monitor's names,
source locations and binding availability without a host debugger. Its
product interface is specified by
[BIOS diagnostic directory](book1/bios-monitor.md#sec-memory-optional-bios-diagnostic-directory).
The private tooling graph supplies the richer source and live-compilation
information used by host tools. The BIOS does not decode that graph.

`includeDiagnostics` selects the public directory and `includeSymbols` selects
the private graph independently at ROM production. The ordinary build requests
neither; `--debug` requests both in one `.debug.rom`. Neither payload requires
the other, and no separate symbols file is exported.

Both payloads occupy ordinary mapped ROM bytes. “Private” describes the tooling
format and its consumers, not a hidden address range or an access restriction.
The separation is logical within the ROM, not a second file or container.

## Shared values, not a dumped object tree

The wire representation has one string table and pools for source ranges,
inline-call chains, instruction-word interval lists and register lists. Records
refer to these pools by integer index. Function identities remain intact: their
lexical ancestry matters for live compilation. They are stored once, not
repeated at every PC, local binding and continuation.

Both decoders preserve sharing. TypeScript returns shared objects and readonly
lists; native tooling uses `shared_ptr<const T>`. The native references own their
nodes, so copying a symbol record or retaining a source range does not borrow
storage from a destroyed decoder or image. Required lists include a shared empty
list, not a null pointer. Only nullable source declarations use the null range.
These are immutable published values; live compilation builds new metadata
rather than changing a decoded range/list in place.

The PC-indexed range/inline-chain arrays stay direct lookups. Pooling runs during
symbol publication/loading, not during instruction dispatch. No guest
instructions, constants, addresses, cycles or heap accounting change.

The design follows LLVM's
[DWARF string interning](https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/llvm/lib/CodeGen/AsmPrinter/DwarfStringPool.cpp)
and [shared inline origins](https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/llvm/lib/CodeGen/AsmPrinter/DwarfCompileUnit.cpp),
without adopting DWARF's external ABI or reproducing its full format. General
compression alone would retain the repeated decoded object tree.

## Wire layout

The existing binary container carries six fields. `strings` is an array of
unique UTF-8 strings. `ranges`, `chains`, `intervals`, `registers` and `records`
are little-endian u32 sections. A list is a count followed by its items; nested
lists each carry their own count. IDs are zero-based except range IDs, where
zero means absent and the first range is one.

| Pool | Item |
| --- | --- |
| `ranges` | path string ID, start line, start column, end line, end column |
| `chains` | list of (callee function string ID, call-range ID) |
| `intervals` | list of (start word, exclusive end word) |
| `registers` | list of register indices |

Each pool deduplicates equal values as well as repeated object references.
Chain/interval/register IDs index lists, not individual words. The empty list is
an ordinary pooled value. The original `debugInlineCallSiteChainIds` still index
`debugInlineCallSiteChains`; that declared table in turn references the pool.

`records` contains these fields in order (`text` means string-table ID):

1. Image address, static-layout token low/high words.
2. Function-address list; module-function list of (path text, address);
   init-participant list of (function text, slot text, system boolean).
3. Optimization level; trace selector (0 erase, 1 emit, 2 selected channels,
   followed by a text list for selector 2); preload-module text list.
4. Function-ID text list; display-name text list; function-definition range list;
   global-name text list; system-global-name text list.
5. Static-function map as a list of (slot text, function text), ordered by slot.
6. PC range-ID list; declared inline-chain pool-ID list; PC declared-chain-ID list.
7. Statement lists per function: (word offset, range ID, chain ID).
8. Resume-point lists per function: (word offset, range ID, opcode, chain ID,
   resume identity, live-register-list ID, uses-list ID, defs-list ID).
   Resume identity is zero when absent, otherwise string ID plus one.
9. Local-slot lists per function: (argument index, name text, const boolean,
   register index, definition range ID, scope range ID, chain ID, interval ID).
   Argument index is signed i32 represented by its raw u32 bits; -1 is a local.
10. Outer-binding lists per function: declaration index, location selector
    (0 absent, 1 stack, 2 upvalue), location index if present, chain ID, interval ID.
11. Lexical-declaration list: (function text, name text, kind, const boolean,
    nullable definition range ID); upvalue-binding index lists per function.
12. Static-declaration list: (name text, definition range ID, kind), followed by
    an address for storage kinds only; static-global index list; static-binding
    lists per function: (declaration index, inline depth, interval ID).

Booleans are 0/1. Kinds and opcodes retain their existing enum values. There is
no schema version, negotiation or legacy reader: this is generated internal
data, and both producers and readers change together. Rebuild debug ROMs
after a format change. The rompacker hashes the tooling sources into
its build identity, including the codec, so old cached outputs are not reused.
