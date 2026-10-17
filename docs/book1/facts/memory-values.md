# BLua dynamic values versus typed byte storage: bounded facts

2026-10-17. Internal extraction only, not publication approval. Read the existing `memory-storage.md` and only BM30–BM35 of `memory-boot.md` for boundaries, then the named live paired value/slot/table/heap owners, scalar CPU/Memory consumers and narrow compiler producers. No other manual chapters, architecture document, PDF, memory files, tests or source changes. Internal representation details below are evidence, not a new licensee-visible binary value ABI.

**MD01 — Language values have semantic kinds; a value is not universally a 32-bit word.** The paired runtime represents nil, false, true, numbers, strings, tables, closures, builtin functions and threads. False and true share the language type `boolean`; closures and builtin functions share `function`. Number payloads use binary64 numeric storage in both owners. This is not a promise that every value has a cartridge-addressable eight-byte slot or that runtime tag bit patterns match between implementations.

Sources: `machine/ts/machine/cpu/value.ts:8-18,44-69,149-167`; `machine/ts/machine/cpu/value_slots.ts:25-40,181-206`; `machine/cpp/machine/cpu/value.h:29-40,95-177,185-197`; native type names `machine/cpp/machine/cpu/value.cpp:9-29`.

**MD02 — Nil and booleans are not number aliases.** Nil, false, true and number zero have distinct representations in these owners. Only nil and false are false in the slot/native truth test; zero is not false. Do not teach boolean values as integer 0/1 stored in every language local.

Sources: `machine/ts/machine/cpu/value_slots.ts:157-185`; `machine/cpp/machine/cpu/value.h:151-161,189-197`.

**MD03 — Ordinary function values are not bare code-address numbers.** The ordinary runtime CALL path dispatches a closure or builtin-function value, and reports call-non-function for other kinds. A closure carries a function address internally, but copying that closure value is not the same operation as producing a numeric address. This fact does not define the compiler's separate statically linked call paths.

Sources: `machine/ts/machine/cpu/cpu.ts:2918-2939,3263-3269`; `machine/cpp/machine/cpu/cpu_dispatch.inl:490-503`; `machine/cpp/machine/cpu/cpu.cpp:3007-3012`; value distinction `machine/ts/machine/cpu/value_slots.ts:181-206`, `machine/cpp/machine/cpu/value.h:159-173,185-187`.

**MD04 — Language locals use value slots, not an implied RAM address.** A thread's retained value stack and each frame's register area are slot-based. Local initialization can copy an existing value register or place nil in it. The inspected owners assign no mapped guest-byte address to those slots. A declared local is therefore not, merely by being a local, a byte buffer usable by DMA or a device.

Sources: `toolchain/ts/lua/compiler.ts:3979-4001,4013-4019`; `machine/ts/machine/cpu/thread.ts:11-26`; `machine/ts/machine/cpu/cpu.ts:3175-3183`; `machine/cpp/machine/cpu/thread.h:15-26`; `machine/cpp/machine/cpu/cpu.cpp:3017-3035`.

**MD05 — Copying a value does not deep-copy a referenced table or closure.** MOV copies the stored value. The TS slot copy retains the same table/closure reference; native copies its encoded value referring to the same object. Thus assigning an existing table to another ordinary local aliases that table rather than cloning its entries. Reassigning one local changes that local's value; a table store changes the table object selected by its value. The same identity-preserving copy applies when a table/closure value is put in an ordinary table entry.

Sources: local copy producer `toolchain/ts/lua/compiler.ts:4013-4019`; runtime copy `machine/ts/machine/cpu/cpu.ts:2309-2311,3482-3484`, `machine/ts/machine/cpu/value_slots.ts:72-86`, `machine/cpp/machine/cpu/cpu_dispatch.inl:6-8`, `machine/cpp/machine/cpu/value.h:167-173`; table value store `machine/ts/machine/cpu/table.ts:790-805,822-852,859-863`, `machine/cpp/machine/cpu/table.cpp:411-443`.

**MD06 — Ordinary argument passing copies values, retaining references.** The ordinary closure-call frame setup copies argument values into parameter slots and fills missing parameters with nil. The table/closure reference is preserved by this copy; passing a table does not marshal its entries into byte RAM or provide an address of a caller's slot. Detailed parameter metadata, returns and upvalue lifetime are separate calling facts.

Sources: `machine/ts/machine/cpu/cpu.ts:3280-3296`; `machine/ts/machine/cpu/value_slots.ts:80-97`; `machine/cpp/machine/cpu/cpu.cpp:3030-3042`; reference encoding `machine/cpp/machine/cpu/value.h:167-173`.

**MD07 — An ordinary table constructor creates a dynamic table, not typed storage.** Its producer emits a new table and stores each field as a language value. Positional fields receive keys 1, 2, ...; identifier-key fields use their named string keys. The paired NEWT handlers create table objects, and table loads/stores preserve the stored value kind and payload/reference. A table can consequently contain numbers alongside strings, booleans, tables and functions; it has no inferred homogeneous byte element layout from that syntax.

Sources: `toolchain/ts/lua/compiler.ts:4849-4889`; `machine/ts/machine/cpu/cpu.ts:2543-2549,515-520`; `machine/cpp/machine/cpu/cpu_dispatch.inl:165-168`; `machine/cpp/machine/cpu/cpu.cpp:408-418`; value-preserving table access `machine/ts/machine/cpu/table.ts:149-180,790-805,859-863`, `machine/cpp/machine/cpu/table.cpp:393-443`.

**MD08 — Constructor key one and typed-storage index zero are different contracts.** Ordinary positional table entries start at key one. Typed byte-storage/pointer indexing instead adds `index * elementSize` with no subtraction: index zero selects the first element. An explicitly authored table key zero is not prohibited by the ordinary table owner; it is a normal numeric key, not an address or automatic first array entry. Do not simplify this to “all Lua tables reject index zero.”

Sources: constructor `toolchain/ts/lua/compiler.ts:4860-4875`; typed indexing `toolchain/ts/lua/compiler.ts:4982-5023`; ordinary key classification/storage `machine/ts/machine/cpu/table.ts:790-852,1415-1424`, `machine/cpp/machine/cpu/table.h:197-208`, `machine/cpp/machine/cpu/table.cpp:393-443`.

**MD09 — A typed pointer local is a view of its existing numeric address value.** Its annotation supplies compiler storage-type metadata; indexed/field/dereferenced accesses then emit scalar memory operations at computed byte offsets. It does not construct a table, allocate pointee bytes or convert a table reference into a buffer address. Static-storage names have a separate producer that loads the linked section address rather than the contents of a language table.

Sources: `toolchain/ts/lua/compiler.ts:3996-4001,5065-5085,4982-5023,5170-5189,5222-5245,2776-2789`.

**MD10 — Address-of is bounded, not arbitrary-local address extraction.** For an expression resolved as typed storage/view, `&` emits the computed address. Otherwise the named branch accepts string/string_id/unknown flow kinds and compiles the operand unchanged; known other flow kinds receive “& expects a string value.” No branch here materializes a byte-memory address for an ordinary table or arbitrary value slot. In particular, this is not evidence for a string-byte pointer either.

Sources: `toolchain/ts/lua/compiler.ts:5192-5205,5248-5276`.

**MD11 — All six scalar memory load kinds produce numbers.** Successful scalar CPU loads select Word, U8, U16LE, U32LE, F32LE or F64LE and write a language number to the destination slot. None reconstructs a boolean, nil, table, function or string value from a generic word. Word and U32LE read unsigned 32-bit values; U8/U16LE read unsigned 8/16-bit values; floating kinds interpret floating encodings. F32LE has four stored bytes, F64LE eight. The paired alignment masks require 4/1/2/4/4/4-byte alignment respectively. These are access-kind rules, not permission to apply all widths to every MMIO register.

Sources: `machine/ts/machine/cpu/cpu.ts:3051-3077,3080-3115`; `machine/cpp/machine/cpu/cpu_dispatch.inl:554-575,621-643`; paired kinds/alignment `machine/ts/spec/blua32/memory_access_kind.ts:1-10`, `machine/cpp/spec/blua32/memory_access_kind.h:8-24`; float decoding `machine/ts/machine/memory/memory.ts:573-588`, `machine/cpp/machine/memory/memory.cpp:463-483`; unsigned memory returns `machine/ts/common/endian.ts:1-16`, `machine/cpp/machine/memory/memory.cpp:316-317,414-415`.

**MD12 — Integer scalar stores write numeric integer bits, not the runtime value encoding.** At the CPU boundary Word/U8/U16LE/U32LE extract the source's numeric value and store its unsigned low 32/8/16/32 bits respectively. Numeric fractional parts are discarded by the integer conversion, not retained as an encoded language float. Backed main RAM uses little-endian bytes. Word is therefore not a universal “save any language value” operation. This does not change the raw-word meanings of a particular MMIO register.

Sources: `machine/ts/machine/cpu/cpu.ts:3025-3037,3130-3141`; `machine/cpp/machine/cpu/cpu_dispatch.inl:589-595,656-662`; native conversion `machine/cpp/machine/cpu/value.h:199-221`; TS backing conversion `machine/ts/machine/memory/memory.ts:379-403`; paired LE writers `machine/ts/common/endian.ts:19-28`, `machine/cpp/common/endian.h:44-53`; native backing writes `machine/cpp/machine/memory/memory.cpp:262-291`.

**MD13 — Float stores are numeric conversions, not integer-bit reinterpretation at the source value.** F32LE converts the source number to binary32 and writes those bits; F64LE writes its binary64 numeric encoding. Reading those bytes as Word/U32LE instead obtains an unsigned integer bit pattern, not the original numeric meaning. Conversely an ordinary integer-valued source written through F32LE is stored as that number's floating representation. No separate cast operator is introduced by these owners.

Sources: CPU `machine/ts/machine/cpu/cpu.ts:3039-3043,3143-3147`, `machine/cpp/machine/cpu/cpu_dispatch.inl:596-597,663-664`; conversion/bytes `machine/ts/machine/memory/memory.ts:573-588,659-671`, `machine/cpp/machine/memory/memory.cpp:463-483,553-567`; unsigned reads MD11.

**MD14 — Non-number scalar stores are not a marshalling API.** Observed paired runtime behavior, not a recommended programming pattern: numeric extraction from nil, booleans, string, table, closure, builtin-function or thread values yields NaN. Integer store conversion consequently requests zero bits; float stores request NaN. There is no preserved tag, table address, string-content copy, or closure serialization in these operations, and no “boolean true becomes one” conversion. Exact NaN payload bytes and all target/device effects are not asserted here. Newcomer examples should program numeric addresses/words and explicit numeric field values, not demonstrate this misuse as an interface.

Sources: TS numeric extraction `machine/ts/machine/cpu/value_slots.ts:128-131` and stores `machine/ts/machine/cpu/cpu.ts:3025-3044,3130-3148`; native tagged/number interpretation `machine/cpp/machine/cpu/value.h:95-149,199-221` and stores `machine/cpp/machine/cpu/cpu_dispatch.inl:589-597,656-664`; TS integer backing masks `machine/ts/machine/memory/memory.ts:379-403`, `machine/ts/common/endian.ts:19-28`.

**MD15 — Dynamic string values and static string fields are distinct from inline payload bytes.** A dynamic string carries a string identity referring to pooled text; slot copies preserve that identity. The current static `string` type instead occupies four bytes containing a constant-pool index, and its typed load emits U32LE followed by LOADKR to obtain the string value. Neither representation is an established NUL-terminated byte buffer address in guest RAM. The separate string operation extract owns character/byte APIs.

Sources: `machine/ts/machine/cpu/value.ts:22-42,62-63`; `machine/ts/machine/cpu/value_slots.ts:188-193,225-227`; `machine/ts/machine/cpu/string_pool.ts:27-55`; `machine/cpp/machine/cpu/value.h:163-165,232-234`; `machine/cpp/machine/cpu/string_pool.cpp:27-48,68-70`; static producer `toolchain/ts/lua/compiler/struct_types.ts:55`, `toolchain/ts/lua/compiler.ts:3788-3798,5187-5189`.

**MD16 — Logical heap accounting does not expose a byte-heap address.** Table creation reserves accounting bytes then creates the table object; LuaHeap tracks a count against a capacity budget and can request collection. These owners do not return a corresponding mapped RAM span for the table or the value stack. An accounting byte count is not a buffer pointer or permission to allocate from an assumed free-RAM interval. Preserve the existing BM33 withheld sub-0x80000 budget range; no common arithmetic result for that range is asserted here.

Sources: `machine/ts/machine/cpu/cpu.ts:515-520`; `machine/cpp/machine/cpu/cpu.cpp:408-418`; `machine/ts/machine/cpu/lua_heap.ts:16-23,25-59,81-83`; `machine/cpp/machine/cpu/lua_heap.h:23-43`, `machine/cpp/machine/cpu/lua_heap.cpp:11-33`.

## Derived authoring cautions

- **Derived from MD04–MD10 and MD16:** distinguish a *slot containing a table reference* from a *slot containing a numeric byte address*, then distinguish the dynamic table's key/value operations from typed byte-memory loads/stores. Do not draw one unified addressable stack/heap diagram.
- **Derived from MD11–MD15:** passing a numeric address to an explicitly typed buffer consumer is not passing an ordinary Lua table/string/function by reference. No table-to-buffer cast, automatic marshalling helper, arbitrary local address-of or hidden byte heap is established.
- **Derived from MD01, MD11–MD14:** “32-bit machine word” describes the particular memory/register interface, not every BLua local or function argument. The same bytes can be read with different scalar access kinds, but that is not a language-value type tag stored alongside every word.

No repo file changed; no tests or fixes. The bounded semantic claims above agree in the named mirrors. Deliberately different private slot encodings and the inherited budget gap are recorded separately, not flattened into a public ABI.

# Dynamic-value extraction: withheld claims and remaining boundaries

2026-10-17. Source-only, no tests/fixes. Companion facts: `/tmp/bmsx-memory-dynamic-facts.md`.

## Encoding distinction, not a public common ABI

**DG01 — Do not publish shared runtime tag numbers or a raw value-slot layout.** TS runtime `ValueTag` is sequential Nil=0, False=1, True=2, Number=3, String=4, Table=5, Closure=6, BuiltinFunction=7, Thread=8 (`machine/ts/machine/cpu/value.ts:8-18`), with separate tag/scalar/reference storage (`value_slots.ts:25-40`). Native `Value=uint64_t` uses separately encoded nonnumber tags Nil=0, False=1, True=2, String=3, Table=4, Closure=5, BuiltinFunction=6, Thread=7 plus NaN-tag construction, while numbers have encoded tag zero (`machine/cpp/machine/cpu/value.h:29-40,95-149`). Quote from TS: `Number, String, Table`; quote from native: `String = 3, Table = 4`. This is an intentional private representation difference for present extraction purposes, not evidence of inconsistent guest semantic categories. Any assertion of a common numerical runtime-tag ABI is withheld.

**DG02 — Image constant tags are a different owning format.** Paired image specs agree Nil=0, False=1, True=2, Number=3, String=4 (`machine/ts/spec/blua32/image_format.ts:48-63`; `machine/cpp/spec/blua32/image_format.h:54-69`). Those are image constant-record tags, not a declaration that all live slot/object representations use the same tags. A runtime serialization/FFI ABI is neither requested nor established.

## Inherited disagreement intentionally not reopened

**DG03 — BM33 sub-0x80000 heap-budget arithmetic remains withheld.** TS capacity is `ramByteCount - BASE_RAM_USED_SIZE` (`machine/ts/machine/cpu/lua_heap.ts:21-23`); native capacity uses size_t arithmetic with the same subtraction (`machine/cpp/machine/cpu/lua_heap.h:23,41`; `machine/cpp/machine/cpu/lua_heap.cpp:11-14`). The existing BM33 distinction is preserved; no new product-reachability or common numerical budget claim, fix, or byte-heap base is inferred.

## Explicitly unproved / out of this slice

1. Full closure capture/open-upvalue lifetime, lexical alias propagation, typed pointer metadata across calls, returns, tail calls and all static-call paths: these require the calling extract; MD05/06 establish only value/reference copy behavior in the named ordinary paths.
2. String indexing, character-versus-byte counts, formatting, concatenation and actual BIOS byte/character operations: separate root string extract. MD15 establishes representation separation only. No raw string-byte address, NUL termination, or string-to-numeric-ID conversion is assumed. The non-typed `&` producer compiles the operand unchanged (`toolchain/ts/lua/compiler.ts:5248-5276`).
3. Hardware consumer layouts/lifetimes, MMIO register widths, DMA/GTE/GEO capture-versus-live-read timing, shared-buffer reuse and complete fault/partial-write behavior: must remain with their named device/memory owners. Scalar representability does not grant permission for every target.
4. Exact NaN payload preservation between memory encodings and dynamic numbers: not needed to teach numeric-versus-object storage, and not asserted. MD14 reports NaN semantically without byte-payload guarantees.
5. Ordinary table metamethod behavior, length on holes, iteration order, allowed exotic keys, every numeric equality edge, full allocation policy and GC correctness/performance: not needed for bounded newcomer table-versus-buffer distinction. Table key zero was narrowly checked only to prevent the false claim that ordinary tables forbid it.
6. An executed source demonstration is separate evidence. No test results or verified example outputs follow from this source inspection.

No newly found semantic disagreement blocks MD01–MD16 in their stated bounds. Private runtime encoding differences are not elevated to licensee ABI.
