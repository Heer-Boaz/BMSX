# Direct memory access {#sec-dma}

DMA moves ordered 32-bit words without executing one CPU instruction per word.
Use it to copy storage, feed GPU commands and image data, collect GPU readback,
or supply and drain the image decoder and audio transfer port. DMA delivers
words; each receiving unit interprets them and completes its own work.

The controller has two equivalent channels and one shared burst engine. A
channel waiting for a device request does not stop the other channel or the
CPU. An admitted burst owns the CPU bus until its completion. Device clocks
continue during that interval; interrupt entry waits until the CPU can resume.

## Resources and routes {#sec-dma-dma-specifications}

| Resource | Specification |
|---|---|
| Channels | Two, numbered 0 and 1 |
| Register interface | Six 32-bit word ports per channel |
| Transfer word | Four bytes, little-endian |
| Address and remaining count | Unsigned 32-bit words; byte addresses and word counts |
| Maximum burst | 256 words, shortened by endpoint capacity and memory-region boundaries |
| Shared engine | One admitted burst across both channels |
| Configuration | One registerfile per channel; configuration writes disabled while BUSY |
| Completion requests | IRQ_DMA0_DONE and IRQ_DMA1_DONE |
| Timebase | 33,868,800 system cycles per second |

Choose what to connect with CONTROL's ROUTE field. Memory endpoints advance by
four bytes per word. Device endpoints are wired ports: the program does not
supply their addresses or separate request selectors.

| ROUTE | Source | Destination | Programmed addresses |
|---:|---|---|---|
| 0 COPY | Memory | Memory | READ_ADDR and WRITE_ADDR |
| 1 TO_GPU | Memory | GPU GP0 | READ_ADDR |
| 2 FROM_GPU | GPU GPUREAD | Memory | WRITE_ADDR |
| 3 TO_IMGDEC | Memory | IMGDEC DATA input | READ_ADDR |
| 4 FROM_IMGDEC | IMGDEC DATA output | Memory | WRITE_ADDR |
| 5 IMGDEC_TO_GPU | IMGDEC DATA output | GPU GP0 | Neither |
| 6 TO_APU | Memory | APU transfer DATA input | READ_ADDR |
| 7 FROM_APU | APU transfer DATA output | Memory | WRITE_ADDR |

Memory endpoints access system ROM, main RAM and the selected cartridge's ROM,
RAM or mapped devices through the normal memory map. They cannot access the
console's internal I/O aperture. An internal I/O address on a memory endpoint
causes an unmapped-access bus fault, not a register operation. Device routes
are the only DMA connections to the listed internal ports.

An address register unused by the selected route retains its raw word and does
not advance. For example, WRITE_ADDR does not determine the destination of
TO_GPU, even if it contains another port address. All eight ROUTE values have
a defined connection.

![Two registerfiles share a bounded word-transfer engine](figures/dma-transfer.svg){#fig-dma-transfer}

## Follow a buffer through a transfer {#sec-dma-follow-a-buffer-through-a-transfer}

A twenty-word array occupies 80 bytes. To copy it, set READ_ADDR to its first
byte address S, WRITE_ADDR to destination D, TRANSFER_COUNT to 20 and ROUTE to
COPY. There is no increment switch or programmed burst length.

| Word transferred | Source byte address | Destination byte address |
|---|---|---|
| First | S | D |
| Second | S + 4 | D + 4 |
| Twentieth | S + 76 | D + 76 |

When the complete array lies within its source and destination regions, it
fits in one burst. At completion the addresses are S+80 and D+80, count is zero,
STATUS is DONE and the channel requests its completion interrupt. Programming
80 as the count would request 320 bytes, not this array.

### Source reuse and result use {#sec-dma-source-reuse-and-result-use}

START does not copy the source payload into private storage. Keep the source
stable until DMA completes, including writes initiated through another device.
The CPU cannot modify it during an admitted burst, but may execute while a job
is waiting for requests between bursts.

DMA reads each source word before writing its corresponding destination word.
Overlapping COPY regions therefore use forward word order, not a snapshot
copy. If the first source word is A and WRITE_ADDR=READ_ADDR+4, each subsequent
source read can see the preceding write; a three-word transfer propagates A
through all three destinations.

DMA DONE permits source reuse and memory-result use. It does not establish that
a GPU upload has finished drawing, that an APU FIFO has reached sample RAM, or
that PCRTC has published the new picture. Observe the receiving device's own
completion boundary for those operations.

## Programming a transfer {#sec-dma-program-a-transfer}

1. Obtain an idle channel and exclusive use of its receiving port or buffer.
2. Select the route and program only its memory-side addresses.
3. Program the exact word count and the cartridge socket bits when needed.
4. Prepare the device's command, transfer mode and request conditions.
5. Clear only this owner's old IRQ pending bit if IRQ polling is used, then
   write START.
6. Observe DMA DONE before reusing storage. Observe device completion separately.

START with a nonzero count sets BUSY immediately. A low device request can leave
BUSY set without any burst admitted. START while BUSY has no effect. A zero
count completes synchronously, even if the selected device has no request.

### Copy words in BLua {#sec-dma-copy-words-in-blua}

This sequence assumes an idle channel 0 and ownership of its pending bit.
It uses initialized main RAM and a separate BSS destination; neither overlaps
console I/O.

```lua
local flags<const>: *word = 0x08000000
local ack<const>: *word = 0x08000004
local mask<const>: *word = 0x08000008
local dma<const>: *word = 0x0800000c
data seed: word[4] = {0x01234567, 0x89abcdef, 0x55aa33cc, 0xf00dcafe}
bss received: word[4]

*mask = 0
*ack = 1
dma[0] = seed
dma[1] = received
dma[2] = 4
dma[3] = 0                      -- COPY; both memory addresses increment.
dma[5] = 1                      -- START.
while (dma[4] & 2) == 0 do end
-- received now contains all four words; the central pending bit is also set.
*ack = 1
```

An admitted RAM copy holds CPU execution. Consequently an immediately following
CPU status read can already observe DONE; seeing BUSY from such a read is not a
condition for successful operation.

### Send a command stream to GP0 {#sec-dma-send-a-command-stream-to-gp0}

For TO_GPU, set READ_ADDR to the word stream, TRANSFER_COUNT to its length and
CONTROL to 1. Select GPU DMA direction FIFO or CPU_TO_GP0 before START. Do not
program WRITE_ADDR as a GP0 pointer: this route already has a wired destination.

GPU packet boundaries are independent of DMA burst boundaries. An image,
polygon or polyline can span bursts. GP0 retains assembly state; NOP padding
and packet alignment to 256 words are not required. A GPU IRQ marker placed
after the work gives a separate ordered completion point.

### Use both channels {#sec-dma-use-both-channels}

Each channel may hold an outstanding job. Eligible channels alternate on burst
boundaries. Prepare a waiting consumer before starting a producer: for example,
arm IMGDEC_TO_GPU on channel 1, arm TO_IMGDEC on channel 0, then start the
decoder. Its input and output requests allow the two channels to take turns.

The direct decoder-to-GPU route requires both the decoder's readable output
and GPU ingress space. It does not make IMGDEC construct GPU headers. Supply
those separately as described in the [IMGDEC reference](imgdec.md).

## Register reference {#sec-dma-register-reference}

| Register | Channel 0 address | Channel 1 address | Access | Reset |
|---|---|---|---|---:|
| READ_ADDR | `0800000CH` | `080103E4H` | R/W while inactive | 0 |
| WRITE_ADDR | `08000010H` | `080103E8H` | R/W while inactive | 0 |
| TRANSFER_COUNT | `08000014H` | `080103ECH` | R/W while inactive | 0 |
| CONTROL | `08000018H` | `080103F0H` | R/W while inactive | 0 |
| STATUS | `0800001CH` | `080103F4H` | R | 0 |
| TRIGGER | `08000020H` | `080103F8H` | W; reads zero | 0 |

All configuration words retain their complete 32-bit values. A configuration
write during BUSY is ignored, including while the channel awaits a device
request. There is no second programmable register bank for a future burst.
Stop a waiting job before reconfiguring it. Writes to STATUS raise the normal
read-only bus fault.

### CONTROL fields {#sec-dma-control-fields}

| Bits | Name | Meaning |
|---|---|---|
| 2:0 | ROUTE | Connection from the route table |
| 3 | READ_SLOT | Cartridge socket for memory-side source accesses: 0 or 1 |
| 4 | WRITE_SLOT | Cartridge socket for memory-side destination accesses: 0 or 1 |
| 31:5 | Retained | Read back unchanged; no transfer effect |

The socket bits do not depend on CPU cartridge SELECT. They are irrelevant to
system ROM, main RAM and wired internal-device endpoints. COPY from socket-0
ROM to socket-1 RAM uses CONTROL=`00000010H`; the reverse socket selection
uses `00000008H`. See [cartridge DMA](../book3/cartridge.md#sec-cartridge-dma-between-sockets).

### STATUS and TRIGGER {#sec-dma-status-and-trigger}

| STATUS bit | Name | Meaning |
|---:|---|---|
| 0 | BUSY | Job outstanding, including a request wait |
| 1 | DONE | Requested word count completed |
| 31:2 | Unused | Zero |

| TRIGGER bit | Name | Effect |
|---:|---|---|
| 0 | START | Start an inactive channel |
| 1 | STOP | Cancel a waiting job, or clear terminal status |
| 31:2 | Unused | Ignored |

STOP wins when both command bits are set. An admitted burst is uninterruptible:
trigger writes to its active channel have no effect until it completes. STOP
between bursts clears BUSY/DONE and releases port ownership, retaining the
current addresses and remaining count. It raises no completion IRQ and does
not acknowledge an older pending IRQ. TRIGGER does not retain command bits.

## Bursts, requests and ownership {#sec-dma-requests-and-device-port-ownership}

A burst is the minimum of the remaining count, 256 words, the source's available
words and the destination's free words. A memory-side region boundary can end
it earlier. Bursts are never padded to their maximum length. One job can span
many bursts or remain waiting indefinitely for a request; no polling event or
automatic timeout is created for that wait.

| Endpoint | Admission capacity |
|---|---|
| System ROM, main RAM, cartridge ROM/RAM | Up to the next region boundary |
| Cartridge mapped devices | Up to 16 words when the selected socket's directional DREQ is asserted |
| GPU GP0 | 256 words when its separate ingress buffer is empty and ingress is not paused |
| GPU GPUREAD | Remaining packed words in a ready readback stream, in GPUREAD DMA direction |
| IMGDEC input | Free input FIFO words, bounded by remaining declared input |
| IMGDEC output | Unread words in a completed output block |
| APU transfer input | 16 words when DMA-write mode has an empty transfer FIFO |
| APU transfer output | 16 words when DMA-read mode has a full transfer FIFO |

A request dropping after admission does not shorten or retract that burst.
Availability changes govern the next admission. Addresses and count describe
the start of the admitted burst until its completion edge; they then advance
together. Final zero count is published before DONE and its IRQ request.

An outstanding job owns its wired read and write ports throughout BUSY, even
between bursts. A CPU GPUREAD or IMGDEC DATA read while DMA owns that read port
returns the retained latch without consuming words. CPU writes to a reserved
port wait for release. A memory address that happens to equal a device address
does not reserve that device: it remains an invalid memory endpoint.

### Supervisor boundaries {#sec-dma-supervisor-boundaries}

System pause first closes new trigger commands while allowing existing
producer work to drain. The full DMA fence then closes burst admission and
waits for any admitted burst. Pending jobs retain their registerfiles while
the supervisor uses idle channel banks. Returning restores those pending jobs
and resumes normal admission. No decoder output is consumed merely to reach
the pause boundary.

## Completion, faults and recovery {#sec-dma-completion-and-interrupts}

Each channel has its own central pending source: channel 0 uses `00000001H`
and channel 1 uses `00000100H`. Interrupt masking does not prevent transfer or
pending-bit publication. Clear only the pending bits owned by the program.
A new START replaces the channel's DONE status but does not clear the central
pending bit from an earlier transfer.

A bus fault belongs to the memory system, not a new DMA fault register. The
admitted word pairs continue: a faulting read supplies the memory bus value,
the corresponding write is still attempted, and the address/count progression
is not rolled back. DONE is not proof that every address was valid. Use the
[bus-fault reference](memory.md) when diagnosing invalid memory endpoints.

A decoder fault or changed device mode can leave a DMA job waiting. Stop that
job before changing its configuration; then recover the device according to
its own protocol. STOP does not clear device FIFOs, undo accepted GPU words,
or cancel an APU sample-RAM batch that has already been scheduled.

## Transfer timing {#sec-dma-transfer-timing-and-sharing-the-bus}

### Calculating a burst's charge {#sec-dma-calculating-a-blocks-charge}

Source reads and destination writes use the bus serially. Each admitted burst
pays both sides' charges:

| Bus side | Charge for N words |
|---|---:|
| Main RAM | N + 1 cycles |
| System ROM | N cycles |
| Cartridge ROM, RAM or mapped devices | 8N + 4 cycles |
| Wired internal device port | N cycles |
| Faulting unmapped memory | N cycles |

The cartridge setup charge is paid for each source or destination burst,
including two separate charges when both endpoints access cartridge storage.
The first main-RAM word after the I/O aperture belongs to a new region. A
region change ends the current burst and the next burst pays its own setup.

### Transfer rates by route {#sec-dma-transfer-rates-by-route}

For one contiguous burst, the useful word rate is N × 33,868,800 divided by
its cycle charge. Multiply by four for bytes per second.

| Path | Burst charge | Charge for 256 words |
|---|---:|---:|
| RAM to RAM | 2N + 2 | 514 |
| System ROM to RAM | 2N + 1 | 513 |
| Cartridge ROM to RAM | 9N + 5 | 2309 |
| Cartridge to cartridge | 16N + 8 | 4104 |
| RAM to/from internal port | 2N + 1 | 513 |
| System ROM to internal port | 2N | 512 |
| Cartridge to/from internal port | 9N + 4 | 2308 |
| IMGDEC output to GP0 | 2N | 512 |

The 256-word column applies only when both endpoints provide that capacity.
An APU FIFO or cartridge mapped-device request instead limits its burst to
16 words. Waiting for requests, another channel, GPU execution, image decoding,
APU sample-memory service and display timing add their own intervals.

### Budgeting VRAM transfers {#sec-dma-budgeting-transfers-to-and-from-vram}

An 8×8 raw image upload has three header words and 32 payload words. From
contiguous main RAM, its 35-word TO_GPU burst costs 71 cycles; from cartridge
ROM it costs 319. A ready 32-word FROM_GPU transfer to RAM costs 65 cycles.
These are transport costs, not times to render or display the image.

For the 9×9 example in the [GPU reference](gpu.md#sec-gpu-move-a-raw-image-through-dma),
the 44-word upload costs 89 cycles from RAM and the 41-word ready readback costs
83 cycles to RAM. The odd final pixel does not require a padded extra word.
