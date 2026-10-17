# BLua typed static storage and byte-addressed views: bounded facts

2026-10-17. Internal authoring input only; **not public prose or publication approval**. Scope: the actual syntax/layout/static-storage emitters and their directly named address/access helpers, narrow paired scalar CPU/spec consumption, and existing BIOS precedents. Read `docs/book1/facts/memory-boot.md`, `memory-lifecycle.md`, their source review and the paragraph worklist for boundary/gap discovery; the claims below cite live producers, not those notes as hardware authority. No architecture document, PDF, foreign hardware facts, invented example, compiler/runtime/BIOS/cartlib change or test run. `memory_access_syntax.ts` is under `toolchain/ts/lua/`, not its `compiler/` subdirectory.

Source acceptance: [memory foundations review](../reviews/memory-foundations-source.md).

## Declaration, layout and initializer producer

**BS01 — Authored declaration spelling.** The parser accepts `bss name: type` with no initializer expression in this declaration, and `data name: type = expression` / `rodata name: type = expression` with required `=` and an expression. The authored keywords have **no leading dot**. The static-storage collector classifies those three declarations separately; its named scan walks the chunk's immediate statement body. Do not turn that collector detail alone into a claim about all allowed nested declaration scopes.

Sources: `toolchain/ts/lua/syntax/parser.ts:437-459,494-542`; `toolchain/ts/lua/compiler/passes/static_storage.ts:12-54`.

**BS02 — Struct/type/pointer syntax.** A struct declaration has the form `struct name`, named `field: type` entries, then `end`; the parser accepts optional commas/semicolons after fields. Type references are a type name followed by zero or more bracketed dimensions, including an empty `[]` syntactically. A local pointer annotation comes after the local's optional attribute and has the form `: *type`. The parser spelling for size and offset queries is `sizeof(type)` and `offsetof(Struct.field[.field...])`; the latter is a dotted field path, not array-index syntax.

Sources: `toolchain/ts/lua/syntax/parser.ts:465-491,613-644,669-675,1356-1386,1429-1442`.

**BS03 — Primitive storage layouts.** The current owning type table specifies these byte sizes, byte alignments and access representations. An `i` name below does not select a separate signed-memory access kind in this table; do not import C sign-extension rules or a signed typed-pointer ABI from the names.

| Storage type | Size | Alignment | Selected scalar access |
|---|---:|---:|---|
| `u8`, `i8` | 1 | 1 | U8 |
| `u16`, `i16` | 2 | 2 | U16LE |
| `u32`, `i32`, `addr` | 4 | 4 | U32LE |
| `word` | 4 | 4 | Word |
| `f32` | 4 | 4 | F32LE |
| `f64` | 8 | **4** | F64LE |
| `string` | 4 | 4 | constant-pool reference |

Source: `toolchain/ts/lua/compiler/struct_types.ts:9-13,44-56`.

**BS04 — Arrays, dimensions and inference.** A resolved array's size is base element size multiplied by every dimension; its alignment is the base element alignment. Indexing removes the outer dimension. Explicit dimensions must be positive compile-time integers. Only the outer dimension of initialized DATA/RODATA may be inferred: its initializer must be a table with at least one field, whose field count supplies the inferred outer length. This type owner does not admit inferred BSS length.

Source: `toolchain/ts/lua/compiler/struct_types.ts:58-69,83-104,107-125`.

**BS05 — Struct field placement and trailing padding.** Fields are laid out in declaration order. Each field begins at the next offset aligned to that field type; the running extent then advances by the field's size. Struct alignment is the largest field alignment; final struct size is rounded up to that alignment. Duplicate field names and recursive struct layout are rejected by this owner. These are storage-layout rules, not a packed register ABI.

Source: `toolchain/ts/lua/compiler/struct_types.ts:146-168`.

**BS06 — Size/offset query results.** `sizeof(type)` produces the resolved type's total byte size, including its dimensions/struct padding. `offsetof` accumulates the byte offsets of its named fields, descending only through struct-typed fields. The compiler can use either as a compile-time number or emit its numeric constant. No physical guest stack frame or local-slot address is obtained by these queries.

Sources: `toolchain/ts/lua/compiler/struct_types.ts:128-143`; `toolchain/ts/lua/compiler.ts:3322-3326,4741-4747`; total size definition in BS04/05.

**BS07 — Array initializer shape is exact.** DATA/RODATA arrays require positional table initializers. Their entries are encoded in order at `elementIndex * elementType.size`, starting at element index zero in the emitted bytes. The number of entries must equal the outer dimension, and nested arrays recurse through the same encoder. This is static byte encoding, not construction of an ordinary runtime Lua table.

Source: `toolchain/ts/lua/compiler.ts:3729-3755`.

**BS08 — Struct initializer shape is exact.** DATA/RODATA structs require named-field table initializers. Each named value is recursively written at its resolved field offset; unknown fields, repeated names, non-identifier keys and missing declared fields are rejected. The initial byte buffer is zero-created before these writes, including bytes not occupied by a field, such as layout padding. This is the emitted initializer's padding, not a promise about all RAM at cartridge entry.

Source: `toolchain/ts/lua/compiler.ts:3729-3733,3757-3783`.

**BS09 — Current numeric initializer support.** A primitive DATA/RODATA numeric initializer must evaluate to a compile-time integer. U8 writes its low eight bits; U16LE uses the central LE16 writer; U32LE and Word use the central LE32 writer. Other memory kinds are rejected in this initializer encoder: in particular an `f32`/`f64` declaration's availability in the layout table does **not** mean initialized floating storage is accepted by this producer. This is a build-time initializer restriction, not rejection of later F32LE/F64LE CPU accesses.

Source: `toolchain/ts/lua/compiler.ts:3800-3817`.

**BS10 — Static `string` is not inline character bytes.** A static string initializer is allowed only in RODATA and must be a compile-time string. The encoder writes a four-byte constant index and records a RODATA constant relocation. Loading that field emits a U32LE memory read followed by `LOADKR`, whereas ordinary memory scalar fields directly load using their memory kind. This claim stops at these emitter representations: it does not define a string's byte-address ABI or permit passing that four-byte string field as texture/PCM/geometry payload bytes.

Sources: `toolchain/ts/lua/compiler.ts:3788-3798,5181-5189`; layout `toolchain/ts/lua/compiler/struct_types.ts:55`.

**BS11 — Static section storage and alignment.** Each named BSS/DATA/RODATA binding records a section byte offset, its type byte count and alignment. The compiler aligns each binding start to its type alignment and rounds the section extent after it to four bytes. DATA/RODATA retain emitted bytes; the BSS section retains a byte count and symbol records, not initializer payload bytes. A BSS declaration itself only records that binding; it does not emit a local temporary buffer allocation at that statement.

Source: `toolchain/ts/lua/compiler.ts:609-683,699-728,753-755,3701-3708`.

**BS12 — Initialization edge and ownership.** The emitted section-initializer function copies its complete padded DATA from linked load address to linked run address word by word, then zeros its complete padded BSS word by word. Generated startup calls that function before static module initialization and entry. Consequently the declarations' initial contents come from generated startup execution, not from lexical access, a typed pointer annotation or a special zero-on-read memory region. No persistence across repeating startup follows.

Source: `toolchain/ts/lua/compiler.ts:1505-1584`; padded extents `609-626,630-652`.

## Addresses, views, indexing and CPU boundary

**BS13 — Storage names denote linked section addresses.** An expression loading a BSS/DATA/RODATA identifier emits the corresponding address relocation rather than a load of its first scalar. Those relocations resolve to the proper section base plus symbol byte offset plus addend. System DATA begins at `DYNAMIC_RAM_BASE`; its BSS follows its DATA; cartridge DATA begins at the imported `cartridgeStaticRamBase`, with cartridge BSS after its DATA. These are linked image-section allocations, not function-local byte buffers or a guessed free-RAM address. This sheet does not freeze a numerical cartridge base or all available/free RAM.

Sources: `toolchain/ts/lua/compiler.ts:2776-2789,3177-3194`; `toolchain/ts/rompack/blua32_linker.ts:350-369,1099-1154`.

**BS14 — A typed local is an address view, not pointee allocation.** A local pointer annotation attaches its resolved storage type to the binding's `structView`. Address resolution uses that local's existing value register (or a loaded captured binding) as the base address. The annotation path allocates no BSS/DATA payload for the pointee. `<const>` rejects reassignment of the local binding; it does not prohibit writes through that pointer: the BIOS's `local target<const>: *word = words` is immediately followed by indexed target stores.

Sources: `toolchain/ts/lua/compiler.ts:3996-4001,5065-5085,4096-4106`; actual precedent `machine/bios/gpu/gpu.lua:160-165`.

**BS15 — Typed indexing is zero-offset, element-scaled indexing.** Typed storage/pointer indexing calculates byte displacement as `index * elementType.size`, with **no minus one**. A constant index is folded into the byte offset; a nonconstant index emits multiply by stride (unless stride is one) then address add. Selecting an array dimension removes that outer dimension; a scalar/struct pointer's index selects one pointee-sized element. This method emits no array-length bounds comparison. Ordinary table constructor array fields are a separate producer beginning at table key **one**, so the two indexing conventions must not be conflated.

Sources: `toolchain/ts/lua/compiler.ts:4982-5023,4860-4875`; dimension consumption `toolchain/ts/lua/compiler/struct_types.ts:67-69`.

**BS16 — Typed fields and dereference.** A field selection adds the resolved field offset to its base byte address and retains the field's type. Unary `*` is parsed as dereference. For a typed storage/view it selects the pointee rather than making an ordinary table access; scalar reads use the type's selected memory kind and scalar writes become memory targets. A whole struct/array range is not a scalar load/assignment: the emitter directs the author to select scalar fields or use `&` for its address. Untyped dereference that cannot resolve such a view is rejected by these compiler paths.

Sources: `toolchain/ts/lua/syntax/parser.ts:1078-1081`; `toolchain/ts/lua/compiler.ts:1673-1687,5105-5119,5170-5189,4057-4087,5308-5322`.

**BS17 — Address-of for typed storage/view expressions.** For an operand resolved as a typed storage/view address, unary `&` produces its base address plus accumulated byte offset, using a move or address add rather than a memory load or data copy. Thus an element/field address can be passed without first loading that scalar. The actual BIOS spells this `local entry<const>: *monitor_command = &command_registry[command]`. This claim is explicitly about the typed-address branch; `&` also has a separate string-related language branch not defined by this sheet. It is not a general promise that `&` exposes the physical address of an arbitrary language local/value slot.

Sources: `toolchain/ts/lua/syntax/parser.ts:1053-1056`; `toolchain/ts/lua/compiler.ts:5248-5252,5192-5205`; actual precedent `machine/bios/shell/commands.lua:525-526`.

**BS18 — Raw address arithmetic and explicit memory maps.** General `+`/`-` emit ordinary ADD/SUB on their two operands; their emitter does not scale an increment by a typed pointee's size. Element scaling belongs to BS15's indexed-address producer. Explicit reserved memory-map indexing (`mem`, `mem8`, `mem16le`, `mem32le`, `memf32le`, `memf64le`) classifies the subscript itself as the address expression; the name selects Word, U8, U16LE, U32LE, F32LE or F64LE respectively. Its address compiler passes that expression as a constant, base plus literal byte offset, or computed address, not an element index. This does not establish that a chosen MMIO port permits every width.

Sources: `toolchain/ts/lua/compiler.ts:5390-5395,5419-5423,4935-4979,4831-4835`; `toolchain/ts/lua/compiler/target_semantics.ts:53-66`; `toolchain/ts/lua/memory_access_syntax.ts:3-19`.

**BS19 — Static array length is elements, not bytes.** Unary `#` on a resolved named static array uses the first dimension as a compile-time number; it is not the total byte extent or product of all dimensions. `sizeof(type)` is the independent byte-size query in BS06. The BIOS iterates `for command = 0, #command_registry - 1 do` and declares `bss monitor_completion_commands: word[#command_registry]` against its actual inferred RODATA array.

Sources: `toolchain/ts/lua/compiler.ts:5127-5137,5296-5301`; dimension constant producer `toolchain/ts/lua/compiler/static_constants.ts:128-143`; actual precedents `machine/bios/shell/commands.lua:68-78,105,152-155`.

**BS20 — Direct RODATA compiler protection is not a pointer-permission capability.** Address resolution marks the direct RODATA binding read-only, propagates that flag through its typed fields/indices, and rejects assignment through a directly resolved read-only address. Typed local views in that same owner are resolved with `readOnly: false`. Therefore this fact sheet may state the direct compiler restriction; it must **not** turn it into read-only-pointer type propagation, a bus-permission rule or an alias-proof protection mechanism. Actual ROM write outcomes belong to mapped Memory, already a separate foundations extract.

Source: `toolchain/ts/lua/compiler.ts:5053-5085,4982-5022,1673-1687,4062-4066`.

**BS21 — Emitted scalar accesses still cross the CPU/mapped-memory boundary.** Typed scalar loads/stores emit LOAD_MEM/STORE_MEM or their displaced forms when the compiler can encode an aligned, nonnegative displacement. Word/U8/U16LE/U32LE/F32LE/F64LE kind IDs are respectively 0/1/2/3/4/5 in both mirrored specs; alignment masks are respectively 3/0/1/3/3/3. The paired displaced scalar handlers form a u32 byte address from the register plus encoded word displacement, enforce that access-kind alignment, then call the corresponding **mapped** Memory method. Store admission can block before the write; a changed bus-fault sequence enters data-bus exception. This is bounded scalar displaced-handler evidence, not an exhaustive access/fetch/fault/lifetime audit, and does not bypass narrower MMIO width rules. Ordinary LOAD_MEM/STORE_MEM behavior is separately sourced in memory-boot BM19/20.

Sources: emitter `toolchain/ts/lua/compiler.ts:5208-5245`; spec `machine/ts/spec/blua32/memory_access_kind.ts:1-10`, `machine/cpp/spec/blua32/memory_access_kind.h:8-24`; CPU `machine/ts/machine/cpu/cpu.ts:2992-3009,3020-3078`, `machine/cpp/machine/cpu/cpu_dispatch.inl:554-603`.

## Actual BIOS precedents, not invented API examples

**BS22 — DATA scalar precedent.** Existing firmware uses exactly `data rng_state: word = 0x12345678`, later reads/writes that scalar with `*rng_state`. The literal is a program state initializer, not an MMIO address or fixed cartridge storage address. This establishes real authored DATA/dereference spelling; the remaining random-number algorithm is outside this extract.

Sources: `machine/bios/math.lua:25,317-318`.

**BS23 — RODATA/struct precedents.** Existing firmware declares a fixed `rodata terminal_palette_words: word[4]` initializer, and independently a `struct monitor_command` with three `string` fields plus `kind: u8` followed by `rodata command_registry: monitor_command[]` with named-field entries. The latter uses actual inferred outer length, zero-based array traversal and a typed address-of-element view. These are two concrete source precedents, not a claim that their firmware-owned storage can be overwritten by a cartridge or that the strings are raw byte payloads.

Sources: `machine/bios/tty/terminal.lua:41-46`; `machine/bios/shell/commands.lua:61-78,152-155,525-526`.

**BS24 — BSS buffer, typed view and synchronous BIOS submission precedent.** Firmware reserves `bss terminal_command_words: word[command_batch_words]`, takes its address value as `local command_words<const>: *word = terminal_command_words`, begins its command-word count at zero, fills through the existing GPU encoder and submits that address/count through `dma_transfer.copy_to_gp0`. The DMA BIOS function writes that source address and word count, starts the transfer, and waits until its DMA-completion sequence changes; the sequence is incremented by its registered completion-IRQ callback. The separate `gx_commandlist.submit` additionally appends a GPU IRQ command, performs that DMA wait, then polls/acknowledges the GPU IRQ. Thus the actual BIOS code distinguishes submission, DMA completion and the later GPU IRQ poll/ack. This extract records the firmware control flow only: the later GPU IRQ poll/ack is not a promise of whole-unit idle, display completion or buffer-reuse permission. These are BIOS source precedents, not a newly established cartridge-callable API. It does not derive unrestricted cross-channel exclusion, IRQ-mask safety, all DMA buffer-reuse permissions or GTE/GEO asynchronous lifetime rules from it.

Sources: `machine/bios/tty/terminal.lua:20-23,73,478-497,602-607`; `machine/bios/gpu/gpu.lua:28,160-165,200-204`; `machine/bios/kernel/dma.lua:14-34`; `machine/bios/gpu/commandlist.lua:9-16`.

## Constant-module count exports: separately audited extension

**BS25 — Named-array length support is not a universal constant-export rule.**
The constant-module literal evaluator accepts scalar literals and collected
constant identifiers, but its unary branch admits only Negate, not Length.
The additional static-storage export branch admits only an identifier
expression when static exports are enabled; it does not admit `#inputs`.
Top-level const collection uses that same literal evaluator, so moving
`#inputs` into a const local does not establish an accepted export. The
executed memory example uses one numeric `input_count` const identifier for
both record-array dimensions and the exported count. This is a distinct
producer boundary, not a change to BS19's named-static-array length facts or
a runtime/compiler fix.

Source: `toolchain/ts/lua/compiler/passes/const_module_exports.ts:49-111,119-135,163-178`;
actual program `carts/memory_manual/storage.lua:3,17,23,28`. Independent
source disposition: `/tmp/bmsx-blua-storage-prose-source-review.md`, separate
const-module addendum. Execution is recorded separately in
[memory-example.md](memory-example.md), not inferred from evaluator inspection.

## Reader-driven representation clarifications

**BS26 — Type names used by the complete two-module program.** The compiler
builds one semantic frontend for the entry and compiled modules. A top-level
struct declaration in path scope is global; the static type query checks
lexical/parent scopes before its global type index built from those files.
Thus the exact program's `memory_sample` and `memory_status` declarations in
`storage` can be used unqualified by its entry typed views and `sizeof`,
without fields for those type names in the returned address/count table. No
visibility of uncompiled modules, collision policy, namespace/import API or
parameter/return metadata is implied.

Sources: `toolchain/ts/lua/compiler.ts:5913-5935,6181`;
`toolchain/ts/lua/semantic/model.ts:342-349,993-1003,1701-1715`;
`toolchain/ts/lua/semantic/static_declarations.ts:39-59`;
`toolchain/ts/lua/compiler/struct_types.ts:83-87,146-150`. Actual program
compilation/execution is separate evidence in [memory-example.md](memory-example.md),
not independently re-proved by this source-only review.

**BS27 — Integer initializer field bits.** For the supported static numeric
initializer kinds, the compile-time integer's low8/16/32 bits are emitted for
U8/U16LE/U32LE-or-Word respectively. The central writers emit successive low
bytes with masks/unsigned shifts. No extra field storage or range-error branch
is added by that encoder; f32/f64 initialized storage remains unsupported.
This is initialization encoding, not a full rule for arbitrary language values.

Sources: `toolchain/ts/lua/compiler.ts:3800-3817`;
`machine/ts/common/endian.ts:19-29`.

**BS28 — Raw32-bit Word versus U32LE in backed main RAM.** Both ordinary scalar
kinds read/write the same four little-endian bytes and return the same unsigned
32-bit loaded value for that raw word. Word wrappers call the same mapped U32
methods with different ACCESS flags. Kind IDs and fault flags remain distinct.
Do not generalize to arbitrary numeric/object values, NaN payloads, compiler
arithmetic or a separate device protocol.

Sources: `machine/ts/machine/memory/memory.ts:426-435,524-526,544-570,619-656`;
`machine/cpp/machine/memory/memory.cpp:316-325,413-460,514-550`;
`machine/ts/machine/cpu/cpu.ts:3090-3102,3130-3142`;
`machine/cpp/machine/cpu/cpu_dispatch.inl:627-635,657-664`;
paired access-kind/io flag sources remain BS21/BF20.

Separate nonauthor source acceptance for these bounded clarifications and the
existing status-edge/RODATA facts: `/tmp/bmsx-memory-reader-correction-source-review.md`.

## Mirror disposition and withheld inferences

The compiler and BIOS in this scope have sole authored producers, not a second mirrored compiler/firmware implementation. The paired access-kind leaves and bounded displaced scalar CPU control flow in BS21 agree; no newly inspected paired disagreement was found. This is **not** whole-language/runtime/device parity proof. Previously withheld boot-address/heap-budget arithmetic ranges in the existing foundations facts remain withheld and are not resolved by this extraction.

The following tempting statements are deliberately **not** on the sheet: C signed-load behavior from the `i*` names; read-only aliases/capabilities from `rodata`; a C-style pointer increment; automatic/free physical-stack storage; a raw string byte pointer; a DMA/GTE/GEO ownership/lifetime guarantee from mere addressability; free-memory rights beyond declared allocations; persistence after startup/reboot; general arbitrary-local address-of.

## Precise remaining owners / next bounded extracts

1. **Executed complete newcomer example and diagnostics:** this extraction inspected producers and existing BIOS precedent but did not compile/run a new cart. Use the ordinary build/headless path with one authored typed static buffer/field/index/address example and verify its emitted/observed values. No output or test success is claimed here.
2. **Function parameters, returns and lost/retained pointer metadata:** local pointer typing in BS14 is proved; a complete call-signature/alias propagation contract is not. Continue the named compiler `FunctionBuilder` parameter binding, `StructView` capture/upvalue handling and CALL argument producer, plus paired CPU call/return handlers only for required ABI facts. Do not infer typed annotations on function parameters from local syntax.
3. **Dynamic values and physical memory:** static typed byte storage is distinct from ordinary language tables/strings/closures and logical stack/heap accounting. Continue the already named paired CPU Value/ValueSlots/LuaHeap and specific dynamic-object owner only for a concrete needed representation/lifetime claim; no dynamic object is established here as a hardware-readable contiguous buffer.
4. **String character/byte ABI:** BS10 proves a four-byte constant reference in static layout, not string bytes or their accessibility. Continue actual string-value producers, `__bmsx_string_byte` BIOS export and mapped-address/string consumption owners for the specific operation; do not invent a NUL terminator or UTF-8 byte pointer.
5. **Compiler protection versus mapped write outcomes:** BS20 intentionally stops at compiler flags. Existing memory-map facts cover mapped ROM writes; any alias-specific runtime claim still requires that live paired mapped-memory route. No extra compiler guard/runtime fix is requested.
6. **Shared-buffer ownership, admission and reuse:** BS24 proves only named BIOS control flow. For device permission/lifetime, continue each paired DMA owner, GTE transfer/PLUS owner, GEO descriptor/job owner and their current fact sheets independently. Need exact capture-versus-live-read edge, completion/fault edge, source/output overlap and reuse timing for each operation; no cross-device contract follows just because a buffer is BSS/word-aligned.
7. **Which memory may be allocated:** linked placement is known but no raw-RAM allocator/free-span permission is added. Preserve separate I/O/GEO/system/static reservations from the existing source-reviewed extracts; do not treat `[cartridge BSS end, RAM end)` as an approved universal arena without its owning contract.

No repository file was changed by this extraction. No new publisher, schema, validation gate, runtime helper, byte encoder or formatting abstraction was added.
