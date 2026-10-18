# BIOS String chapter: bounded newcomer reader review

## Fresh public-only closure of the pattern/packet reader item

Date: 2026-10-18. Checkout: `/home/boaz/BMSX`.
Reader model: experienced programmer, new to BMSX.

## Verdict and findings

**No new actionable public-reader blocker was established in this bounded review.** Given the documented working Node/npm/native-canvas prerequisites, a reader can select each interface, reconstruct each of the two ordinary cartridges, follow the supplied checkout's build/test route, and compare ordinary diagnostic output without reading implementation owners.

This is a documentary/reconstruction finding, **not a successful execution claim**. No build, test, cartridge execution, or native runtime was performed. The review does not verify whether package scripts implement the commands as described or whether the retained suites actually make the claimed 40/33 assertions. The named supplied test and timeline paths exist, but their contents were not opened.

No missing code prelude, manifest setting, entry selector, import, packet buffer, or observation command was found. No style-only rewrite is proposed.

## Public evidence

### Understanding the interfaces and their options

- `docs/book1/bios-string.md:963-1079` supplies the pattern units, ASCII classes, escaping, sets, anchor scope, repetition, captures/backreferences, balancing/frontiers, and reached-error limitations. The important departures from an experienced programmer's possible standard-Lua assumptions are explicit: `%w` includes underscore (985), `^` restricts the current search start (1011), special constructs are not repeatable groups (1030), and malformed-pattern outcomes are not all assigned a generic error (1073-1079).
- `docs/book1/bios-string.md:1081-1173` gives all four signatures and the option/return differences: `find` plain mode and initial end bound, `match` capture results, the single `gmatch` iterator, and the three `gsub` replacement categories, limit/count and non-character-preserving empty advancement. Examples use the same rules rather than silently importing standard Lua behavior.
- `docs/book1/bios-string.md:1450-1775` supplies packing signatures/results, codepoint rather than octet units, complete listed format/control options and defaults, alignment and `X` lookahead, integer/text/float handling, position continuation and explicit errors. In particular, the text explains why this is not a String-pointer or mapped-byte-buffer API (1482-1492), and does not sell the float fields as universally correct IEEE interchange (1615-1699).

### Reconstructing the complete programs

- Pattern assembly instructions are at `docs/book1/bios-string.md:1175-1193`, `docs/programming/getting-started.md:457-484`, and `carts/bios_pattern_manual/README.md:3-8`. The result listing plus all five entry listings are complete and identify the single entry and required `results` module. They reproduce the supplied files **exactly**, including final newline, by joining the entry code bodies with one blank line:
  - Result body: `docs/book1/bios-string.md:1196-1242` -> 47 lines.
  - Entry bodies: `1259-1288`, `1300-1327`, `1337-1347`, `1358-1376`, `1389-1418` -> 122 lines after the prescribed joining.
  - Manifest: `docs/programming/getting-started.md:477-479` exactly matches the supplied three-line manifest.
- Packing assembly instructions are at `docs/book1/bios-string.md:1777-1812`, `docs/programming/getting-started.md:525-549`, and `carts/bios_pack_manual/README.md:3-8`. The independently named result layout and separate entry are explicit. They likewise reproduce the supplied files **exactly**:
  - Result body: `docs/book1/bios-string.md:1815-1856` -> 42 lines.
  - Entry bodies: `1868-1896`, `1907-1934`, `1945-1963`, `1974-1984`, `1996-2021` -> 117 lines after joining.
  - Manifest: `docs/programming/getting-started.md:544-546` exactly matches the supplied three-line manifest.

Literal cartridge files were read only by the textual comparison; no gap was filled from them.

### Running and observing using the supplied checkout

- The shared setup states repository-root POSIX commands, Node.js 22+, npm/development dependencies, `npm install -D`, and the required working native `canvas` binding: `docs/programming/getting-started.md:5-13`. Module/entry roles are explained at `41-45`. The guide explicitly bounds its checked environment rather than promising a fresh dependency installation on every OS (13). A fresh OS/bootstrap acceptance is not established by this review.
- The pattern route gives exact tooling build, validated cartridge build, and supplied test invocation plus the expected pass line at `docs/programming/getting-started.md:486-497`. It separately gives the complete timeline JSON and ordinary tooling invocation at `499-515`, then tells the reader which 13 lines to compare and what the timeline does not prove at `517-523`. Those lines are all printed in `docs/book1/bios-string.md:1421-1448`, including the final standalone payload. The derived test image is not misrepresented as ordinary playback.
- The packing route similarly supplies all three commands and expected pass line at `docs/programming/getting-started.md:551-563`; complete ordinary timeline and command at `565-581`; and the eight-line comparison instruction and protected-error/timeline caveats at `583-588`. The expected eight lines are printed at `docs/book1/bios-string.md:2024-2043`.
- The two READMEs agree with those reconstruction counts, observation counts, separate test/playback routes and the caveats: pattern `1-24`, packing `1-24`.

## Unresolved boundaries retained

- The common Table-length contract remains unresolved, including temporary Tables for ordinary String inputs. This review does not convert conditional procedural descriptions into universal capture/result counts or output-assembly guarantees. Relevant explicit limitations include `docs/book1/bios-string.md:1038`, `1083-1091`, `1183-1187`, `1464-1469`, `1736`, and `2040-2043`.
- Existing **CPU7 and BZ01** uncertainties are **not audited or declared resolved**. The public routes' broader CPU/compiler caveats remain in force (`docs/programming/getting-started.md:522-523`, `587-588`; both READMEs' final paragraphs).
- No conclusion about runtime/compiler/BIOS correctness, mirrored native parity, arbitrary inputs, malformed patterns without specified outcomes, resource ceilings, hot-path performance, mapped-byte transfer, float interchange or SDK/manual-wide completeness follows from this reader audit.
- Earlier base/nine-function/format examples were not reaudited. An initial heading/keyword locator emitted some earlier public headings/snippets before the requested Pattern section; they were not used to establish findings. No runtime, BIOS or compiler owner, source-fact ledger, other review, architecture document, historical PDF or memory artifact was opened.

## Exact reviewed public snapshot

Hashes were checked again after the reading and reconstruction comparisons. Line numbers below are from this exact snapshot.

| File | Substantive reviewed range | SHA-256 |
| --- | --- | --- |
| `docs/book1/bios-string.md` | 963-2043 (Pattern language through EOF) | `a7b97cbab88db05e0e2a65a871beec4872b705292e298262bf5947b8e7ea01b5` |
| `docs/programming/getting-started.md` | 1-95 (shared setup/roles); 457-588 (pattern/packing routes through EOF) | `5ab3940502405d0328ad927a86bb6d63e54d5d05a71d2106af27b148654e6744` |
| `carts/bios_pattern_manual/README.md` | 1-24 (whole file) | `3c447b7a4fd56575f038c0d16342040979b55487420f48ea5572f508da845ea4` |
| `carts/bios_pack_manual/README.md` | 1-24 (whole file) | `5ff0bad7918abaf251efe38fd504128c149192de2e26653ec2dae9e6b247b9cd` |

Literal reconstruction-comparison inputs, not implementation evidence:

| File | Range | SHA-256 |
| --- | --- | --- |
| `carts/bios_pattern_manual/results.lua` | 1-47 | `b4af10e7290a76adef699f49db75431a4f8b0728cae755c9a1239ab69e5ec3f0` |
| `carts/bios_pattern_manual/cart.lua` | 1-122 | `215f1e96904e11dfd8eca819ee95a4c314516824a05567cfe0acbbc9b8e05583` |
| `carts/bios_pattern_manual/res/manifest/manifest.rommanifest` | 1-3 | `ad0c79b52d43a59e792a0cb531aea8175961a80bfb16712c67bc163c04d757a4` |
| `carts/bios_pack_manual/results.lua` | 1-42 | `014393c2fa8c85a19d06df7a8bdde166eb49acfcae87f6958c4bdb738e678491` |
| `carts/bios_pack_manual/cart.lua` | 1-117 | `c55e1f8b2541a858d798085625725fcb4db2070942ac774b5548567089bd76fa` |
| `carts/bios_pack_manual/res/manifest/manifest.rommanifest` | 1-3 | `1429ba7a47f506fa5a285a500eea9242df7241f26dfaa613a238b07fc0465edf` |

Only `/tmp/bmsx-string-fresh-reader-review.md` was written; no checkout file was changed by this audit.


---

## Earlier source-aware reconstruction stage

## Current pattern/packet reader route — bounded reconstruction

2026-10-18, chapter SHA-256
`a7b97cbab88db05e0e2a65a871beec4872b705292e298262bf5947b8e7ea01b5`;
getting-started SHA-256
`5ab3940502405d0328ad927a86bb6d63e54d5d05a71d2106af27b148654e6744`.
The chapter, separate build routes and two cartridge READMEs supply the complete
modules, manifests, exact commands, debug-image selection and literal ordinary
observations. No extra local matcher/codec or source lookup is required for the
printed examples. The retained tests are explicitly supplied-checkout debug
suites, not omitted cartridge modules or proofs from a timeline description.

Independent source-aware reviewers verified the final public literal assembly,
manifest/timeline equality, assertion counts and diagnostic lines. Root repeated
these byte comparisons in `/tmp/bmsx-string-next-reconstruction-check.py`, log
`/tmp/bmsx-string-next-reconstruction.log`. The resulting source identities and
execution evidence are in [the program review](bios-string-program.md).

**Independence limit:** unlike the earlier base/format public-only passes below,
the current added reconstruction reviewers already knew the owners. They are
not fresh source-blind newcomer reviewers. This is no known missing assembly
step in the supplied-checkout route, not an independent whole-library newcomer
acceptance or complete SDK installation/debugging review. A fresh source-blind
pass of the new additions remains pending. Do not relabel this combined
source/reconstruction work as that missing pass.

The common Table-length STOP, CPU7/BZ01, remaining BIOS/environment material,
hardware overview/specification opening and whole-console acceptance remain
open. Changing volume labels or passing these recipes does not close them.

---

## Earlier public-only formatting and base evidence

## Public-only newcomer review — original current snapshot

### Scope and method

Read only the public `docs/book1/bios-string.md` string-format section and connected example/context, `docs/programming/getting-started.md` formatting route plus its shared prerequisites/file-role explanation, and `carts/bios_format_manual/README.md`. No BIOS/compiler/runtime source, internal facts, architecture, other reviewers' reports, or reference PDFs were consulted. No program/build/test command was executed for this review. This is an experienced-programmer/new-to-BMSX reading audit, not a confirmation of implementation behavior, current executable output, native parity, or complete manual accuracy.

Snapshot began 2026-10-18 02:08:10 UTC and was rechecked at 02:09:37 UTC with no changes:

| Public source | SHA-256 | Lines | Bytes |
| --- | --- | ---: | ---: |
| `docs/book1/bios-string.md` | `2c2a256817c5efca8b28b9e6306feee18f2584ed55a5bcc4ea07c2e36e1e33ec` | 948 | 50591 |
| `docs/programming/getting-started.md` | `dcdf60c1769fa5c74c65d3320bf952fc8fa7be4cad5a3b3ee14c4bebf0caf7ec` | 451 | 22342 |
| `carts/bios_format_manual/README.md` | `f750fff14409e512a31af1ddfcf4e036f3584577edf803a6941d134d0e229472` | 32 | 2027 |

### Verdict

**Usable supplied-checkout route, with two small clarity points; no demonstrated practical blocker.** An experienced programmer can identify the separate cartridge, reconstruct the two modules and manifest, choose documented formatting options, run the named checks, and compare ordinary diagnostic output using only these public pages. The route is explicitly limited to a working checkout with its prerequisites, not a fresh-platform installation recipe.

### What the public material supplies

- Installed `string.format` availability without a cartridge import; one String result, codepoint-width semantics, no caller buffer.
- Conversion syntax, all accepted flags/modifiers/conversions, sequential width/precision/value star consumption, padding/sign/prefix interactions, ignored precision cases, quoted escaping, integer conversion and floating construction rules.
- Explicit departures from ordinary printf/Lua expectations: `%c` returns a two-codepoint String in the described installed BIOS; large requested fixed output can contain `1e+06`; missing/nonnumeric arguments do not receive a common type-check policy. These are documented behavior claims, not behavior newly established by this reader audit.
- The common Table-length boundary and its affected helper paths remain explicitly unresolved rather than being silently promised to work. The example uses alternate general format to bypass one such path.
- Exact cartridge tree, manifest, module filenames, sole entry declaration, separate debug-only suites, tooling/validated-cart/test commands and expected case lines.
- Separate ordinary-playback timeline and command; eight expected `Format ...` lines; brackets to expose padding; visible `%q` escapes; numeric length 2 and both zero codepoints for `%c`; the derived-test/ordinary-playback and frame-endpoint caveats.

### Exact clarity points

1. **Ordinary debug-image selection is implicit.** `getting-started.md:403–405` builds tooling and validates the cart with `--debug`, but its ordinary command at line 441 omits `--debug`. Nearby ordinary `headless:tooling` examples explicitly include it. The public formatting route does not say how that final command chooses the ROM and matching BIOS prepared above. This is a clarity ambiguity, not an assertion that the command fails: no CLI implementation or execution was inspected. Make the command's intended debug selection explicit, or explain its selection rule.
2. **Claimed 69-line entry depends on seam spacing.** The three printed entry blocks contain 20, 15 and 32 lines: 67 total. The claimed 69 lines result when one blank line is inserted between adjacent parts. The original route says concatenate in order but does not spell out these two blank separators. This does not alter program semantics, but a reader counting the supposedly exact listing could reasonably pause. State the intended blank-line seams if retaining the exact line count.

No additional expected output was invented. No implementation discrepancy is inferred merely from these public claims. No need was found to follow additional CPU/Memory/base prerequisite links to complete this bounded build-and-observe reading task.

### Public-text closure — 2026-10-18 02:21:44 UTC

Re-read the current public formatting route and README after the root's narrow wording changes. Both original clarity points are closed as reading issues:

- `getting-started.md:386–390` now explicitly specifies one blank line between adjacent entry parts, making the stated 69-line entry reproducible; README line 6 matches.
- `getting-started.md:442–446` now explicitly passes `--debug` for ordinary playback and states that it selects the previously built debug cartridge and the script's debug BIOS.

**Current reader verdict: clear for the bounded supplied-checkout build-and-observe route.** This reviewer still did not execute the route or inspect the CLI/runtime implementation. The root's independent runtime evidence is separate and is not being claimed as this reading audit.

Current hashes/counts at this closure:

| Public source | SHA-256 | Lines | Bytes |
| --- | --- | ---: | ---: |
| `docs/book1/bios-string.md` | `a52c63f2abb3e3b3a9d7990b4e5442b9711d838b61d19337bc0f374c9218473d` | 956 | 50681 |
| `docs/programming/getting-started.md` | `c01f9cfa65f71a01eebda36e203336b84b7850b133ddb9ec158128f364320762` | 454 | 22492 |
| `carts/bios_format_manual/README.md` | `0689a4d2dff39335568487ee5651d5ee83cf9e3c23ce2b6183d0e1c2546bb259` | 32 | 2071 |

### Final bounded snapshot — 2026-10-18 02:23:21–02:23:50 UTC

Final chapter: SHA-256 `32db34535a77fda7a4e4efa53ecdfba866e581f1e340356fcb2680e38a144666`, 960 lines / 50726 bytes. Companion and README hashes/counts remain exactly as in the public-text closure above. All three hashes were unchanged across this final review interval.

Independently removing only the three newly authored formatting-section `<section class="keep-together">` / `</section>` marker pairs and their added blank lines reproduces the **original chapter SHA-256 exactly** (`2c2a256817c5efca8b28b9e6306feee18f2584ed55a5bcc4ea07c2e36e1e33ec`). Thus no original chapter words/listings were altered by the reviewed pagination closures. This is a source-identity check, not proof that those words match runtime semantics.

**Final reader verdict remains clear within this bounded public-only review.** Both reported practical-clarity points are closed. No new reading blocker is introduced by the three print grouping markers. The draft's explicitly unresolved Table-length/helper paths, runtime/native scope and resource-limit caveats remain unresolved; this review does not promote them to complete contracts.

### Final public-guide precision closure — 2026-10-18 02:25:49 UTC

Re-read the last wording change in the companion and README. The supplied timeline's `frame: 4` is now explicitly called a **zero-based presentation offset**, not an elapsed-frame/startup-time/cycle guarantee. The README's introduced `offset4` spacing typo is fixed to `offset 4`. This is clear as public guidance; the underlying endpoint implementation proof belongs to the separate source audit and is not claimed by this public-only reader review.

Final public-guide hashes/counts supersede the earlier chronological snapshots:

| Public source | Final SHA-256 | Lines | Bytes |
| --- | --- | ---: | ---: |
| `docs/book1/bios-string.md` | `32db34535a77fda7a4e4efa53ecdfba866e581f1e340356fcb2680e38a144666` | 960 | 50726 |
| `docs/programming/getting-started.md` | `4b3bd85016426d32ac65967cc6a4d62f8439aceea56f989052dcd52fbf848a88` | 455 | 22525 |
| `carts/bios_format_manual/README.md` | `aa38ca28afb7112efdc1ca6571812cb851060be7a54bdcc4cdfda348e6c96398` | 32 | 2090 |

The accepted final2 PDF/chapter hashes are unchanged. **Final bounded reader verdict: clear; no outstanding reported practical reading issue.** Execution, fresh-platform certification, native parity and unresolved helper contracts remain outside this review.

---

## Earlier base-operation evidence

The following source/artifact review is retained at its earlier bounded scope;
it is not an approval of the later formatting extension or a current hash.

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
