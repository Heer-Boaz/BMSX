# Image decompression unit {#sec-imgdec}

## Function and resources {#sec-imgdec-function-and-resources}

IMGDEC expands a lossless compressed word stream into ordinary 32-bit data.
Use it for texture and palette payloads, animation frames or other word data
stored in ROM. The program supplies the compressed and decoded word counts.
The decoder does not fetch from a source address or know a VRAM destination.

DATA is bidirectional: writes supply compressed input; reads remove decoded
output. One DMA channel can feed input from ROM or RAM while another drains
output to RAM or a receiving device. For an image upload, the program sends
the GPU command header and then routes decoded pixel words to GP0. The GPU,
not IMGDEC, interprets the image dimensions and writes VRAM.

| Resource | Specification |
|---|---|
| Register and stream word | 32 bits; counts are words, not bytes |
| Input FIFO | 256 words |
| Output work block | 256 words; also the readable result storage |
| History | Last 4096 decoded words |
| Completion timebase | 33,868,800 system cycles per second |
| Decode interval | Two system cycles per word in the output block |

There is one output block, not a second queue of completed blocks. Input may
accumulate while that block is decoding or being read. The next output block
cannot replace it until its last word has been removed.

## From compressed patterns to raw words {#sec-imgdec-from-compressed-patterns-to-upload-words}

A literal copies supplied words, a repeat emits one supplied value several
times, a back-reference copies earlier decoded words, and a zero run emits
zero words. These operations have no pixel or palette interpretation.

For example, let A be `11112222H`, B be `33334444H`, and R be `55556666H`:

| Operation | Decoded words | Words produced so far |
|---|---|---:|
| Literal length 2, followed by A and B | A, B | 2 |
| Repeat length 2, followed by R | R, R | 4 |
| Back-reference length 4, distance 4 | A, B, R, R | 8 |
| Zero length 4 | 0, 0, 0, 0 | 12 |

The complete input is:

```text
00000001H 11112222H 33334444H
40000001H 55556666H
80001003H
C0000003H
```

Program INPUT_WORD_COUNT=7 and OUTPUT_WORD_COUNT=12. No stream header, magic
word, image-size record or end token is present. The output is exactly twelve
words; no GPU command words are inserted. Its single short block becomes
readable 24 cycles after the input needed to assemble it has been accepted.
Input transport and output transport have their own bus costs.

## Compressed word stream {#sec-imgdec-compressed-word-stream}

A stream consists only of tokens and their following data words. Store each
word little-endian: `11112222H` has bytes `22H 22H 11H 11H` at increasing
addresses. This is data order, not CPU instruction encoding.

Bits 31:30 select the token operation. A token and all of its data words count
toward INPUT_WORD_COUNT; only reconstructed words count toward
OUTPUT_WORD_COUNT and DECODED_WORD_COUNT.

### Token layouts {#sec-imgdec-token-layouts}

| Kind | Bits 31:30 | Remaining fields | Following input |
|---|---|---|---|
| Literal | `00` | Bits 29:0: length minus 1 | That many literal words |
| Repeat | `01` | Bits 29:0: length minus 1 | One word to repeat |
| Back-reference | `10` | Bits 29:12: length minus 3; bits 11:0: distance minus 1 | None |
| Zero | `11` | Bits 29:0: length minus 1 | None |

Literal, repeat and zero lengths range from 1 to 1,073,741,824 words.
Back-reference lengths range from 3 to 262,146 words; distances range from
1 to 4096 words. A run may cross output-block boundaries. It must not extend
past the programmed decoded count.

### History and overlapping references {#sec-imgdec-history-and-overlapping-references}

Every decoded word enters history, including zeros and literal words.
History starts empty at START and retains at most 4096 words. A reference
cannot use a distance greater than the history already available at that point.

Each reference word is read relative to the current history write position,
then the produced word advances that position. A run can therefore use words
it has just produced. Distance 1 repeats the last word; a run longer than its
distance repeats the preceding pattern. Wrapping the history storage does not
reset it or change these distances.

History remains continuous across output blocks and across any image/palette
boundary imposed by the program. An output word that happens to resemble a
GPU opcode is still ordinary decompressed data.

## Block timing and flow control {#sec-imgdec-data-transfer-and-completion}

IMGDEC assembles the next block from available input. Its length is the
smaller of 256 and the number of decoded words still required. Incomplete
literal input or a missing repeat value holds assembly; it does not publish
a short intermediate result. Token boundaries do not create additional
readable blocks.

When assembly is complete and the previous result has drained, a block of N
words enters its 2N-cycle decode interval. Until its completion edge, DATA
cannot remove those words, OUTPUT_REQUEST is clear and DECODED_WORD_COUNT
excludes them. At completion, the whole block becomes readable and the decoded
count advances by N. There is no independently observable per-word progress
inside that interval.

For the final block, the complete declared input must also have arrived and
been consumed with no unfinished run or trailing token. That block is not
published while further declared input is still outstanding.

The request conditions are:

| Request | Condition |
|---|---|
| INPUT_REQUEST / IMGDEC_WRITE | BUSY, no system pause, input count not yet reached, and free input storage |
| OUTPUT_REQUEST / IMGDEC_READ | BUSY, no system pause, and unread words in a completed output block |

DMA may shorten a burst at an endpoint's available-word boundary. A program can
therefore drain a texture subrange, submit its own CLUT header and continue
reading the same result block; no padding, extra token or decoder restart is
needed. The DMA count still describes the exact number of words to transport.

Establish the output consumer before waiting for input DMA to finish. Otherwise
a completed result can hold decoding, input can fill, and both sides can wait
without any malformed input. Output backpressure does not drop words or
implicitly complete the job.

### Completion and faults

DONE is published after the final output word has been read and all declared
input has been consumed. A zero-input, zero-output job completes immediately.
Both normal completion and FORMAT_FAULT raise IRQ_IMGDEC; test STATUS to
distinguish them. A terminal result replaces BUSY and the request bits.

FORMAT_FAULT stops the current job when a run exceeds the remaining decoded
count, a reference uses unavailable history, declared input ends before the
required output can be assembled, or input remains after the required output
has been reconstructed. Unpublished work in the current block is discarded.
Previously drained output is not retracted. A separately admitted DMA burst
is not cancelled or rolled back by a decoder fault.

A fault can leave an output DMA channel waiting. Its BUSY state is not a reason
to continue waiting for successful decoding. Service the fault before reusing
the transfer resources. A new accepted START clears the decoder's stream
state; it does not cancel an independently programmed DMA channel or undo a
GPU command that has already received data.

IMGDEC DONE, DMA DONE and GPU completion are different events. In a DATA-to-RAM
transfer, the final DATA read occurs before the destination write. Observe DMA
completion before using that RAM result. In an upload, observe GPU completion
before using the new image and display publication before relying on its
appearance on screen.

## Programming IMGDEC in BLua {#sec-imgdec-programming-imgdec-in-blua}

This example uploads a two-by-two direct-color image at VRAM origin. It assumes
fresh BIOS cartridge entry, no other GP0 producer and both DMA channels idle.
The source is three compressed ROM words: one literal token and two raw data
words. GPU size and destination words are not IMGDEC configuration.

```lua
rodata stream: word[3] = { 1, 0x03e0001f, 0x7fff7c00 }
local irq_flags<const>: *word = 0x08000000
local irq_ack<const>: *word = 0x08000004
local irq_mask<const>: *word = 0x08000008
local dma0<const>: *word = 0x0800000c
local dma1<const>: *word = 0x080103e4
local input_count<const>: *word = 0x080103fc
local output_count<const>: *word = 0x08010400
local control<const>: *word = 0x0801040c
local status<const>: *word = 0x08010410
local gp0<const>: *word = 0x0801023c
local gp1<const>: *word = 0x08010240

*irq_mask = 0
*irq_ack = 0x000001c1
*gp1 = 0x04000002                 -- DMA direction CPU_TO_GP0.
*gp0 = 0xa0000000                 -- Software supplies the image header.
*gp0 = 0
*gp0 = 0x00020002
*input_count = 3
*output_count = 2

dma1[0] = 0x08010414              -- Fixed decoder DATA source.
dma1[1] = 0x0801023c              -- Fixed GP0 destination.
dma1[2] = 2                       -- Raw output only; no header words.
dma1[3] = 0x0003fc58              -- IMGDEC_READ/GX_WRITE, up to 256 words.
dma1[5] = 1

dma0[0] = stream
dma0[1] = 0x08010414
dma0[2] = 3
dma0[3] = 0x0003fd41              -- Increment source, IMGDEC_WRITE.
dma0[5] = 1
*control = 1
while (*status & 1) ~= 0 do end
if (*status & 2) == 0 then error('image decode fault') end
while (dma0[4] & 1) ~= 0 or (dma1[4] & 1) ~= 0 do end

*gp0 = 0x1f000000                 -- Ordered GPU completion marker.
while (*irq_flags & 0x40) == 0 do end
*gp1 = 0x02000000
*irq_ack = 0x000001c1
```

The low pixel halfword precedes the high halfword, so the image receives
`001FH,03E0H,7C00H,7FFFH`. GP0's own transfer dimensions determine its payload
length. IMGDEC does not check whether OUTPUT_WORD_COUNT agrees with a GPU
packet; the program is responsible for that connection.

For palette data in the same compressed stream, stop the first output DMA at
the exact texture-word count, wait for that DMA to complete, send the three-word
CLUT upload header, and start the remaining output transfer. Keep input DMA
and IMGDEC running. The palette words share the same decompression history.

## Register reference {#sec-imgdec-register-reference}

All ports are 32-bit word ports. Unassigned locations `08010404H` and
`08010408H` are ordinary retained I/O words with no decompression function.

| Address | Name | Access | Reset | Function |
|---|---|---|---|---|
| `080103FCH` | INPUT_WORD_COUNT | R/W configuration | 0 | Total compressed token and data words |
| `08010400H` | OUTPUT_WORD_COUNT | R/W configuration | 0 | Total raw decoded words |
| `0801040CH` | CONTROL | R/W configuration | 0 | Bit 0 START; bits 31:1 retained |
| `08010410H` | STATUS | R | 0 | Job and request state |
| `08010414H` | DATA | R/W | 0 | Compressed input writes and raw output reads |
| `08010418H` | INPUT_WORDS_RECEIVED | R | 0 | Accepted input DATA writes |
| `0801041CH` | DECODED_WORD_COUNT | R | 0 | Words in completed decode blocks |

Configuration retains complete raw words. Program both counts before START.
Configuration writes are admitted only while inactive and not paused; CPU
writes wait otherwise. An accepted CONTROL write retains its complete word;
START clears only bit 0, resets FIFO/history/block state and progress, and
starts the new job. CONTROL has no ABORT bit.

Writes to the three read-only ports raise BUS_FAULT_READ_ONLY. Progress reads
do not drain DATA or acknowledge an interrupt. INPUT_WORDS_RECEIVED measures
submissions, not FIFO occupancy or consumed compressed words.

### STATUS fields {#sec-imgdec-status-0x08010410}

| Bit | Mask | Name | Meaning |
|---|---|---|---|
| 0 | `00000001H` | BUSY | Job active |
| 1 | `00000002H` | DONE | Complete input processed and output drained |
| 2 | `00000004H` | INPUT_REQUEST | Input can accept more words |
| 3 | `00000008H` | OUTPUT_REQUEST | Completed output words can be removed |
| 4 | `00000010H` | FORMAT_FAULT | Job stopped on a stream-format fault |
| 31:5 | `FFFFFFE0H` | Unused | Zero |

STATUS is not write-one-to-clear. A new START replaces the terminal result;
central IRQ acknowledgement does not clear STATUS.

### DATA latch and system pause

An output read replaces the DATA latch with the removed word. Input writes
also replace this latch. A read without completed output returns the latch
without advancing output. So does a CPU read while a DMA channel owns the DATA
read port. Poll STATUS, not DATA, for readiness.

Ordinary CPU writes wait for active input capacity and for release of any DMA
write-port reservation. A forced DMA write still presents its word and advances
the submission counter; only words that fit enter the input FIFO. It is not a
way to bypass the compressed-stream protocol. Submission counters use modulo
2^32 arithmetic, including such forced accesses.

A system pause stops new input and output requests. An admitted decode block
first reaches its completion edge; partly assembled input or unread results
remain retained. Pause does not drain the cartridge's output or manufacture
missing input. Resume continues the retained work.
