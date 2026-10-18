# BIOS String base operations: bounded frozen reference facts

2026-10-18, baseline ea4ba90ab. Source facts, not chapter prose. Nine exports
only; no architecture document, historical PDF or stock-Lua semantics is input.
The earlier [Memory text/byte facts](memory-strings.md) are the central shared
representation index; their named leaves were checked live for this slice.
Root's ordinary program and paired scratch observations remain separate from
source extraction and do not close the existing common Table-length STOP.

## Installation and representation

- SR01. Boot installs public `string = require('string')` before cartridge
  entry: `machine/bios/main.lua:4-12,105-113,136-143`. The compositor starts
  from the base Table, adds the other interfaces, installs that same Table as
  the String-index Table and returns it: `machine/bios/string.lua:1-22`.
  These nine base functions do not add a mapped register bank or IRQ controller.
- SR02. Base captures the hidden byte/char primitives and the returned Table
  module's concat function; from_utf8 is the actual utf8.decode value:
  `machine/bios/string/base.lua:1-7`. The decoder separately captures char,
  Table concat and Table unpack: `machine/bios/string/utf8.lua:1-6`.
- SR03. A String is an interned language value, not a mapped character address.
  Its ordinary LEN counts codepoints, including zero; a typed static String
  field is a constant index, not its text bytes. Full producer/consumer source
  paths are MS01/MS02/MS08 in memory-strings. Actual paired LEN leaves:
  `machine/ts/machine/cpu/cpu.ts:2672-2685` and
  `machine/cpp/machine/cpu/cpu_dispatch.inl:319-330`. String base reads instead
  use the String-index Table, not character indexing: TS `cpu.ts:629-637`;
  native `machine/cpp/machine/cpu/cpu.cpp:3251-3257`.

## Scalar operations

- SR04. byte is a direct alias, not a BIOS loop wrapper. It requires a String
  first value; missing/non-String source is INVALID_ARGUMENT. Omitted/nil
  position means1; other positions must be Number, then signed32 conversion.
  Below1/beyond-end returns exactlyone nil; selected position returns one
  Number codepoint. It scans from the beginning, not an encoded-byte offset.
  An extra range-end is ignored. TS `machine/ts/machine/cpu/cpu.ts:4320-4351`;
  native `machine/cpp/machine/cpu/cpu.cpp:2176-2207`; alias base.lua:1,39.
- SR05. char requires each supplied value to be Number, converts it to U32,
  then rejects converted values above10FFFFH or within D800H..DFFFH. Accepted
  scalars include zero; empty arguments return one empty String. Otherwise
  exactlyone String contains the accepted scalars. No raw-byte-buffer address
  is returned. TS `cpu.ts:4353-4371`; native `cpu.cpp:2209-2223`; alias
  `machine/bios/string/base.lua:2,40`. Native UTF-8 append leaf:
  `machine/cpp/common/utf8.h:98-119`.
- SR06. Number-to-word conversion truncates toward zero and reduces modulo
  2^32; signed interpretation uses bit31; NaN/either infinity becomes zero.
  TS byte `cpu.ts:4333-4336`, char:4361; native byte/char use central
  `machine/cpp/machine/cpu/value.h:199-229`. This is not String parsing:
  nonnumber primitive operands are rejected before conversion. char's scalar
  check follows conversion, so65.9/100000041H both select41H, while-1 converts
  to FFFFFFFFH and fails. Actual bounded execution is indexed separately.
- SR07. len(value) is exactly `return #value`, not a String-only validator:
  `machine/bios/string/base.lua:43-45`. Strings give codepoint count; Tables
  give their maintained cached length; other categories reach the ordinary
  unsupported-length error. LEN leaves are SR03. The common Table producer
  remains stopped; naming that cached result does not supply a prefix formula.

## Case, substring, reversal and repetition

- SR08. upper maps97..122 by-32; lower maps65..90 by+32; other codepoints
  unchanged. Each position is selected with captured byte, reconstructed with
  captured char and joined through captured concat. No locale/Unicode casefold
  or input mutation is present: `machine/bios/string/base.lua:9-25,48-55`.
  Table input with L=0 reaches empty concat; a nonempty Table reaches byte's
  invalid source before constructing a result. No common Table L is inferred.
- SR09. sub first reads L=#value. Missing/nil start=1/end=L. Each nonnil
  bound q=arg//1: positive unchanged; negative L+q+1; zero or NaN uses1 for
  start and0 for end. Clamp start below1 upward and end aboveL downward.
  Reversed end<start returns empty String. Full span returns original value
  before byte calls, even if that value is a Table. Singleton uses char(byte);
  other intervals collect inclusive codepoint fragments then concat. Source
  `machine/bios/string/base.lua:27-36,58-82`. Unlike Table ranges, sub end0
  is0, not L. Arbitrary accepted Table branches retain the common-length STOP.
- SR10. reverse reads L; L<=1 returns original value, including a Table.
  Otherwise it visits L..1 and joins captured char(byte(...)) fragments. It
  reverses codepoints, not encoded bytes or a segmented grapheme sequence;
  Table L>1 reaches byte's argument error. It does not assign into the input:
  `machine/bios/string/base.lua:85-95`.
- SR11. rep count nil/omitted=1, else count_arg//1; count<=0 returns empty
  String before touching value/separator concatenation. Otherwise output='',
  chunk=value, remaining=count; nonnil separator first assigns output=value,
  computes separator..value even for count1, then remaining=count-1. Repeated
  parity/doubling loop uses remaining%2, output..chunk, remaining//2 and
  chunk..chunk; final return is output. All source `base.lua:97-120`.
- SR12. rep does not validate String-only value/separator. Count1 with nil
  separator converts through ''..value; with nonnil separator it computes the
  chunk but can return original non-String value. NaN count skips remaining>0:
  no separator leaves empty String; nonnil separator computes the chunk and
  leaves output=value. Negative infinity meets count<=0; positive infinity
  does not make halving progress. No invalid-count/length String or safe
  allocation/termination bound is authored by this function. Source SR11 plus
  shared arithmetic/comparison/concat below, not stock-Lua behavior.

## Mapped UTF-8 decoder and lifetime

- SR13. Actual signature is decode(address,byte_count), published as
  string.from_utf8: `machine/bios/string/base.lua:7`,
  `machine/bios/string/utf8.lua:10-15,56-58`. It binds source as *u8 and
  computes finish=source+byte_count. It tests source<finish only before a lead,
  then increments source and reads/advances1,2 or3 further bytes according to
  the selected branch. This is mapped-address consumption, not a String's
  backing-byte-pointer API or a memory allocation/ownership grant.
- SR14. Lead<80H yields lead. Otherwise lead<E0H combines
  ((lead&1FH)<<6)|(next&3FH); lead<F0H combines
  ((lead&0FH)<<12)|((next&3FH)<<6)|(nextnext&3FH); all other leads combine
  ((lead&7)<<18)|((next&3FH)<<12)|((nextnext&3FH)<<6)|(last&3FH).
  Exact reads/order: `machine/bios/string/utf8.lua:16-35`. Continuation reads
  do not compare with finish or validate prefixes/overlong encodings. Zero is
  codepoint0, not termination. Downstream char scalar checks still apply.
- SR15. Decoder accumulates256 codepoints, constructs a chunk with captured
  char/unpack, then joins completed chunks with captured concat. Count256 is
  staging, not a maximum. Without chunks, the final path calls char(unpack(...))
  even for zero results; installed dependencies give one empty String for an
  empty span. Source `machine/bios/string/utf8.lua:6,37-53`.
- SR16. Provide backed complete encoded bytes and keep them stable while reads
  run. Returned text is constructed from read codepoints, not a retained mapped
  byte view: SR13-SR15 and actual char intern owner SR05. Ordinary program
  decodes257 prepared BSS bytes, rewrites source byte0 to90, and observes
  returned codepoint1 still65 plus source readback90. No atomic input snapshot,
  DMA ownership, safe malformed replacement or unbounded-size guarantee follows.

## Shared dependencies, errors, source forms and work

- SR17. Floor division is quotient/truncation/subtract, not numeric String
  parsing: TS `machine/ts/spec/blua32/numeric.ts:1-5`; native
  `machine/cpp/spec/blua32/numeric.h:7-11`. Arithmetic nonnumber tags give
  NaN: TS `value_slots.ts:128-131`, native value.h:125-144 and arithmetic
  `cpu_dispatch.inl:171-218`. Less-than of unsupported category pairs is false,
  not a new comparison error: TS cpu.ts:2701-2736; native dispatch356-368.
  Concat conversion owners TS `value.ts:182-205`, native `value.cpp:9-29`.
- SR18. Capturing functions does not freeze their transitive global reads.
  Table concat still calls global tostring and empty unpack still calls global
  select: `machine/bios/table.lua:53-78,90-98`. Replacing public table fields
  does not replace already captured function values; changing those globals
  can affect joins/empty decoding. The actual paired probes demonstrate both
  cases. Installed String-index lookup retains the installed Table when only
  public string is rebound: `string.lua:1,20`, paired CPU leaves SR03.
- SR19. Shared exact error Strings include `Invalid argument.` and
  `Attempted to get length of an unsupported value.`; reason INVALID_ARGUMENT
  is10. TS `machine/ts/machine/cpu/cpu.ts:496-505`, native
  `machine/cpp/machine/cpu/cpu.cpp:371-380`, paired cop0 reason definitions
  `machine/ts/spec/blua32/cop0.ts:36`, native cop0.h:42. Mapped reads follow
  the Memory/CPU scalar-access fault contract, not a new decoder error/IRQ.
  BIOS and CPU functions contain no rollback around prior reads/construction.
- SR20. Descriptors advertise byte(s[,i]), char(...), len(s), upper/lower(s),
  sub(s,i[,j]), reverse(s), rep(s[,n[,sep]]):
  `toolchain/ts/lua/builtin_descriptors.ts:93-108`. sub's direct source form
  requires its start argument; use explicit nil for the body's nil default.
  from_utf8 is really exported despite descriptor absence; actual two-parameter
  declaration remains its contract, not an invented omission. Minimum-arity
  diagnostic producer `toolchain/ts/lua/semantic/diagnostics.ts:357-375,395-415`.
- SR21. byte/char each add TWO builtin cycles, argument/result coefficients0:
  TS `machine/ts/machine/cpu/value.ts:109-110,121-122`; native
  `machine/cpp/machine/cpu/value.h:63-72`, ids7/8 at paired builtin enums.
  Charge before dispatch: TS cpu.ts:3841-3842; native cpu.cpp:1876-1877.
  This is incremental charge, not total call/wrapper cost or a physical rate.
  A provisional root author brief incorrectly said1; that was discarded before
  final authoring after reading both owners. No runtime change was inferred.
- SR22. Other wrappers execute ordinary instructions, repeated byte scans,
  temporary fragments/Strings, concat/unpack and doubling work. No function-
  local maximum successful text size, decoder byte count, heap/depth budget,
  fixed total cycles or arbitrary-input termination bound is declared in these
  inspected bodies. Do not equate helper staging with an API limit.

## Exact limits of this sheet

No new mirrored discrepancy was found in the inspected ordinary scalar-text
leaves. This is not exhaustive corrupt image-string decoding, full Unicode,
arbitrary typed-pointer expression/Word-wrap adjudication, GC, resource-limit
execution or all BIOS APIs. No new allocation rights or text-to-mapped-byte
encoder is inferred. Existing common Table-length disagreement still blocks
complete common Table-dependent accepted-value claims; it is not cleared by
naming L, restricting the examples to Strings, or passing14 paired vectors.
