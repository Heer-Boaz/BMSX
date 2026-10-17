# Protected calls and coroutine source index

2026-10-18; baseline0620b06d2. Current software is the authority, not stock Lua,
architecture prose, historical reference PDFs or an inferred machine design.
This chapter covers installed protected calls and cooperative language threads;
it is not a complete BIOS-library or on-console loader reference.

- [Protected calls](coroutines-protected.md): actual public aliases, source
  signatures versus runtime argument handling, values/counts, handler behavior,
  error classification, exception/root barriers and primitive charges.
- [Coroutine lifecycle](coroutines-lifecycle.md): all8 public functions,
  states/transfers, failed versus closed, upvalues, private wrap cleanup,
  status-independent yieldability and public-wrapper route.
- [Installed BIOS surface inventory](firmware-surface.md): narrow startup and
  installation facts plus a finite further API-reference backlog. Descriptor
  omissions and internal extra loader arguments are not silently public APIs.
- [Complete ordinary example and bounded execution](coroutines-example.md):
 135 literal source lines,40 retained observations,17 ordinary diagnostic lines;
 22 existing TS cases,30 existing paired vectors and18 additional paired cases.

No affected public-call mirror disagreement was found in these extractions.
No runtime repair, generic host-exception catch, total-service cycle bound,
complete heap/GC guarantee or universal Lua compatibility is inferred.

## Diagram source map

`figures/coroutines-transfer.svg` depicts only the actual producer in CX03:
first resume10,3; yield13,nil,ready; parent receives true prefix; second resume
17,nil,23 becomes yield results; return40,nil,3; parent receives true prefix and
observes dead. Vertical distance is not time. Names resume/yield in the figure
abbreviate the public coroutine.resume/coroutine.yield functions. Arrows are
language control/value transfers, not simultaneous CPU datapaths or buses.

## Remaining whole-manual work

Complete base helpers/library functions, source loading/environment, import
capabilities and on-console session semantics remain the source-backed finite
assignments in firmware-surface. CPU's seven earlier paired-owner questions,
remaining graphics teaching/output contrasts and Book II remain independent.
No narrowed chapter acceptance is whole-console newcomer acceptance.

## Root reset addendum

CR01. CPU reset calls clearCallStack and later pushes selected system startup.
clearCallStack unwinds the active/resumer chain, closes captures of removed
frames, clears protected-call ownership and resets root Running. It is not a
BIOS coroutine.close call delivering its tuple to the interrupted caller. Source
machine/ts/machine/cpu/cpu.ts:841–866,869–908; paired
machine/cpp/machine/cpu/cpu.cpp:3388–3415,431–472. Re-read by root. Existing CPU
boundary fact BZ04 establishes the same bounded scope. Do not turn this into a
promise about clearing every unlinked suspended Thread object or unused backing
slots; earlier CPU representation stops remain separate.
