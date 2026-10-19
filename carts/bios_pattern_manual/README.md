# BIOS String patterns: an ordinary cartridge

This is the complete [pattern program](../../docs/book1/bios-string.md#sec-bios-string-example-patterns-and-substitutions).
Save its 47-line result module as `results.lua`; join its five entry parts,
with one blank line between adjacent parts, as the 122-line `cart.lua`.
The [build and observation route](../../docs/programming/getting-started.md#build-and-inspect-pattern-searches)
supplies the complete tree, manifest and exact commands. No local matcher,
encoding helper or cartridge BIOS import is used.

The retained-result suite has 40 assertions after completion. Independent
ordinary playback emits 13 diagnostic lines, including a standalone final
replacement-error payload. The timeline chooses zero-based presentation offset
4; it does not assert values or define elapsed-frame, boot or cycle timing.

The program contrasts plain/pattern search, codepoint positions, text/position
captures, generic iteration, greedy/minimal spans, balance, frontier and
backreference matching; text/Table/Function replacements; empty advancement;
and reached versus deferred errors. It follows current software, including
Table false becoming text and empty substitution skipping source codepoints.

These are bounded TS guest checks and ordinary diagnostics, not native
execution, arbitrary-input/resource/work guarantees or closure of the common
Table-length and existing CPU/compiler questions. Completion alone is not
proof that every comparison word is 1.
