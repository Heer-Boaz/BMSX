# System overview — evidence index

Editorial evidence, not public manual prose. Inspection at `master`,
`58bbf76d7`, 2026-10-18. The overview is an installed-resource and routing
orientation, not a new copy of the ISA/register reference or a claim of whole
manual completion. No architecture document or reference-PDF technical content
was used. Current paired software/specification owners are the authority; no
runtime behavior was changed to make the prose agree.

## Finite facts-only author inputs

- [Memory, windows, reservations and DMA](console-memory.md): capacities versus
  routing limits, statics, mapped-word semantics and classified-span charges.
- [Processor and system control](console-control.md): timebase, IRQ, SYSTEM,
  INPUT and IMGDEC. The independent audit corrected capture-latch/CTRL and
  conditional DATA-read wording before merger.
- [Graphics and audio](console-video-audio.md): shared VRAM, programmable
  display, register-fed GTE versus memory jobs, voice/source/transfer domains.
- [Firmware VRAM reservation](console-firmware-vram.md): named BIOS query and
  reservation at cartridge handoff, independently checked against its actual
  producers and existing cartlib consumer.

The [merged source record](../reviews/console-source.md) admits independent
prose and figure checks, a source-blind full-overview reader pass and actual
seven-page print inspection. Each has its own explicit scope; none is a new
runtime, whole-volume or whole-manual acceptance claim. A successful preview
alone is not publication approval.

## Scope limits

Do not infer physical pinouts, electrical ratings, independent bus clocks,
CPU/fetch wait states, a fixed display mode/refresh, fixed image footprints,
free heap size, a general CPU-linear VRAM/sample-RAM aperture or whole-runtime
parity. Cartridge windows and installed slot count do not complete Book III.
The common Table-length STOP, seven CPU questions and BZ01 remain separate open
work; this finite opening chapter does not resolve them.
