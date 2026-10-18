# APU source binding: bounded acceptance

## Scope and authority

The public delta supplies the admitted-source table and actual-ROM extent,
excluded-memory and cartridge-selection lifetime rules. Existing formats,
faults, transfer lessons and complete four-route BLua program remain intact.
The [frozen supplement](../facts/apu-source-binding.md) cites paired live owners
and leaves. A fresh facts-only author supplied the source-region/lifetime
prose; an independent reviewer checked actual paired source and the final
wording. No factual or test-correctness failures remain in this bounded delta.
The source-blind public reader found no missing or misleading step in choosing
a source, preserving/rebinding its selection or locating SELECT in Book III.
These are not fresh factual approvals of the whole APU, every installed unit
or the SDK. No architecture document or historical PDF supplied facts.

Before the test/doc implementation, production-reference study used PSn00bSDK's
[GPU common operations](https://github.com/Lameguy64/PSn00bSDK/blob/master/libpsn00b/psxgpu/common.c),
separating register/command reset, work ownership and synchronization. None of
its addresses, behavior or timing is BMSX authority or public chapter content.

## Execution and limits

Two new TS cases and two matching native cases use the existing component
harnesses, actual mapped registers, sample-memory binders and output datapath.
They assert installed final-byte success, straddling/absent/zero-extent failure,
ROM-less-card and installed card-RAM/mailbox rejection, private-RAM end/no-wrap,
and queued PLAY's execution-time selection retained after a later SELECT.
The selection trace produces packed stereo7F007F00H and retained socket1.
All39 TS audio tests and the freshly rebuilt native audio-controller suite pass.
The component clock and explicit service are deliberate: neither establishes a
guaranteed CPU instruction window for changing SELECT or an installed-machine
one-cycle sample interval. No runtime, BIOS, compiler, helper or harness changed.

The unchanged complete ordinary cartridge also passes quality-enabled packing,
compilation/linting and the supplied guest case. That execution checks ROM PCM,
live gain/pause, sixteen-word private-RAM transfer/readback, RAM PCM, square and
BADP playback, four ordered ends and no faults. It does not demonstrate the new
queued-selection boundary or prove analog/audible output; the paired component
cases supply that finite boundary evidence separately. No new cartridge was
necessary, and its printed program remains unchanged.

Source/test and public-only reports: `/tmp/bmsx-apu-source-binding-{review,reader}.md`.
Execution logs: `/tmp/bmsx-apu-source-ts-tests-final.log`,
`/tmp/bmsx-apu-source-cpp-{build,tests}.log`,
`/tmp/bmsx-apu-source-cart-validation.log`, `/tmp/bmsx-apu-source-guest.log`.
Actual final-page/publication evidence is separate in [apu-print.md](apu-print.md).
No socket replacement/removal, electrical fetch timing, analog output or
whole-machine/portable-delivery guarantee follows from these checks.
