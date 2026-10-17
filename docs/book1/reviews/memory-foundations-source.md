# Memory foundations: preliminary source review

2026-10-17. **Bounded source acceptance, not chapter/publication approval.**
The initial source freeze did not approve a public foundations chapter. A
subsequent working manuscript and catalog entry are tracked separately in
[the draft source review](memory-source.md); publication remains blocked. The
full newcomer programming route and the gaps listed in each extract remain open.
No architecture document or reference PDF supplied hardware facts.

## Separately extracted and independently audited scopes

- [Memory map and scalar access](../facts/memory-map.md): mirrored map/model
  leaves, Memory owners and the narrow I/O-slot-count dependency. Independent
  review confirmed capacities versus address windows, reservation versus decoded
  aperture, scalar width/boundary behavior, ROM zero fill, cartridge routing and
  the first-fault latch. Two overbroad statements were corrected: the aligned
  mapped-write statement now covers CPU admission, not the DMA readiness early
  return; RAM-offset semantics now apply only to accesses resolved to backed
  RAM, not every non-I/O/non-cartridge address.
- [Boot, linked storage and execution storage](../facts/memory-boot.md): all
  36 numbered facts received a separate source audit, split between placement/
  startup/image producers and CPU/COP0/storage owners. Compiler/linker/firmware
  have their actual sole producers; mirrored runtime/spec behavior was compared
  where present. BM27 now qualifies EXEC zero readback as permitted/privileged;
  user-mode reads trap. BM35 promises clearing live value slots and stack top,
  not identical clearing of unused capacity. BM22/BM33 exclusions below remain.
- [Installed construction and lifecycle](../facts/memory-lifecycle.md): root
  independently checked ML01–ML07 against the ordinary browser/native creation
  chains, model/Memory/Machine owners and generic caller-supplied-model boundary.
  A separate reviewer audited ML08–ML21, including an independent device-reset
  dispatch subreview. ML16 was narrowed to the named write-watch method's direct
  body and delegations: unread callees do not establish transitive absence of
  RAM writes. The corrected bounded claims pass; complete reboot persistence
  and all entry-time byte contents remain explicitly unproved.

Every retained fact names its primary source lines. The original three files preserve
separate ownership/scope limits so an author can receive only the relevant
paragraph's facts. Their persistence adds no facts, validation manifest, schema,
publication gate, runtime helper or executable code. The map extract's temporary
source-hash list was omitted; it was extraction identity, not a hardware fact.

## Withheld arithmetic equivalence

BM22's cartridge base-plus-image-offset addition retains different numeric
representations for an overflowing sum in the two owners. BM33's heap-budget
subtraction differs for a supplied RAM count below the reservation. Both facts
are explicitly **WITHHELD** for those input ranges, with exact locations and
isolated-expression evidence in the sheet and
[technical follow-up](../../manual/technical-follow-up.md).

These findings do not establish that a complete valid image or supported
machine supplies those inputs, or that downstream consumers expose different
cartridge behavior. No stronger parity claim, new hardware rule or runtime fix
is approved. Unaffected map, placement and installed-capacity facts are not
silently discarded or promoted to whole-machine parity.

## Important boundaries for the paragraph authors

- A mapped byte, a reservation, a linked static allocation, a value-slot stack
  and a logical heap budget are different contracts.
- Fresh backing allocation is not the cartridge-entry RAM image. A central
  method with no bulk clear is not proof that delegated devices/firmware leave
  all bytes untouched.
- Generated startup initializes its own DATA/BSS. Arbitrary EXEC and mere image
  activation do not implicitly run that startup.
- Lower Memory access behavior does not override CPU alignment/exception edges.
- ROM/cartridge address-window sizes do not establish installed media, permissions,
  persistence, banking or aliases. Book II retains the device/socket protocol.
- Numerical firmware/static extents, allocation rights, typed BLua storage APIs,
  instruction fetch, complete fault programming and inherited device state need
  their remaining named producers and an executed newcomer example.

## Review evidence

The bounded extraction/audit artifacts were:
`/tmp/bmsx-memory-foundation-source-audit.md`,
`/tmp/bmsx-boot-memory-producer-source-audit.md`,
`/tmp/bmsx-boot-memory-cpu-storage-source-audit.md`,
`/tmp/bmsx-installed-memory-capacity-root-source-audit.md`,
`/tmp/bmsx-installed-memory-lifecycle-source-audit.md` and
`/tmp/bmsx-installed-memory-device-reset-source-audit.md`.

These are source reviews only. No public prose/figure/print review, execution
proof, full boot ABI, whole-book acceptance or completion of the eleven planned
paragraph units follows. No machine/compiler/BIOS/cartlib behavior was changed.

## Persisted-copy integration check

A separate final comparison passed for all three repository extracts against
their corrected source-audited scratch versions. The only differences are the
six-line internal-source-only header/review link, repository crosslinks and
omission of the temporary map source-hash list. All hardware facts, source
ranges, gaps, privilege/live-slot/delegation corrections and BM22/BM33 WITHHELD
limits remain unchanged. The reviewer also checked this consolidated report's
acceptance boundaries against the separate audits and root ML01–ML07 evidence;
no new or overbroad claim was found. Evidence:
`/tmp/bmsx-memory-foundations-persisted-review.md`.

This final check accepts copied facts/report scope only. It is not another
live-source refresh or public chapter/print/programming-route approval.

## Typed static-storage extension

[The separate BS01–BS24 extract](../facts/memory-storage.md) now freezes actual
BLua declaration spelling, primitive/aggregate layout, initializer limits,
linked-address views, zero-based element scaling, byte arithmetic and existing
BIOS precedents. An independent auditor read the actual parser/compiler/linker,
paired access-kind/displaced-scalar CPU sources and cited BIOS code. The
corrected bounded 24 claims pass; this is not a complete language/call/string
ABI, whole-runtime parity, shared-buffer reuse or execution result.

BS24 originally called the later GPU IRQ wait “GPU processing completion”. The
source proves only the specific appended IRQ and subsequent poll/ack, not
whole-unit idle, presentation or general buffer permission. The extract now
uses that narrower wording, cites the actual command encoder, and explicitly
labels firmware source precedents as distinct from a cartridge-callable export
contract. All remaining gaps are retained. Evidence:
`/tmp/bmsx-blua-memory-storage-source-audit.md` (including resolved final
disposition). The public foundations draft is tracked separately in
[memory-source.md](memory-source.md); no complete-chapter/publication approval
follows from persisting these facts.

## Bus-fault interface and ordinary scalar extension

[BF01–BF41](../facts/memory-faults.md) separately cover the four bus-fault
registers, numerical codes/ACCESS flags, first-pending latch versus internal
sequence, any-nonzero ACK, mapped scalar widths and ordinary CPU scalar
alignment/exception invocation. Root independently checked every numbered
claim against the paired spec/Memory/CPU source scope and separately evaluated
the actual four address constants in both languages; the bounded claims pass.
Evidence: `/tmp/bmsx-bus-fault-interface-source-review.md`.

The lower mapped access rule is not substituted for the earlier CPU alignment
check. Returning zero from a faulting Memory read is not a guest-load result:
the ordinary CPU load takes data-bus exception before assigning its destination.
F64's two-word write has no invented rollback. Construction/clear words and
Memory's three saved fault fields do not establish all reset/save-state or
handler behavior. Full handler/recovery ABI, fetch/other instruction forms,
DMA, unrelated device faults and timing remain the explicit separate scopes.
No executable fault/recovery example or runtime repair is claimed.

## Execution addressing and nominal scalar costs

[EF01–EF10](../facts/memory-execution.md) freeze a separately bounded paired
instruction-format/domain/fetch/function-record scope and narrow instruction
base costs. A nonauthor read all named primary ranges, including actual
installed-model producers, and accepted the corrected claims. EF10 originally
said all ordinary scalar instructions cost two cycles; the actual source says
scalar **memory** instructions have that base, while ADD/SUB/MUL have base one.
The extractor corrected only that heading and extended its MUL source range.
The auditor rechecked the exact final copy and direct LE-descriptor/frame-PC
citations: `/tmp/bmsx-memory-execution-source-review.md`.

The installed 33,868,800 cycle timebase and nominal instruction charges are
not invented RAM/ROM/VRAM electrical clocks, byte bandwidth, source-expression
costs or full scheduler/device timing. BE instruction words and LE data/record
words remain distinct. Domain selection versus ambient-image fallback does
not prove a universal executable/NX-region table or RAM program ABI. Original
PC fetch faults, decode versus cached dispatch, and all excluded PC-overflow,
coherency, arbitrary-call and handler scopes remain explicit. No runtime change
or full CPU ISA/completeness/publication approval follows.
