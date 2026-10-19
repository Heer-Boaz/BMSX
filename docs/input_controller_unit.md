# Input software integration

The console-facing controller specification is the
[Input Controller reference](book1/input.md). Register access, sampling,
reset, output effects and supervisor-request behavior are defined there, not
in this internal integration note.

## Ownership

The mirrored device implementation under
`machine/{ts,cpp}/machine/devices/input` owns emulated controller state. Host
input sources implement the device's input boundary; platform adapters own
physical-device normalization, focus, assignment and lifecycle. The device
does not parse browser key names or host controller chords.

`hosts/common/input` owns shared TypeScript host input. Browser/touch producers
and native libretro/frontend adapters retain their own physical sources. Host
menu shortcuts and gameplay routing consume those source owners separately;
UI focus and host remapping are not a second emulated registerfile.

The optional `cartlib` input framework runs as independent cartridge software.
Its action maps, expressions, consume/repeat state and sampling policy are not
hardware, BIOS or manufacturer API. Generic runtime/input tooling must not
require that library's layouts.

Internal changes should verify the affected producer and consumer together,
including source cancellation and held-input lifetime where relevant. Public
controller behavior changes update the manual and actual device owners, not
another register table in this note. See [software architecture](architecture.md)
for the repository-wide dependency boundary.
