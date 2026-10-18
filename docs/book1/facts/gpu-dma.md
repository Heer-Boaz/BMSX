# Frozen GPU image DMA facts

## Paired owner facts for the image-transfer route

| Fact | Actual TS owner / leaf | Actual C++ owner / leaf |
|---|---|---|
| GP0 A0–BF upload, C0–DF readback; payload dimensions normalize to 1…1024 × 1…512 | machine/ts/spec/gx/gp0.ts:19–22,57–60,95–100 | machine/cpp/spec/gx/gp0.h:26–29,59–62,97–103 |
| Command FIFO 16 words and separate DMA ingress 16 words; GP1 direction 2=CPU→GP0, 3=GPUREAD→CPU | machine/ts/spec/gx/gp0.ts:33–42 | machine/cpp/spec/gx/gp0.h:35–44 |
| GP1 DMA-direction opcode 04 | machine/ts/spec/gx/gp1.ts:5 | machine/cpp/spec/gx/gp1.h:11 |
| X period 1024, actual local-memory word count 1024×1024, Y gate 9 or 10 bits | machine/ts/spec/gx/vram.ts:1–12 | machine/cpp/spec/gx/vram.h:9–21 |
| DMA GP0 writes stage before BLOCK_END; at final block word synchronize due work and process pipeline | machine/ts/machine/devices/gx/gpu.ts:1034–1059 | machine/cpp/machine/devices/gx/gpu.cpp:551–576 |
| Pipeline drains staged DMA words into ordinary ingress; parser pauses behind pending command/readback barrier | machine/ts/machine/devices/gx/gpu.ts:1135–1158 | machine/cpp/machine/devices/gx/gpu.cpp:653–668,720–726 |
| A0 payload count=(width×height+1)>>1; counted last consumed payload emits retained upload command | machine/ts/machine/devices/gx/gpu.ts:1805–1812,1652–1660,1675–1680 | machine/cpp/machine/devices/gx/gpu.cpp:1285–1293,1130–1138,1152–1158 |
| CPU GPUREAD consumes READY only without DMA read ownership; DMA reads consume; otherwise return retained latch | machine/ts/machine/devices/gx/gpu.ts:1019–1031 | machine/cpp/machine/devices/gx/gpu.cpp:536–548 |
| GP1 direction 3 enables readback DMA request, leaving 3 disables it; merely programming direction is not channel START | machine/ts/machine/devices/gx/gpu.ts:1862–1875 | machine/cpp/machine/devices/gx/gpu.cpp:1340–1353 |
| GPUSTAT 28 is packet acceptance; 27 READY; 26 idle requires no pending deadline/FIFO/partial packet/image/polyline/readback. GPUSTAT 25 directions 1/2 use ingress/packet conditions; 3 uses READY | machine/ts/machine/devices/gx/gpu.ts:1878–1962 | machine/cpp/machine/devices/gx/gpu.cpp:1356–1437 |
| CPU write admission is one FIFO slot free plus no DMA write ownership, not GPUSTAT 28 | machine/ts/machine/devices/gx/gpu.ts:2025–2034 | machine/cpp/machine/devices/gx/gpu.cpp:1499–1508 |
| readback activation pending, claimed only at exact fence, matching completion publishes READY | machine/ts/machine/devices/gx/gpu_command_buffer.ts:120–159 | machine/cpp/machine/devices/gx/gpu_command_buffer.h:88–101,131–141 |
| Readback packs low then high pixels, final odd high half zero; last word resets phase IDLE and request; GX_READ only enabled + READY | machine/ts/machine/devices/gx/gpu_command_buffer.ts:163–192 | machine/cpp/machine/devices/gx/gpu_command_buffer.h:107–159 |
| DMA owns selected endpoint while channel BUSY, even before a block is admitted | machine/ts/machine/devices/dma/controller.ts:180–200 | machine/cpp/machine/devices/dma/controller.cpp:110–130 |
| START marks BUSY; zero COUNT finishes; START written while BUSY does not restart | machine/ts/machine/devices/dma/controller.ts:131–143 | machine/cpp/machine/devices/dma/controller.cpp:60–73 |
| At block service every captured word is transferred; BLOCK_END only on last; address and count words published after block, then finish/arbitrate | machine/ts/machine/devices/dma/controller.ts:211–253 | machine/cpp/machine/devices/dma/controller.cpp:141–183 |
| Block size = min(remaining,((CONTROL>>10)&15)+1); admitted addresses/count/control captured | machine/ts/machine/devices/dma/controller.ts:412–470 | machine/cpp/machine/devices/dma/controller.cpp:336–394 |
| Requests sampled at admission; read AND write selectors. FORCE 0 always, Disabled 15 never | machine/ts/machine/devices/dma/controller.ts:394–406,487–501 | machine/cpp/machine/devices/dma/controller.cpp:318–330,412–426 |
| CONTROL: read increment bit 0, write increment bit 1, read request 5:2, write request 9:6, block minus 1 bits 13:10; GX_WRITE 1, GX_READ 2; STATUS BUSY 1, DONE 2, START 1 | machine/ts/spec/bmsx/io.ts:374–397 | machine/cpp/spec/bmsx/io.h:387–410 |

Derived controls: RAM→fixed GP0, 16-word blocks, GX_WRITE = `0x00003c41`;
fixed GPUREAD→RAM, 16-word blocks, GX_READ = `0x00003c0a`. These are derived
constants, not new device fields. Exact addresses and installed timing were
checked separately below and in `../reviews/gpu-dma-source.md`.

## Installed timing and literal addresses

- GP0/GPUREAD `0801023c`; GP1/GPUSTAT `08010240`. DMA0 READ `0800000c`, WRITE
  `08000010`, COUNT `08000014`, CONTROL `08000018`, STATUS `0800001c`, TRIGGER
  `08000020`. TS `machine/ts/spec/bmsx/io.ts:3–18,172–173,218–224` and
  `machine/ts/spec/bmsx/memory_map.ts` IO_BASE/word-size producers; paired C++
  `machine/cpp/spec/bmsx/io.h` and `memory_map.h`.
- Installed RAM side: one cycle/word plus one/burst. I/O side: zero. These
  distinct-region transfers use the maximum side charge. TS
  `machine/ts/spec/bmsx/model.ts:7–12`,
  `machine/ts/machine/devices/dma/controller.ts:414–485`; C++
  `machine/cpp/spec/bmsx/model.h:12–17`,
  `machine/cpp/machine/devices/dma/controller.cpp:336–409`.
- Derived admitted charges: 44 RAM→GP0 words in 16+16+12 cost 17+17+13=47 cycles;
  41 READY GPUREAD→RAM words in 16+16+9 cost 17+17+10=44 cycles. This excludes
  CPU preparation, request waits, other channels, readback preparation and
  display. It is not an end-to-end measurement. Sources: preceding paired
  timing/controller row; actual injected model fields are also checked in
  `machine/ts/machine/machine.ts:98–105` and C++ `machine.cpp:41–48`.

## Authored finite data set

The literal producers are `carts/gpu_dma_manual/{storage,cart}.lua`.

- Initialized RAM `data upload: word[44]` starts `A0000000,00400060,00090009`:
  raw destination(96,64), 9×9=81 sixteen-bit pixels. Payload values 1…81 are
  packed continuously low first; first `00020001`, final `FFFF0051`. Final high
  FFFF is unused, not another pixel or command. Source occupies 176 bytes.
- Explicit BSS `returned: word[41]` occupies 164 bytes. Same C0 coordinates and
  dimensions, followed by queued marker `1F000000`. Expected first `00020001`,
  word4 (zero-based) `000A0009` across the first odd row boundary, word39
  `0050004F`, final `00000051`.
- Program owns DMA0 and GPU ports, masks interrupts and polls. It waits for
  upload DONE, then a separately issued ordered marker and idle, acknowledging
  GPU and controller separately. Then C0+marker, READY, and read DMA. The
  deliberate CPU read under BUSY DMA ownership retains the latch. No PCRTC
  programming or displayed-picture claim follows from this storage roundtrip.

## Actual ordinary cartridge acceptance

Normal `gpu_dma_manual` cartridge integration case `raw_image_roundtrip` passes
following product/BIOS/cart builds. Static counts use `#storage.upload` and
`#storage.returned`, not runtime length of numeric typed-local addresses.
All first40 returned words equal the payload; final is `00000051`, not source
`FFFF0051`. Both DMA transfers finish at COUNT0/STATUS2, with
+176/+164-byte moving endpoints and fixed GP0. READY is set with marker/idle
clear before read DMA; immediate BUSY is1 and CPU GPUREAD retains its earlier
latch. READY clears after drain; marker and idle are checked separately.
Source: `tests/carts/gpu_dma_manual/gpu_dma_manual_assert.lua` and the two
literal producer modules above. This is ordinary TS guest evidence, not
native/display/electrical proof. Independent source and separate actual
software-VRAM replay evidence are retained in `../reviews/gpu-dma-source.md`.
