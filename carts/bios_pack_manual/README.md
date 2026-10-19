# BIOS String packing: an ordinary cartridge

This is the complete [record program](../../docs/book1/bios-string.md#sec-bios-string-example-a-packed-record).
Save its 42-line result module as `results.lua`; join its five entry parts,
with one blank line between adjacent parts, as the 117-line `cart.lua`.
The [build and observation route](../../docs/programming/getting-started.md#build-and-inspect-packed-records)
supplies the tree, manifest and commands. The BIOS owns the packing; no local
codec, mapped String address or host ABI is introduced.

The 23-codepoint header and 33-codepoint record demonstrate endian changes,
maximum alignment, integer/f/d fields, truncated fixed text, embedded-zero
length-prefixed text and a terminated status. Unpack continues from position
24 and returns position 34. A separate c1/codepoint256 case shows why String
packets must not be assumed to contain only octets.

The retained suite checks 33 assertions after completion. Independent ordinary
playback emits eight diagnostic lines, including three deliberate protected
errors. Its timeline chooses zero-based presentation offset 4, not a value
assertion, elapsed-frame count, boot deadline or hardware cycle guarantee.

These are bounded TS checks and diagnostics, not native execution, exhaustive
float interchange/rounding, arbitrary-size completion, a mapped-byte transfer
interface, or closure of the common Table-length and CPU/compiler questions.
Completion alone does not prove the recorded comparisons true.
