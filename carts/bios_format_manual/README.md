# BIOS String formatting: an ordinary cartridge

This is the complete formatting example printed in
[BIOS String operations](../../docs/book1/bios-string.md#complete-program-formatted-text).
Save its result module as `results.lua` and concatenate its three formatting-entry
parts as `cart.lua`, with one blank line between adjacent parts:27+69 lines. The entry uses the installed `string.format`;
there is no local formatter, codec, allocator or ABI wrapper.

The [build and observation route](../../docs/programming/getting-started.md#build-and-inspect-formatted-text)
supplies the exact tree, manifest and commands. The retained check has 18 assertions;
a separate unit check establishes the installed `%c` two-codepoint cases and
call-result adjustment. Ordinary playback independently emits the chapter's
eight diagnostic lines. Its timeline uses zero-based presentation offset 4 as the observation endpoint,
not an elapsed-frame, boot-time or cycle guarantee.

The eight groups demonstrate sign/prefix padding; width/precision/value order;
zero integer precision and U32 conversion; fixed/scientific/alternate-general
construction; quoted escapes and two-codepoint `%c`; missing/nonnumeric argument
paths; and reached incomplete/unsupported conversion errors. The large fixed
request returns `1e+06`, showing that its numeric-text pieces do not guarantee
plain fixed-decimal output.

The initial example expected one `%c` codepoint and failed. Current BIOS source
is compiled through the already documented grouping rule, so both `modf`
results reach variadic `char`. The program and text follow the verified installed
behavior; no BIOS/compiler/runtime change is part of this example.

These are bounded TS guest checks and ordinary diagnostics, not native execution,
heap/stack exhaustion, all-input parity, a physical throughput budget, or closure
of the common Table-length and existing CPU/compiler questions. In particular,
using alternate general format skips zero stripping in the demonstration; it
neither invalidates nor universally approves the untested helper-Table paths.
