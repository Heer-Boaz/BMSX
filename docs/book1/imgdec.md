# Image decompression unit {#sec-imgdec}

## Outline {#sec-imgdec-function-and-resources}

The image decompression unit (IMGDEC) expands compressed data into 32-bit
words. It is used for images, palettes, animation frames and other data stored
compressed in ROM. The compression is lossless.

Compressed words are written to the DATA register and decoded words are read
from the same register. Normally one DMA channel feeds the compressed data in
and another carries the decoded words out, to RAM or directly to the GPU. IMGDEC
produces only the pixel data; the program sends the GPU image header itself.

| Item | Specification |
|---|---|
| Data unit | 32-bit word |
| Input FIFO | 256 words |
| Output block | 256 words |
| History | Last 4096 decoded words |
| Decoding speed | 2 cycles per word (33,868,800 Hz clock) |
| Interrupt | IRQ_IMGDEC (done or fault) |

## Function {#sec-imgdec-from-compressed-patterns-to-upload-words}

The compressed data consists of four kinds of tokens:

- **Literal:** the following words are copied to the output.
- **Repeat:** the following word is output a number of times.
- **Back-reference:** earlier output words are copied again.
- **Zero:** a number of zero words is output.

For example, with A = `11112222H`, B = `33334444H` and R = `55556666H`:

| Token | Output | Total output |
|---|---|---:|
| Literal, length 2, then A and B | A, B | 2 |
| Repeat, length 2, then R | R, R | 4 |
| Back-reference, length 4, distance 4 | A, B, R, R | 8 |
| Zero, length 4 | 0, 0, 0, 0 | 12 |

The compressed data is:

```text
00000001H 11112222H 33334444H
40000001H 55556666H
80001003H
C0000003H
```

For this data, set INPUT_WORD_COUNT to 7 and OUTPUT_WORD_COUNT to 12. The
data has no header or end mark; the two counts define its length.

## Token format {#sec-imgdec-compressed-word-stream}

Words are stored little-endian. Bits 31–30 of a token select its kind.

### Tokens {#sec-imgdec-token-layouts}

| Kind | Bits 31–30 | Bits 29–0 | Followed by |
|---|---|---|---|
| Literal | `00` | Length − 1 | Length words |
| Repeat | `01` | Length − 1 | 1 word |
| Back-reference | `10` | Bits 29–12: length − 3; bits 11–0: distance − 1 | — |
| Zero | `11` | Length − 1 | — |

| Kind | Length | Distance |
|---|---|---|
| Literal, repeat, zero | 1 to 2^30^ words | — |
| Back-reference | 3 to 262,146 words | 1 to 4096 words |

INPUT_WORD_COUNT counts the tokens and the words that follow them.
OUTPUT_WORD_COUNT counts the decoded words.

### History {#sec-imgdec-history-and-overlapping-references}

IMGDEC remembers the last 4096 words it has output. A back-reference copies
words from this history, starting the given distance back. The history is
cleared at START, so a back-reference may only reach words already output.

A back-reference may be longer than its distance: it then repeats the words it
is producing. Distance 1 repeats the last word; distance 2 with length 6
repeats the last two words three times.

## Data transfer {#sec-imgdec-data-transfer-and-completion}

IMGDEC decodes in blocks of 256 words (the last block may be shorter). It
starts a block when it has received enough input for it and the previous
block has been read out completely. Decoding a block of N words takes 2N
cycles. The block can then be read; DECODED_WORD_COUNT increases by N.

IMGDEC requests DMA as follows:

| Request | Active when |
|---|---|
| Input (TO_IMGDEC) | The input FIFO has room and more input is expected |
| Output (FROM_IMGDEC, IMGDEC_TO_GPU) | A decoded block has words left to read |

Start the output transfer before or together with the input transfer. If only
the input is started, decoding stops when the first block is waiting to be
read, and the input transfer waits for room in the FIFO.

The output may be read in several parts. For instance, the program can read
the image words of a block to the GPU, send a palette header, and then read
the remaining words of the same block as the palette.

### Completion and faults

DONE is set when all input has been received and all output has been read.
IMGDEC then requests IRQ_IMGDEC. A job with both counts 0 is done at once.

FORMAT_FAULT is set, and IRQ_IMGDEC requested, when:

- a token produces more words than OUTPUT_WORD_COUNT still allows;
- a back-reference reaches before the start of the history;
- the input ends before all output has been produced;
- input remains after all output has been produced.

The block in progress is discarded; words already read are not affected. A
DMA channel still waiting for output then remains BUSY: stop it with STOP
before starting again.

DONE means that IMGDEC has delivered all words. Wait for DMA DONE before using
data written to RAM, and for GPU completion before using an uploaded image.

## Programming example {#sec-imgdec-programming-imgdec-in-blua}

This example uploads a 2 × 2 image to VRAM position (0, 0). The compressed data
is one literal token followed by two words of pixels.

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
*gp1 = 0x04000002                 -- GPU DMA direction: CPU_TO_GP0.
*gp0 = 0xa0000000                 -- Image upload header:
*gp0 = 0                          --   position (0, 0)
*gp0 = 0x00020002                 --   size 2 × 2
*input_count = 3
*output_count = 2

dma1[2] = 2                       -- Channel 1: 2 words,
dma1[3] = 5                       --   IMGDEC_TO_GPU.
dma1[5] = 1                       --   START

dma0[0] = stream                  -- Channel 0: from stream,
dma0[2] = 3                       --   3 words,
dma0[3] = 3                       --   TO_IMGDEC.
dma0[5] = 1                       --   START
*control = 1                      -- IMGDEC START
while (*status & 1) ~= 0 do end
if (*status & 2) == 0 then error('image decode fault') end
while (dma0[4] & 1) ~= 0 or (dma1[4] & 1) ~= 0 do end

*gp0 = 0x1f000000                 -- GPU marker.
while (*irq_flags & 0x40) == 0 do end
*gp1 = 0x02000000
*irq_ack = 0x000001c1
```

The low halfword of each word is the first pixel, so the image receives the
pixels `001FH`, `03E0H`, `7C00H`, `7FFFH`. Make sure that OUTPUT_WORD_COUNT
matches the size in the GPU header; IMGDEC does not check this.

When the same compressed data also holds a palette, set channel 1's count to
the number of image words. When that transfer is DONE, send the palette
header to the GPU and start channel 1 again for the palette words. Channel 0
and IMGDEC keep running, and the palette may refer to the image words in the
history.

## Registers {#sec-imgdec-register-reference}

| Address | Name | Access | Function |
|---|---|---|---|
| `080103FCH` | INPUT_WORD_COUNT | R/W | Number of compressed words |
| `08010400H` | OUTPUT_WORD_COUNT | R/W | Number of decoded words |
| `0801040CH` | CONTROL | R/W | Bit 0: START |
| `08010410H` | STATUS | R | Status |
| `08010414H` | DATA | R/W | Write: compressed input; read: decoded output |
| `08010418H` | INPUT_WORDS_RECEIVED | R | Number of words written to DATA |
| `0801041CH` | DECODED_WORD_COUNT | R | Number of words decoded |

`08010404H` and `08010408H` are reserved. All registers are 0 after reset.

Set both counts before START. While a job is running, writes to the counts and
to CONTROL wait until it ends. START clears the FIFO, the history and the two
progress counters and starts a new job. Writing a read-only register causes a
READ_ONLY bus fault.

### STATUS {#sec-imgdec-status-0x08010410}

| Bit | Value | Name | Meaning |
|---|---|---|---|
| 0 | `00000001H` | BUSY | Job running |
| 1 | `00000002H` | DONE | All input received and all output read |
| 2 | `00000004H` | INPUT_REQUEST | DATA can take input |
| 3 | `00000008H` | OUTPUT_REQUEST | DATA has output to read |
| 4 | `00000010H` | FORMAT_FAULT | Job stopped on a format fault |
| 31–5 | — | — | 0 |

DONE and FORMAT_FAULT stay set until the next START. Clearing IRQ_IMGDEC does
not clear them.

### DATA

Reading DATA when no output is available returns the last word read or
written and takes nothing from the output. Test OUTPUT_REQUEST in STATUS to
know whether output is available. A write to DATA waits until the FIFO has
room.

While a DMA channel is transferring on an IMGDEC route, CPU reads of DATA
return the last word without taking output, and CPU writes wait until the
transfer ends.

### Monitor entry

When the monitor is entered, IMGDEC finishes the block it is decoding and
pauses. It continues when the program resumes.
