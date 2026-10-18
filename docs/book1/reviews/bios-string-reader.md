# BIOS String chapter: bounded newcomer reader review

## Scope and method

Reading-only reconstruction by an experienced programmer new to BMSX. The
review used `docs/book1/bios-string.md`,
`carts/bios_string_manual/README.md`, and the relevant public Memory, CPU,
BIOS-base, protected-calls/coroutines and table-library sections. The preceding
table chapter's reader-review file was consulted only for review organization,
not for String behavior or acceptance evidence.

No BIOS, runtime, compiler, cartridge implementation, spec, fact sheet,
architecture document or historical/reference PDF was opened. No program was
built or executed. The source-line counts below are counts of the printed
chapter listings, not comparisons with cartridge files. This is not a fresh
development-environment installation check, source audit, native-execution
claim, print-layout review or whole-manual acceptance.

## Findings

### Shared Table-length behavior remains unresolved

The String chapter's `string.len` section states:

> On a Table it returns the maintained cached length, not the number of keys or
> the largest numeric key.

It directs the reader to the public CPU length-operation procedure. The CPU
chapter's **Stored length** section explicitly says:

> Cross-capacity length transitions remain incomplete in this reference.

Its delete/refill example records conflicting results of 4 and 5 with key 5
still present and concludes:

> No common result is specified here.

The reader therefore cannot derive one common result for every accepted Table
input to `len`, nor every length-dependent early return or codepoint-read
branch of `upper`, `lower`, `sub` and `reverse`. Those branches are documented
rather than silently narrowed to String-only calls, but their shared length
producer is still incomplete. The companion README correctly says its example
does not settle that question. This is an existing public contract gap, not a
missing local build instruction and not something the ordinary example proves.

### No additional local required-step omission identified

Within the bounded base-String and ordinary-program scope, the current public
chapter and README supply the required API choices, storage declarations,
module assembly and observation instructions. No other missing prerequisite or
ambiguous required step was identified by this reading review. This finding is
limited to an otherwise working repository development environment; the
README names that prerequisite rather than documenting an SDK installation.

## Reconstruction checks

- **All nine interfaces.** The chapter names `byte`, `char`, `len`, `upper`,
  `lower`, `sub`, `reverse`, `rep` and `from_utf8`, explains their purpose and
  successful result counts, and says the installed `string` global requires
  no cartridge import. Pattern matching, formatted text and binary packing are
  explicitly separate interfaces, not claimed complete by these nine exports.
- **Codepoints versus bytes.** The four-position/eight-byte table, embedded
  zero rule, literal-escape distinction and String-reference warning let the
  reader distinguish text from mapped encoded storage. One-based String
  positions and zero-based typed bytes are separately stated.
- **Scalar and endpoint choices.** Signed-word `byte` conversion, its single
  result and ignored third argument are contrasted with unsigned-word `char`
  conversion, scalar rejection and its empty-argument result. Slice defaults,
  explicit nil start, flooring, relative negative bounds, zero/NaN behavior,
  clamping and full-span return are specified. Repetition distinguishes omitted
  count, zero/negative count, separator presence, unusual accepted values and
  nonterminating/resource-consuming requests.
- **Transformations and mutable dependencies.** ASCII-only case changes,
  codepoint rather than grapheme reversal, non-String early returns and reached
  errors are explicit. Captured functions are distinguished from the current
  `select` and `tostring` globals still used by their callees. The linked table
  chapter supplies those helper procedures rather than requiring BIOS-source
  inspection.
- **Mapped-input ownership and lifetime.** `from_utf8` requires caller-provided
  stable backed bytes and an encoded byte count. The lead-driven read table
  explains why that count is not a continuation-read barrier. The bounded
  two-mapped-byte/count-one example, lack of replacement-character policy,
  scalar error and mapped-fault crossrefs make truncation hazards visible.
  The 257-byte BSS example crosses the staging boundary and reuses a source
  byte after return without changing the returned String; it is not presented
  as a capacity or cycle guarantee.
- **Complete source assembly.** The printed Result storage block contains 37
  lines; the four Entry blocks contain 28, 19, 19 and 29 lines, totaling 95.
  They have one entry directive. The README names `results.lua` and `cart.lua`,
  specifies concatenation order, supplies the entire directory tree and ROM
  manifest, and explains `require('results')`. The public Memory chapter covers
  startup BSS clearing, linked placement, cross-module struct names, readonly
  arrays, typed views and address-of-element access. No guessed RAM address,
  unlisted source module, image asset or local UTF-8 codec is needed on this
  documented route.
- **Build and observation route.** The README provides the tooling and BIOS
  artifact-build commands before cartridge validation. It separately labels
  the derived retained-result check and its repository test input. For ordinary
  observation it supplies the entire timeline JSON and the playback command;
  that route does not require reconstructing the assertion file. The chapter
  names every retained field and all nine diagnostic lines, including literal
  tabs, the post-return source readback of 90 and the completion/HALT boundary.
  Frame 4 is explicitly an observation endpoint, not boot or execution timing.
- **Error boundaries.** The two actual protected argument failures have exact
  error strings. The chapter and public protected-call/Memory references
  distinguish those language errors from mapped-access faults; `pcall` is not
  advertised as a hardware-fault recovery sandbox.

## Verdict

The printed chapter plus its companion README are textually sufficient to
reconstruct the documented ordinary String program and its observation route
without inspecting implementation files. No additional chapter-local
API-use, assembly or observation gap was found in this bounded review. Actual
build/run success was not independently observed here. The unresolved common
Table-length behavior still prevents an unrestricted completeness claim;
future pattern/format/pack interfaces, fresh environment installation, native
ordinary execution, arbitrary-input resource bounds and the rest of the
console remain outside this verdict.
