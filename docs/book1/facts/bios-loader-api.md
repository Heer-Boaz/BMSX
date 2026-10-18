# BIOS public loader: finite root API facts

2026-10-18, live baseline5b264d38a; read-only extraction. Actual owners and
paired leaves below opened directly. Not chapter prose or execution evidence.
No architecture manuscript, historicalPDF, foreignLua behavior, runtime repair,
build/test or compiler execution supplies these facts. Grammar, syntaxfactory,
arena/lifetime are separate packets. Current software is authority; exact
public error descriptions assume supplied live dependencies.

## Installation and binding

- A01. BIOS requires base; installs table/string/coroutine; assigns
  lua_compiler=require('compiler/api'); assigns load=lua_compiler.load; then os,
  then math. Sources machine/bios/main.lua:4-12.
- A02. API retains require('compiler/load') Table and hidden __bmsx_pcall value;
  publishes compile_syntax=load_compiler.compile_chunk and syntax_factory from
  compiler/syntax_factory; adds load and returns compiler_api Table. Source
  machine/bios/compiler/api.lua:1-24.
- A03. Paired boot primitive tables map __bmsx_pcall to PCall. Public base pcall
  is installed from its separately captured same bootprimitive. Replacing public
  pcall does not rebind API's retained vm_pcall. Sources
  machine/ts/spec/blua32/builtin.ts:40-52;
  machine/cpp/spec/blua32/builtin.h:49-61; machine/bios/base.lua:9-11,214-216;
  machine/bios/compiler/api.lua:1-2,10.
- A04. Derived assignment consequence: initial global load and API.load contain
  the same function value; later assignment to one binding does not reassign
  the other. The API body looks up compile on its retained load_compiler Table
  each call (not through public lua_compiler.load/global load). Sources
  machine/bios/main.lua:8-9; machine/bios/compiler/api.lua:9-17.

## Exact public load call/results and sequencing

- A05. Actual fixed formals source,chunk_name,mode,environment,external_scope.
  It calls retained vm_pcall with target load_compiler.compile and exactly those
  five values, keeps exactly ok,result. If ok returns result (one value); else
  returns nil,result (two values). It does not call the compiled closure.
  Source machine/bios/compiler/api.lua:9-22.
- A06. Ordinary fixed-frame setup fills missing formals with guestnil and does
  not retain surplus arguments without varargflag. This is runtime/reachedcall,
  not permission for every static shortened-source call. Sources
  machine/ts/machine/cpu/cpu.ts:3272-3297;
  machine/cpp/machine/cpu/cpu.cpp:3017-3042.
- A07. Protected target receives forwarded argument tail; successful values are
  prefixed true; eligible error produces false,errorValue. API's two locals
  select the first result after that flag. Sources paired protectedcall setup
  machine/ts/machine/cpu/cpu.ts:3865-3902,3997-4000,4003-4029,4053-4079;
  machine/cpp/machine/cpu/cpu.cpp:1895-1922,1962-1990.
- A08. Explicit thrown guestpayload remains its value; classified execution and
  out-of-memory paths supply reasonString. The protected boundary cannot unwind
  across intervening exception/completion-root frames. This is not a promise
  to catch hardware access/opcode faults or undo writes. Sources
  machine/ts/machine/cpu/cpu.ts:1942-1969,4094-4131;
  machine/cpp/machine/cpu/cpu.cpp:2643-2659,2050-2074.
- A09. Therefore successreturns one closure (link/root creation sources below),
  failure returns exactly nil plus the first protected error value; the API
  itself does not turn all errors into Strings. A failure payload can be false
  or nil if a reached live dependency explicitly throws thatvalue. Sources
  machine/bios/compiler/api.lua:9-22; machine/bios/compiler/load.lua:27-38;
  paired A07-A08. Source deduction, not a newly executed example.

## Mode and chunk label

- A10. In compile, mode acceptance occurs BEFORE chunk-name default/parser.
  Nil mode succeeds without scanning. Every other mode is scanned for indexes
  1..#mode; captured __bmsx_string_byte(mode,index)==116 immediately accepts.
  Otherwise reject. Source machine/bios/compiler/load.lua:6,9-19,40-46.
- A11. For supplied String modes, membership of lowercase 't' is the whole
  mode test, not exact spelling/allowed-character validation. Thus '' and 'b'
  reject, while 't', 'bt' and other Strings containing 't' accept text parsing.
  No binary decoding branch occurs after acceptance. Source
  machine/bios/compiler/load.lua:9-19,40-46. Source-derived examples.
- A12. Rejection calls current global error with exactly the concatenation
  "attempt to load a text chunk (mode is '" .. mode .. "')".
  For ''/'b' messages end (mode is '')/(mode is 'b'). These are guesterrorValues,
  not promises about displayprefixes/stacktraces. Source
  machine/bios/compiler/load.lua:40-43.
- A13. After mode acceptance, chunk_name=chunk_name or '=(load)'; nil and false
  therefore select thatdefault, unlike mode's nil-only default. EmptyString/0
  remain supplied (ordinary truth). Then parser.parse(source,chunk_name), then
  compile_chunk. Source machine/bios/compiler/load.lua:40-46; paired truth
  boundary uses only nil/false as falsey:
  machine/ts/machine/cpu/value_slots.ts:157-160 and cpu.ts:2853-2863;
  machine/cpp/machine/cpu/value.h:193-197 and cpu_dispatch.inl:429-440.
  No new special loadertruth rule.
- A14. Captured byte requires guestString as firstvalue and walks codepoint
  positions (one-based) to return Numbercodepoint; it does not read rawbyte
  storage or call a reader callback. Sources
  machine/ts/machine/cpu/cpu.ts:4320-4351;
  machine/cpp/machine/cpu/cpu.cpp:2176-2207.
- A15. LEN accepts String codepointcount or maintained Tablelength, otherwise
  classified UNKNOWN; reasonString is exactly 'Attempted to get length of an
  unsupported value.'. Modefalse reaches that length error before parser;
  Stringmode scan works on codepoints, not UTF-8byte offsets. Tablemode reads
  maintained length (existing Tableproducer publication dependency), not an
  invented strict mode-type validator. Sources
  machine/ts/machine/cpu/cpu.ts:2672-2685,496;
  machine/cpp/machine/cpu/cpu_dispatch.inl:319-330;
  machine/cpp/machine/cpu/cpu.cpp:371; load.lua:9-19.

## Compile but do not run

- A16. compile_chunk calls compiler.compile(chunk,chunk_name,1,environment,
  external_scope), passes result to linker.link, receives function_address,
  const_pool, then creates root via blua32.closure(function_address). It returns
  thatclosure. No generatedroot invocation occurs here. Source
  machine/bios/compiler/load.lua:7,21-38.
- A17. Public compile_syntax aliases compile_chunk directly: no surrounding
  load protectedresult conversion, modecheck, textparse or chunk-name default
  in thatroute. Sources machine/bios/compiler/api.lua:4-6;
  machine/bios/compiler/load.lua:27-46.

## Environment source boundary (full externalscope/lifetime separate)

- A18. compiler.compile passes environment~=nil to semantic.bind. The root and
  children keep has_environment; unbound textual identifiers choose external
  metadata first, then environment_key when has_environment, else global_key.
  Local/parameter/upvalue binding wins first. Sources
  machine/bios/compiler/compiler.lua:1881-1887;
  machine/bios/compiler/semantic.lua:151-187,387-405,409-435.
- A19. Environment itself is retained in program/environment and added to
  const_pool as an ordinary guestvalue; emitted environment read is GETT and
  write is SETT against it. It is not copied into a new globalregisterfile.
  False is supplied (notnil), therefore selects environmentname routing too;
  no environment-type check in these paths. Sources
  machine/bios/compiler/compiler.lua:76-96,367-371,407-418,991-1011,1890-1895.
- A20. Without environment, compiler retains boot __bmsx_getglobal/setglobal,
  adds the relevant function and textual key as constants, emits ordinary
  accessor call (not image-local GETGL ordinal). Rebinding public getglobal or
  setglobal does not change those retained dependencies. Sources
  machine/bios/compiler/compiler.lua:8-12,87-96,420-437.

## Source-use metadata omission, not invented runtime maximum

- A21. Actual runtimeformals above include fifth external_scope (load) and
  fourth external_scope (compile_syntax/compile_chunk). Default descriptors
  advertise load(chunk,chunkname?,mode?,env?) and
  lua_compiler.compile_syntax(chunk,chunkname,env?), omitting external_scope.
  Sources machine/bios/compiler/api.lua:9;
  machine/bios/compiler/load.lua:27; toolchain/ts/lua/builtin_descriptors.ts:36-37.
  Record this precise metadata/runtime difference; do not repair/infer final API
  policy from it. Actual software is authority for reached behavior.
- A22. Descriptor minimum counter ignores ?/...params: listed load minimum1,
  compile_syntax minimum2. Recognized staticcall validation only rejects written
  expressioncount below required, not a maximum. Sources
  toolchain/ts/lua/semantic/call_signature.ts:35-56;
  toolchain/ts/lua/semantic/diagnostics.ts:357-375,395-415. This finite source
  rule is not universal typechecking/optimizer/input acceptance proof.

## Deliberate limits

Full lexer/parser/lowering grammar, syntaxfactory shapes and ASTmutation,
external-scope callbacks/captured-frame liveness, exact arena capacity and
resource failure/reclaim/reset/snapshot behavior are separate extractions.
No uniform runtimecompiler cycle budget, heap/length maximum, all-input lexical
termination, native/optimizer equivalence, freshSDKorwholeconsoleclaim here.
Do not borrow genericLua reader-function/binary/environment/_ENV promises.
This API packet contains source deductions, no new actual execution observations.


## Primitive/work accounting supplement

- W01. Retained PCall primitive base charge4 cycles, per-argument0,
  per-return0. Paired id10 maps to that cost, charged before starting the
  protected call. Sources machine/ts/spec/blua32/builtin.ts:12;
  machine/cpp/spec/blua32/builtin.h:21;
  machine/ts/machine/cpu/value.ts:109-124;
  machine/cpp/machine/cpu/value.h:63-75;
  machine/ts/machine/cpu/cpu.ts:3841-3845;
  machine/cpp/machine/cpu/cpu.cpp:1876-1880.
- W02. This charge does not include API closure execution, mode scanning,
  parser, semantic analysis/codegen/linking, allocations, callees, instruction
  reads/writes, or caller CALL/RET work. The API and compile bodies execute
  ordinary statements/loops; no fixed total-load duration follows. Sources
  machine/bios/compiler/api.lua:9-22; compiler/load.lua:9-19,27-46;
  compiler/compiler.lua:1881-1951; compiler/linker.lua:7-73.
