# APU source binding — frozen paired-owner facts (2026-10-18)
Bounded supplement to [APU facts](apu.md): actual source admission and cartridge-selection lifetime. No architecture document or reference PDF was opened; the existing facts were used only as a location map. This is not a fresh approval of the whole unit.
Prefixes below: TS = machine/ts; CPP = machine/cpp. All citations were opened live.

## Exact accepted storage routes
1. Non-generator source descriptors must have nonzero SOURCE_BYTES. No alignment requirement is imposed at binding; these are byte regions, not CPU word reads.
2. Private sample RAM: SOURCE_ADDR >=40000000H and the entire nonzero region must fit its 524288 bytes. Final valid byte is4007FFFFH. The region does not wrap, even though the separate transfer offset wraps.
   Pair: TS/machine/devices/audio/sample_memory.ts:20–38; CPP/machine/devices/audio/sample_memory.cpp:17–30. Constants: TS/spec/audio/apu.ts:6–8; CPP/spec/audio/apu.h:10–12.
3. System ROM: SOURCE_ADDR/SOURCE_BYTES must fit wholly inside the actual installed system-ROM byte buffer, starting at00000000H. A mapped-window address alone does not establish a successful bind.
   Pair: TS/machine/memory/memory.ts:708–718,848–849; CPP/machine/memory/memory.cpp:29–43,623–633. Region base: TS/spec/bmsx/memory_map.ts:3–4; CPP/spec/bmsx/memory_map.h:9–10.
4. Cartridge ROM: first the entire region must fit the cartridge-ROM aperture10000000H–2FFFFFFFH; then the selected physical card must contain ROM and the entire nonzero region must fit its actual ROM bytes. Starting at the first absent byte fails; exactly ending at the final installed byte succeeds. The aperture is not an installed-payload-size promise.
   Pair (aperture/dispatch): TS/machine/memory/memory.ts:715–718 + TS/machine/devices/cartridge/controller.ts:200–203; CPP/machine/memory/memory.cpp:630–633 + CPP/machine/devices/cartridge/controller.cpp:146–154.
   Pair (actual payload bounds): TS/machine/devices/cartridge/card.ts:264–273; CPP/machine/devices/cartridge/card.cpp:238–248. Aperture constants: TS/spec/bmsx/memory_map.ts:9–17; CPP/spec/bmsx/memory_map.h:15–23.
5. Other memory is not a source route: ordinary main RAM, cartridge RAM and cartridge MMIO cannot bind. This follows from the complete sample-RAM/ROM route above, not from CPU readability. CPU card reads beyond installed ROM returning zero are separate from source binding.
   CPU-read distinction pair: TS/machine/devices/cartridge/card.ts:147–151; CPP/machine/devices/cartridge/card.cpp:116–119.

## Capture, chip select and retained payload
6. CMD capture stores only the command and21 parameter words; it does not capture a cartridge socket or sample bytes. PLAY resolves selectedSlot() when executed, before installing the bank/voice. If selection changes between capture and execution, execution uses that then-current selection. Do not invent a fixed delay during which CPU code is guaranteed to change SELECT.
   Pair: TS/machine/devices/audio/command_ingress.ts:25–36 + command_fifo.ts:17–22,52–58 + command_executor.ts:146–158; CPP/machine/devices/audio/command_ingress.cpp:23–36 + command_fifo.cpp:33–39 + command_executor.cpp:107–119.
7. Selection is SELECT bit0. A SELECT store changes only the controller's selectionWord. Once bound, the voice stores the selected source byte buffer/pointer and offset; PCM/BADP reads consume that retained storage, not a fresh selectedSlot() lookup. Therefore a later SELECT store alone does not redirect a running voice. This is a direct traced read/write path, not inferred object-lifetime or hot-swap behavior.
   Pair (selection): TS/machine/devices/cartridge/controller.ts:80–85,232–234; CPP/machine/devices/cartridge/controller.h:29–34 + controller.cpp:183–190.
   Pair (retained read path): TS/machine/devices/audio/output.ts:460–466,532–546; CPP/machine/devices/audio/output.cpp:391–398,470–493. The actual ROM view is supplied by card.ts:270–273 / card.cpp:247–248 above.
8. Active source-field writes rebind using the current selection again, including writes to sample-rate/extent metadata in that source-field group. They are not an atomic staged replacement. The existing public live-programming section already explains this group and retained cursor/history effects.
   Pair: TS/machine/devices/audio/source.ts:47–61 + command_executor.ts:201–225; CPP/machine/devices/audio/source.h:19–28 + command_executor.cpp:162–184.

## Failure and format boundaries
9. Failed PLAY binding raises SOURCE_RANGE=00000102H with SOURCE_ADDR as detail, returning before changing old bank/activity/output state. Failed live rebind differs: bank word has already been written, output is stopped and the slot deactivated without clearing that bank.
   Pair: TS/machine/devices/audio/command_executor.ts:152–158,201–211; CPP/machine/devices/audio/command_executor.cpp:113–119,162–172. Fault constant: TS/spec/audio/apu.ts:71; CPP/spec/audio/apu.h:78.
10. Binding is storage-region admission, not format validation. Any nonzero GENERATOR_KIND bypasses binding (defined generator remains kind1). SOURCE_DATA_BYTES is not a per-read bound; SOURCE_BYTES constrains binding, not subsequent decoder accesses. Metadata is copied directly; no sample-rate/channel/frame/data-offset/bit-depth admission checks occur in PLAY.
   Pair: TS/machine/devices/audio/source.ts:28–44 + command_executor.ts:146–158,228–236 + output.ts:460–480,532–546; CPP/machine/devices/audio/source.cpp:5–17 + source.h:15–17 + command_executor.cpp:107–119,187–193 + output.cpp:383–398,470–493.

## Scope limits

No socket removal, hot replacement, electrical fetch timing or analog guarantee
was established. Existing descriptor metadata, SOURCE_DATA_BYTES, generator,
failed-PLAY and live-write caveats remain part of the public contract. Tests of
queued selection use explicit device service and a simplified component clock;
they do not establish a guaranteed CPU instruction window before PLAY executes.
