# Audio processing unit

The APU reads sample sources, advances sixteen playback slots and produces a
left and a right sample at each output edge. A source can be uncompressed PCM,
a BADP stream, or the square generator. Each slot has its own source, cursor,
rate, gain, filter and stop state. The output is the sum of the slots, with a
single final saturation to the signed output range.

The unit is not a CPU memory window over its sample RAM, and a command write
is not an immediate change to a playing slot. Command capture, command
execution, sample-RAM transfer and output-sample generation are distinct edges.
The cartridge must choose which one it needs to observe before reusing data or
issuing dependent work.

### Installed resources

| Resource | Specification |
|---|---|
| Playback slots | 16, numbered 0–15 |
| Slot parameter banks | 21 retained 32-bit words per slot |
| Command staging bank | One separate set of 21 parameter words |
| Command FIFO | 16 commands, each retaining its command and 21 parameter words |
| Selected-slot window | 21 word ports addressing one of the sixteen slot banks |
| Private sample RAM | 512 KiB; sample-source addresses `40000000H`–`4007ffffH` |
| Sample-transfer FIFO | 16 words, 64 bytes |
| Output cadence | 44,100 stereo frames per second |
| Output components | Signed sixteen-bit left and right values |
| System-cycle timebase | 33,868,800 cycles per second; 768 cycles per output frame |
| Sample-RAM transfer budget | 1,058,400 words per second; 32 cycles per scheduled word |

These capacities are different storage: a queued command is not sample data,
and a selected-slot register window is not another payload RAM. The source
address range above is accepted in sample descriptors; ordinary CPU loads and
stores at that address do not access the private sample bytes.

![Command capture, live parameters and the per-slot sample path](figures/apu-paths.svg)

Command words carry configuration, not sample payload. The lower path reads
source data during output processing. The sample-transfer FIFO is separate
from the command FIFO; its timing and visibility are specified below.

## Commands and slot ownership

### Stage, capture, execute

Write a command's parameter words into the staging bank, then write its complete
command word to CMD. The recognized values are zero through five, not a
low-byte opcode field. For example, `00000101H` is not another spelling of PLAY.
The staging bank is shared by all slots. Complete its parameter writes and CMD
capture before another producer uses that bank.

A valid nonzero command captures **all 21 staging words** into one FIFO entry.
Subsequent staging writes cannot change that entry. Capture resets the visible
staging words to their defaults, returns CMD readback to zero and selects slot
0 for the selected-slot window. The queued command still targets its captured
slot; clearing the visible selector does not retarget it.

NONE captures nothing and leaves the staged parameters intact. An unrecognized
word records BAD_CMD and clears staging to defaults. A latched APU fault does
not itself block later valid commands.

The service edge first advances preceding audio time, then executes all queued
commands in FIFO order. It does not render an output sample between each pair
of commands merely because they occupy different FIFO entries. There is no
specified per-command elapsed-cycle charge here. Do not use a command count as
an output-sample delay.

### Preserve FIFO entries when every command matters

The FIFO retains sixteen entries. CMD_QUEUED reports its count, CMD_FREE reports
sixteen minus that count, and CMD_CAPACITY reports sixteen. With a full FIFO,
another accepted command replaces the oldest entry. It neither waits for free
space nor reports a FIFO-full fault. Use the reported space before submitting a
burst that must preserve every command.

These queue reads report queue state without advancing audio in their own read
operations. STATUS and selected-slot reads have the separate synchronization
behavior described below. Reading a count is not an acknowledgement or a
command execution request.

### Command words

| CMD word | Name | Captured inputs and operation |
|---|---|---|
| `00000000H` | NONE | No FIFO entry; staging parameters remain |
| `00000001H` | PLAY | Bind captured source, replace the target voice and copy all parameters into its bank on successful binding |
| `00000002H` | STOP_SLOT | Target SLOT and FADE_SAMPLES choose immediate stop or a sample-based fade |
| `00000003H` | SET_SLOT_GAIN | Target SLOT and GAIN_Q12 update the raw gain through the live-parameter path |
| `00000004H` | PAUSE_SLOT | Pause a non-idle slot without clearing its parameter bank |
| `00000005H` | RESUME_SLOT | Resume a paused slot without reloading its source |

PLAY and the other slot commands use bits 3:0 of captured SLOT. The complete
word remains retained data. PLAY binds at execution, not capture. A failed
source bind does not replace the old slot's parameters, phase or output; it
records SOURCE_RANGE with the source address as detail.

STOP_SLOT with zero fade, or with an inactive target, clears the target bank and
stops it immediately. This immediate explicit stop does **not** produce a
slot-ended event. A nonzero fade of an active slot instead retains its bank
while fading. Pause and resume do not clear it. SET_SLOT_GAIN can also retain a
gain word in an inactive bank; that write does not start playback.

### The selected-slot window is a live bank, not another staging bank

Write staging SLOT to select one bank through its low four bits. Only that
staging write immediately changes selection; the other staging parameter
writes merely prepare a later command. The selected window reads and writes
the bank itself, after synchronizing preceding output to the access cycle.
A live write does not enqueue CMD, reset staging or activate an idle slot.

The word at selected-window index 10 is stored slot data. It is **not** the
window selector. To select a different bank, write staging SLOT at `08000148H`,
not the selected-window index-10 port at `080001bcH`.

ACTIVE_MASK bit n means slot n is non-idle. Paused and fading slots still have
active bits. STATUS.BUSY is any active slot or queued command, so it can remain
set while paused sound produces no samples. It is not TRANSFER_BUSY.
SELECTED_SOURCE_ADDR is the selected bank's original source address while that
slot is active, otherwise zero. It is not the moving playback cursor.

Every active source-field write can rebind that voice independently, using the
other words currently in its bank. Several source writes are not an atomic
source replacement. The source/playback sections specify the resulting cursor,
filter and binding effects. Use captured PLAY when a new source description
must be supplied together rather than assembled through intermediate live states.

## Register reference

The APU exposes sixty distinct word ports: 21 staging words, 21 selected-window
words and eighteen command/status/event/transfer/fault ports. Fault ports are
not adjacent to the main bank. All addresses below are byte addresses.

Use word accesses. STATUS, fault code/detail, event words, selected-source and
ACTIVE_MASK writes raise system READ_ONLY without mutation. Queue-counter and
SAMPLE_SEQUENCE writes are accepted but do not change their device-produced values.

### Staging and selected-window parameters

All rows below have read/write word access. The two reset columns intentionally
differ. Staging defaults are also restored after each recognized nonzero
command; reset slot banks contain zero, not a ready-to-play copy of those defaults.
The selected addresses alias the bank chosen by staging SLOT bits 3:0.

#### Source-description words

| Index | Parameter | Staging address | Selected address | Staging reset | Selected reset |
|---:|---|---|---|---|---|
|0|SOURCE_ADDR| `08000120H` | `08000194H` | `00000000H` | `00000000H` |
|1|SOURCE_BYTES| `08000124H` | `08000198H` | `00000000H` | `00000000H` |
|2|SOURCE_SAMPLE_RATE_HZ| `08000128H` | `0800019cH` | `00000000H` | `00000000H` |
|3|SOURCE_CHANNELS| `0800012cH` | `080001a0H` | `00000000H` | `00000000H` |
|4|SOURCE_BITS_PER_SAMPLE| `08000130H` | `080001a4H` | `00000000H` | `00000000H` |
|5|SOURCE_FRAME_COUNT| `08000134H` | `080001a8H` | `00000000H` | `00000000H` |
|6|SOURCE_DATA_OFFSET| `08000138H` | `080001acH` | `00000000H` | `00000000H` |
|7|SOURCE_DATA_BYTES| `0800013cH` | `080001b0H` | `00000000H` | `00000000H` |
|8|SOURCE_LOOP_START_SAMPLE| `08000140H` | `080001b4H` | `00000000H` | `00000000H` |
|9|SOURCE_LOOP_END_SAMPLE| `08000144H` | `080001b8H` | `00000000H` | `00000000H` |

#### Slot and playback words

| Index | Parameter | Staging address | Selected address | Staging reset | Selected reset |
|---:|---|---|---|---|---|
|10|SLOT| `08000148H` | `080001bcH` | `00000000H` | `00000000H` |
|11|RATE_STEP_Q16| `0800014cH` | `080001c0H` | `00010000H` | `00000000H` |
|12|GAIN_Q12| `08000150H` | `080001c4H` | `00001000H` | `00000000H` |
|13|START_SAMPLE| `08000154H` | `080001c8H` | `00000000H` | `00000000H` |
|14|FILTER_CONTROL| `08000158H` | `080001ccH` | `00000000H` | `00000000H` |
|15|FILTER_B0_B1| `0800015cH` | `080001d0H` | `00004000H` | `00000000H` |
|16|FILTER_B2_A1| `08000160H` | `080001d4H` | `00000000H` | `00000000H` |
|17|FILTER_A2| `08000164H` | `080001d8H` | `00000000H` | `00000000H` |
|18|FADE_SAMPLES| `08000168H` | `080001dcH` | `00000000H` | `00000000H` |
|19|GENERATOR_KIND| `0800016cH` | `080001e0H` | `00000000H` | `00000000H` |
|20|GENERATOR_DUTY_Q12| `08000170H` | `080001e4H` | `00000800H` | `00000000H` |

The complete parameter words are stored. Their decoded source units, signed
rate/gain formats, filter halves and live effects are specified in the following
sections. Retention is not a validation of the source data those words describe.

### Command, status, event and queue ports

| Address | Name | Access | Reset read |
|---|---|---|---|
| `08000174H` | CMD | Command write / read zero | `00000000H` |
| `08000178H` | STATUS | Read; writes fault | `00000020H` |
| `0800017cH` | EVENT_KIND | Read; writes fault | `00000000H` |
| `08000180H` | EVENT_SLOT | Read; writes fault | `00000000H` |
| `08000184H` | EVENT_SOURCE_ADDR | Read; writes fault | `00000000H` |
| `08000188H` | EVENT_SEQ | Read; writes fault | `00000000H` |
| `0800018cH` | SELECTED_SOURCE_ADDR | Read; writes fault | `00000000H` |
| `08000190H` | ACTIVE_MASK | Read; writes fault | `00000000H` |
| `080001f4H` | CMD_QUEUED | Read; writes have no queue effect | `00000000H` |
| `080001f8H` | CMD_FREE | Read; writes have no queue effect | `00000010H` |
| `080001fcH` | CMD_CAPACITY | Read; writes have no queue effect | `00000010H` |
| `08000200H` | SAMPLE_SEQUENCE | Read; writes have no clock effect | `00000000H` |

STATUS reads synchronize preceding audio to their access cycle.
SAMPLE_SEQUENCE also synchronizes and returns the low 32 bits of elapsed output
frames, even with no active slots. Event words, ACTIVE_MASK and
SELECTED_SOURCE_ADDR are retained mirrors, not read-to-clear operations.

### Transfer and fault ports

| Address | Name | Access | Reset read |
|---|---|---|---|
| `080001e8H` | TRANSFER_ADDRESS | R/W full programmed word | `00000000H` |
| `080001ecH` | TRANSFER_DATA | R/W data port | `00000000H` |
| `080001f0H` | TRANSFER_CONTROL | R/W full programmed word | `00000000H` |
| `08010218H` | FAULT_CODE | Read; writes fault | `00000000H` |
| `0801021cH` | FAULT_DETAIL | Read; writes fault | `00000000H` |
| `08010220H` | FAULT_ACK | Nonzero write acknowledges / read zero | `00000000H` |

### STATUS fields

| Bit | Name | Condition |
|---:|---|---|
| 0 | FAULT | APU first-fault latch is set |
| 1 | SELECTED_SLOT_ACTIVE | Selected slot is active |
| 2 | BUSY | Any slot active or command FIFO nonempty |
| 3–4 | Unassigned | Read zero |
| 5 | CMD_FIFO_EMPTY | No queued commands |
| 6 | CMD_FIFO_FULL | Sixteen queued commands |
| 7 | DMA_REQUEST | DMA read request OR DMA write request |
| 8 | DMA_READ_REQUEST | DMA_READ mode and full transfer FIFO |
| 9 | DMA_WRITE_REQUEST | DMA_WRITE mode and empty transfer FIFO |
| 10 | TRANSFER_BUSY | A sample-RAM transfer batch is scheduled |
| 11–31 | Unassigned | Read zero |

TRANSFER_CONTROL bits 1:0 select STOP=0, MANUAL_WRITE=1, DMA_WRITE=2 or
DMA_READ=3. Upper bits remain retained/readable but are not transfer controls.
TRANSFER_ADDRESS retains its full programmed word, while the moving internal
byte offset starts from its bits 18:2 with bits 1:0 zero. Its readback is not a
progress counter. TRANSFER_DATA reads return the existing data latch to the CPU;
DMA accesses have the distinct FIFO effects described in sample RAM transfer.

## Voice sources and their lifetime

The APU has sixteen independently indexed voices and produces 44,100 stereo output frames per second. Each output channel is a signed 16-bit sample. One slot holds one voice: PLAY on an occupied slot replaces that voice rather than adding another layer.

A source description is programmed explicitly. PCM playback does not obtain its sample rate, channel count or other metadata by parsing a container header.

| Source field | Meaning |
|---|---|
| SOURCE_ADDR | Base address of the complete bound source region |
| SOURCE_BYTES | Byte extent of that region |
| SOURCE_SAMPLE_RATE_HZ | Source rate in Hz, used with RATE_STEP_Q16 |
| SOURCE_CHANNELS | Channel count used by the decoder |
| SOURCE_BITS_PER_SAMPLE | Decoder selection: 4 for BADP, 16 for PCM16, otherwise the PCM8 branch |
| SOURCE_FRAME_COUNT | Number of source frames used for playback duration |
| SOURCE_DATA_OFFSET | Byte displacement from SOURCE_ADDR to sample or compressed-block data |
| SOURCE_DATA_BYTES | Retained data-byte metadata; not a decoder read bound |
| SOURCE_LOOP_START_SAMPLE / SOURCE_LOOP_END_SAMPLE | Source-frame loop bounds |
| GENERATOR_KIND | Zero for source-buffer playback; one for the square generator |
| GENERATOR_DUTY_Q12 | Square-generator duty threshold |

A frame contains the channel samples at one source-time position. Thus a stereo frame is two samples, not two frames. START_SAMPLE and loop bounds count frames; byte offsets count bytes.

For source-buffer playback, PLAY binds the entire region identified by SOURCE_ADDR and SOURCE_BYTES when the command executes. The cartridge selection at that execution determines the cartridge ROM slot used. Sources may reside in ROM or in the 512-KiB sample RAM beginning at 40000000H. A sample-RAM binding must have a nonzero extent and fit wholly inside sample RAM. Ordinary main RAM is not a playback source.

The voice reads the bound storage while playing; PLAY does not copy the sample payload. Keep that storage available for the voice's lifetime. PCM reads use its current contents. BADP retains its current and previous decoded frames, so changing compressed bytes does not guarantee that already-decoded samples change immediately.

A failed source binding raises SOURCE_RANGE (00000102H), with SOURCE_ADDR as fault detail. A failed PLAY leaves the previous voice and slot bank unchanged. This binding check is not metadata validation: PLAY does not reject sample rate, channel count, frame count, data offset, data-byte count or bit depth on those grounds.

**SOURCE_DATA_BYTES does not limit PCM or BADP reads.** SOURCE_BYTES bounds the region binding, not each later decode operation. Supply mutually consistent metadata and accessible header, table and sample data. A mismatch carries no promise of padding, silence, clipping or recovery.

Any nonzero GENERATOR_KIND bypasses source binding, but the defined output generator is specifically kind one. Do not use another nonzero kind as a substitute for an empty or silent source: it acquires no source-buffer binding, and no output behavior is specified here for it.

## PCM byte layouts and interpolation

PCM data starts at SOURCE_ADDR + SOURCE_DATA_OFFSET. For frame n, the first sample index is n multiplied by SOURCE_CHANNELS. Channel zero supplies left; channel one supplies right. Mono repeats its one decoded sample on both output channels.

| Format | Bytes in frame n, relative to the data start |
|---|---|
| PCM8 mono | n: mono byte |
| PCM8 stereo | 2n: left byte; 2n+1: right byte |
| PCM16 mono | 2n: low byte; 2n+1: high byte |
| PCM16 stereo | 4n, 4n+1: left low/high; 4n+2, 4n+3: right low/high |

PCM8 is unsigned offset-binary. Its decoded value is (byte minus 128) multiplied by 256. Bytes 00H, 80H, FFH and 40H therefore decode to −32768, 0, 32512 and −16384. In particular, FFH is not +32767 and 00H is not silence.

PCM16 is signed little-endian. Bytes 00H 80H mean −32768; FFH 7FH mean +32767; 00H C0H mean −16384. A stereo data sequence `00 80 FF 7F 00 00 00 C0` contains two frames: (−32768, +32767), then (0, −16384).

Playback uses linear interpolation for PCM and for decoded BADP samples. Let n be the current integer source-frame position and f its 16-bit fractional part. For either channel:

```text
sample = first + ASR16((second − first) × f)
```

Here first is frame n, second is its interpolation neighbor, and ASR16 divides by 65536 with rounding toward negative infinity. Interpolate left and right independently. With first=−10000, second=10000 and f=16384, the result is −5000. With first=1000, second=−1001 and f=32768, the difference contributes −1001, giving −1; truncation toward zero would give the wrong result.

Without a loop, the last source frame is also its own interpolation neighbor. Interpolation does not read frame SOURCE_FRAME_COUNT beyond that last frame. With a loop, a neighbor reaching or passing the loop end is replaced by the loop-start frame. For loop [4,8), position 7.5 interpolates frame 7 with frame 4, not frame 8.

For example, mono PCM16 frames [0,10000,−10000,0], a source rate of 22050 Hz and unity RATE_STEP_Q16 produce eight output samples:

```text
0, 5000, 10000, 0, −10000, −5000, 0, 0
```

The final pair is zero because the last source frame is held for interpolation until the cursor reaches the nonloop end.

## BADP compressed source format

BADP is selected by SOURCE_BITS_PER_SAMPLE=4. Its source metadata still comes from the slot fields. The decoder consumes the following header words relative to SOURCE_ADDR, not relative to SOURCE_DATA_OFFSET:

| Source byte offset | Consumed field |
|---:|---|
| 28 | Little-endian 32-bit seek-entry count |
| 32 | Little-endian 32-bit seek-table byte offset, relative to SOURCE_ADDR |

<div class="keep-together">

Each seek entry occupies eight bytes.

| Entry byte offset | Field |
|---:|---|
| +0 | Little-endian 32-bit source-frame number |
| +4 | Little-endian 32-bit compressed-block byte offset, relative to the data start |

</div>

The data start is SOURCE_ADDR + SOURCE_DATA_OFFSET. Header and seek-table addressing therefore use the source base, whereas a seek entry's compressed offset uses the data base. No signature or version check, or other consumed BADP header field, is specified by this decode path.

Seeking chooses the last entry whose frame number is no greater than the requested frame. With an empty table it begins at frame zero and compressed offset zero. If no entry frame is no greater than the request, the initial selection of entry zero remains. Do not rely on an invented missing-entry fault.

### Blocks and channel state

At a block offset relative to the data start, the block has this layout:

| Block byte offset | Field |
|---:|---|
| +0 | Little-endian 16-bit BLOCK_FRAMES |
| +2 | Little-endian 16-bit total BLOCK_BYTES |
| +4 + 4c | Channel c signed little-endian 16-bit predictor |
| +6 + 4c | Channel c unsigned byte step-table index |
| +7 + 4c | One byte not read by the decoder |
| +4 + 4×SOURCE_CHANNELS | Nibble payload begins |

Channel records are stored in increasing channel order. BLOCK_BYTES includes the block header and payload and locates the next block: next block offset equals current block offset plus BLOCK_BYTES. Loading a block replaces each channel's predictor and index and resets the block frame index and nibble cursor to zero.

Payload bytes are consumed **high nibble first, then low nibble**. Within a frame, channel zero is decoded before the next channel. The nibble cursor continues across frames.

| Layout | Payload byte consumption |
|---|---|
| Mono | Byte 0 high: frame 0; byte 0 low: frame 1; byte 1 high: frame 2; and so on |
| Stereo | Byte 0 high: frame 0 left; byte 0 low: frame 0 right; byte 1 high/low: frame 1 left/right |

The header predictor is a starting accumulator, **not an extra first output frame**. Every emitted frame first applies a nibble to its channel predictor. Mono duplicates the decoded result to right. After BLOCK_FRAMES decoded frames, the next frame loads the next block using BLOCK_BYTES.

<div class="keep-together">

### Exact nibble recurrence

The step table has 89 entries, indexed 0 through 88.

| Index | Step | Index | Step | Index | Step | Index | Step |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 7 | 23 | 66 | 46 | 598 | 69 | 5358 |
| 1 | 8 | 24 | 73 | 47 | 658 | 70 | 5894 |
| 2 | 9 | 25 | 80 | 48 | 724 | 71 | 6484 |
| 3 | 10 | 26 | 88 | 49 | 796 | 72 | 7132 |
| 4 | 11 | 27 | 97 | 50 | 876 | 73 | 7845 |
| 5 | 12 | 28 | 107 | 51 | 963 | 74 | 8630 |
| 6 | 13 | 29 | 118 | 52 | 1060 | 75 | 9493 |
| 7 | 14 | 30 | 130 | 53 | 1166 | 76 | 10442 |
| 8 | 16 | 31 | 143 | 54 | 1282 | 77 | 11487 |
| 9 | 17 | 32 | 157 | 55 | 1411 | 78 | 12635 |
| 10 | 19 | 33 | 173 | 56 | 1552 | 79 | 13899 |
| 11 | 21 | 34 | 190 | 57 | 1707 | 80 | 15289 |
| 12 | 23 | 35 | 209 | 58 | 1878 | 81 | 16818 |
| 13 | 25 | 36 | 230 | 59 | 2066 | 82 | 18500 |
| 14 | 28 | 37 | 253 | 60 | 2272 | 83 | 20350 |
| 15 | 31 | 38 | 279 | 61 | 2499 | 84 | 22385 |
| 16 | 34 | 39 | 307 | 62 | 2749 | 85 | 24623 |
| 17 | 37 | 40 | 337 | 63 | 3024 | 86 | 27086 |
| 18 | 41 | 41 | 371 | 64 | 3327 | 87 | 29794 |
| 19 | 45 | 42 | 408 | 65 | 3660 | 88 | 32767 |
| 20 | 50 | 43 | 449 | 66 | 4026 | — | — |
| 21 | 55 | 44 | 494 | 67 | 4428 | — | — |
| 22 | 60 | 45 | 544 | 68 | 4871 | — | — |

</div>

For code c, read step s from the current index. Start difference at s shifted right by three. Add s when bit 2 is set, s shifted right by one when bit 1 is set, and s shifted right by two when bit 0 is set. These shifts discard low bits. If bit 3 is set, subtract the difference from the predictor; otherwise add it. Saturate the new predictor to −32768 through +32767.

Then change the index using the low three code bits, independently of bit 3:

| Code bits 2:0 | Index change |
|---:|---:|
| 0 | −1 |
| 1 | −1 |
| 2 | −1 |
| 3 | −1 |
| 4 | +2 |
| 5 | +4 |
| 6 | +6 |
| 7 | +8 |

Saturate the updated index to 0 through 88. The header's index byte is used for the initial lookup before that update saturation; it is not checked or clipped first.

As a byte-level example, this complete mono block has two frames:

```text
02 00 09 00 E8 03 00 00 17
```

BLOCK_FRAMES=2, BLOCK_BYTES=9, initial predictor=1000 and index=0. Code 1 comes first: step 7 gives difference 1, so the first output is 1001 and the index remains 0 after saturation. Code 7 gives difference 11, so the second output is 1012 and the index becomes 8. The initial value 1000 is never emitted by itself.

### Seeking and reverse playback

A seek clears both decoded-frame caches. Starting from the seek-table choice, decoding advances through block headers to the block containing the requested frame, then applies the forward nibble recurrence through that frame. A request for the current or previous cached frame reuses that decoded pair. An earlier uncached request seeks again and decodes forward.

Consequently negative RATE_STEP_Q16 does not run BADP prediction backward. It requests earlier source frames, which are obtained through the same seek and forward-decode procedure. Seek-table placement affects the amount of compressed data that must be decoded to obtain such a frame; no constant-time reverse-decoding guarantee follows from negative rate support.

## Source phase, rate and duration

PLAY copies the captured parameters into the target slot, makes it PLAYING, clears fade progress and filter histories, and sets the cursor to START_SAMPLE multiplied by 65536. START_SAMPLE is an unsigned frame index, not a signed word. Its initial fractional position and accumulated rate remainder are zero.

<div class="keep-together">

RATE_STEP_Q16 is a complete signed 32-bit Q16 word. 00010000H is +1, FFFF0000H is −1, and zero freezes phase. SOURCE_SAMPLE_RATE_HZ is an unsigned word. Convert the source-rate/rate combination as follows:

```text
P = signed(RATE_STEP_Q16) × SOURCE_SAMPLE_RATE_HZ
P = q × 44100 + r
```

</div>

Choose q by division truncated toward zero; r is signed and has magnitude less than 44100. q is a cursor increment in Q16 units, not an integer source-frame count. Retain r rather than rounding it away on every output frame.

For each output frame, render the current cursor, filter if enabled, and contribute the current-gain product to the mix. Then add r to the accumulated rate remainder. At +44100 or above, subtract 44100 and add a +1 cursor-unit carry. At −44100 or below, add 44100 and use a −1 carry. Advance the cursor by q plus that carry. A cursor unit is 1/65536 of a source frame.

For 8000-Hz source data at unity rate, P=524288000, q=11888 and r=27200. Starting with remainder zero, the first two advances are 11888 and 11889 cursor units: the remainders become 27200 and 10300. The second advance includes the carry. Negative unity rate gives q=−11888 and r=−27200, with correspondingly negative carries. Zero rate, or zero source rate, causes no phase advancement; neither is rejected or clamped by this conversion.

### Loops apply before the first sample

Looping exists exactly when SOURCE_LOOP_END_SAMPLE is greater than SOURCE_LOOP_START_SAMPLE as unsigned words. Otherwise it is disabled. Bounds are converted directly to Q16 and are not restricted to SOURCE_FRAME_COUNT.

An enabled loop wraps the cursor **before the first output sample**, and again after every phase advance. It is not an introduction followed by a loop. The exact wrap is:

```text
loopStart + positiveModulo(cursor − loopStart, loopEnd − loopStart)
```

The loop interval includes its start and excludes its end. Positive modulo produces a nonnegative result even for negative input. This also handles an advance longer than the entire loop.

For loop [4,8), START_SAMPLE=1 wraps to frame 5 before playback, not to frame 1 or necessarily frame 4. A forward advance from 7.75 by 0.5 wraps to 4.25; a reverse advance from 4.25 by −1 wraps to 7.25. The interpolation neighbor wraps at the same loop boundary.

### Nonloop completion

At render entry, an unlooped cursor outside [0, SOURCE_FRAME_COUNT×65536) ends without contributing a sample. Otherwise the current frame is rendered before phase advancement. With no fade active, crossing either boundary then ends the voice after that rendered sample.

At source rate 44100 Hz and unity rate, a nonloop source of N frames played from zero emits frames 0 through N−1. At negative unity rate, start at N−1 to emit N−1 down through zero. Starting at N is already outside the interval. An in-range zero-rate voice does not naturally end by phase motion alone.

A nonzero fade changes the post-sample completion rule; see “Stop and fade” below. Do not assume a fade will automatically stop at the normal source end.

<div class="keep-together">

## Square generator

GENERATOR_KIND=1 selects the square generator. It reads no sample bytes and supplies the same sample to left and right. Let f be the cursor's fractional position modulo 65536:

```text
if f × 4096 < GENERATOR_DUTY_Q12 × 65536: sample = +32767
otherwise:                                      sample = −32768
```

</div>

Duty is an unsigned Q12 threshold, unlike signed GAIN_Q12.

| Duty word | Result for an in-range fractional cursor |
|---|---|
| 00000000H | Always −32768 |
| 00000800H | Positive for the first half of the phase cycle |
| 00001000H or greater | Always +32767 |

The phase uses the same signed rate conversion as source playback. One integer source-frame advance corresponds to one complete square phase cycle. The unwrapped phase rate in cycles per second is SOURCE_SAMPLE_RATE_HZ multiplied by signed(RATE_STEP_Q16)/65536; the actual 44,100-Hz output sequence is determined by the comparison above.

For example, source rate 441 Hz, unity rate, half duty and loop [0,1) give a 100-output-frame pattern: 50 positive samples followed by 50 negative samples. FRAME_COUNT and loop bounds still govern duration and wrapping; selecting a generator does not remove those controls.

## Gain, stereo mixing and clipping

GAIN_Q12 is the signed value of the entire word. It is not an unsigned volume percentage.

| Gain word | Multiplier |
|---|---:|
| 00000000H | 0 |
| 00000800H | +0.5 |
| 00001000H | +1 |
| 00002000H | +2 |
| FFFFF000H | −1 |

Negative gain inverts polarity. Gain values above unity are not clipped when written. During a fade the retained current gain changes without rewriting the programmed slot GAIN_Q12 word.

For each channel separately, sum the products of every running voice's filtered sample and current Q12 gain. Only then shift and saturate:

```text
mix = sum(sample × currentGainQ12)
output = signed16Saturate(ASR12(mix))
```

ASR12 rounds negative results toward negative infinity. There is no per-voice gain-product saturation. Two samples of +20000 at unity therefore yield a pre-clipped result of +40000 and final output +32767. One +20000 sample at unity plus one at half gain yields +30000 without clipping. Two samples of +1 at half gain combine to +1 because their fractional contributions are summed before shifting.

Minus-unity gain applied to −32768 produces +32768 before final clipping and thus +32767 at the output. This is the signed-16 asymmetry, not a gain-write restriction. An enabled filter has a separate signed-16 saturation before gain and mixing.

## Per-voice Q14 filter

FILTER_CONTROL bit 0 enables the stereo biquad. Other bits have no decoded filter effect. The two channels share five coefficients but have independent two-word histories.

| Register halfword | Coefficient |
|---|---|
| FILTER_B0_B1 bits 15:0 | b0 |
| FILTER_B0_B1 bits 31:16 | b1 |
| FILTER_B2_A1 bits 15:0 | b2 |
| FILTER_B2_A1 bits 31:16 | a1 |
| FILTER_A2 bits 15:0 | a2 |
| FILTER_A2 bits 31:16 | Not decoded |

Each coefficient is signed 16-bit Q14: 4000H is +1, 2000H is +0.5, C000H is −1 and 8000H is −2. Decode each halfword independently; the sign of the whole packed register is not the sign of both coefficients.

For one channel, x is the interpolated source or generator sample and z1,z2 are retained signed 32-bit history words. Use the old histories for the right-hand sides:

```text
y      = ASR14(b0 × x + z1)
nextZ1 = WRAP32(b1 × x − a1 × y + z2)
nextZ2 = WRAP32(b2 × x − a2 × y)
output = signed16Saturate(y)
```

ASR14 rounds toward negative infinity. WRAP32 retains the low 32 bits and interprets them as signed: 2147483648 wraps to −2147483648. History overflow wraps; it does not saturate. Crucially, history updates use the unsaturated y, not the clipped filter output. Left and right execute this recurrence with separate histories.

For a two-sample average, program FILTER_B0_B1=20002000H, FILTER_B2_A1=0 and FILTER_A2=0, then enable bit 0. Starting from zero histories, input [8192,0,−8192,0] yields [4096,4096,−4096,−4096]. On the first sample, y=(8192×8192)/16384=4096 and nextZ1=67108864. On the next zero input, that history alone gives 4096; the new history becomes zero. The negative pair follows the same recurrence.

PLAY clears histories and filter output before installing its programmed coefficients. The filter datapath's reset setting is disabled, with b0=4000H and the other coefficients zero. Live control or coefficient writes install all five coefficients from the slot words without clearing histories. Disabling bypasses processing entirely: histories remain frozen, and re-enabling resumes them. Live source replacement, live START_SAMPLE seeks and pause also retain histories.

## Stop and fade

STOP_SLOT with FADE_SAMPLES=0 stops immediately and clears all 21 slot words. Stopping an idle slot also clears its bank. With a non-idle slot and a positive duration, STOP_SLOT instead enters FADING and schedules that many rendered output frames. A paused voice remains paused, so its fade waits for resume. Writing FADE_SAMPLES alone does not begin a fade.

For initial retained signed gain G0 and duration N, configure:

```text
Q = truncTowardZero(G0 / N)
R = G0 − Q × N
error = N − 1
remaining = N
```

Each frame uses the current gain before any fade adjustment. After phase advancement, decrement remaining. If it becomes zero, end immediately without another gain update. Otherwise add the magnitude of R to error. If error is at least N, subtract N and use carry=sign(R); otherwise carry=0. The new current gain is WRAP32(currentGain−Q−carry).

At G0=4096 and N=4, the four frame gains are 4096,3072,2048,1024, then the voice stops. There is no fifth frame at zero gain. A live GAIN_Q12 write sets current gain immediately and replans this arithmetic over the remaining frame count, not the original duration.

**A nonzero fade suppresses the normal post-frame source-end check.** A nonloop source may advance past its declared end during a fade longer than its remaining data. The fade is not automatically shortened to the source length, and no padding, clipping or recovery is promised. Keep the fade inside the remaining source data or provide a valid loop for its duration.

Natural completion and fade completion end and clear the slot and produce the slot-ended notification described in the event section. An immediate explicit stop does not emit that notification.

## Pause, resume and live programming

PAUSE_SLOT changes a non-idle, unpaused voice to paused without discarding it. RESUME_SLOT acts on a paused voice without replaying it. The active-mask bit remains set while paused.

A paused voice contributes no samples and consumes no phase, fade frames or filter history. Resume continues the retained cursor, gain, fade and histories. Selected-slot writes can nevertheless modify a paused voice, because it remains non-idle.

Selected-slot reads and writes first advance audio through the current access cycle. A write then takes effect for later output; it cannot change samples already due through that cycle. These accesses are distinct from writing command staging words.

### Source fields are individually live

The following active-slot stores each replace the source description: SOURCE_ADDR, SOURCE_BYTES, SOURCE_SAMPLE_RATE_HZ, SOURCE_CHANNELS, SOURCE_BITS_PER_SAMPLE, SOURCE_FRAME_COUNT, SOURCE_DATA_OFFSET, SOURCE_DATA_BYTES and GENERATOR_KIND. Each store first changes its raw slot word, then reloads all source metadata and rebinds using the cartridge selection at that access. Consecutive stores are **not an atomic source update**.

A successful replacement preserves cursor, accumulated phase remainder, current gain, fade progress and filter histories. It reconfigures the rate conversion, loop bounds and filter coefficients. BADP state is reset and sought to the retained source position. Thus even a change to a rate or extent word in this group takes the full source-replacement route.

If a live replacement cannot bind, it stops and deactivates the slot and raises SOURCE_RANGE with the newly programmed SOURCE_ADDR. Unlike a failed PLAY, this failure occurs after the raw bank write. The bank words are retained rather than cleared.

Other live changes have these effects:

| Field written | Active or paused voice effect |
|---|---|
| Loop start or end | Recompute loop bounds |
| RATE_STEP_Q16 | Recompute q and r; retain accumulated phase remainder |
| GAIN_Q12 | Replace signed current gain; replan any remaining fade |
| START_SAMPLE | Seek immediately; clear accumulated phase remainder; retain filter histories |
| GENERATOR_DUTY_Q12 | Change the square duty threshold |
| FILTER_CONTROL or a coefficient word | Reload all five coefficients; retain histories |
| FADE_SAMPLES | Store the word only; do not start a fade |

Writing a raw bank word does not activate an idle slot. Use the command programming route when a new voice, reset histories or a coherent replacement of all captured parameters is required.

## Clocks and transfer timing

### Installed rates

The installed system clock is 33,868,800 Hz. The APU sample clock runs at 44,100 output frames per second. Sample-RAM transfer service has a separate budget of 1,058,400 words per second: 24 four-byte words per output frame.

| Quantity | Installed value |
|---|---:|
| System cycles per output frame | 33,868,800 / 44,100 = 768 |
| System cycles per sample-RAM transfer word | 33,868,800 / 1,058,400 = 32 |
| Sample-RAM service for 16 words | 16 × 32 = 512 cycles |
| Sample-RAM service for 4 words | 4 × 32 = 128 cycles |

These are scheduled internal transfer costs, not electrical bus ratings. They do not include CPU instruction execution, transfer-register programming or DMA source-bus time. MANUAL_WRITE stores take effect at their CPU port-write edge; they do not pass through the timed DMA transfer FIFO.

For a scheduled batch of N words:

**batch deadline = scheduling anchor + 32 × N system cycles**

The transfer-rate accumulator starts at zero and resets on a change of transfer mode. Rewriting the same mode preserves it. At the installed clock ratio, every integer-word batch takes exactly 32 × N cycles and leaves zero fractional carry. A batch has one completion edge: its words do not become visible at successive 32-cycle intervals.

### Sample sequence and edge order

SAMPLE_SEQUENCE at 08000200H reports the low 32 bits of the accumulated output-frame count. Reset starts the count and its fractional timing remainder at zero and establishes the clock phase. The count advances once per 768 system cycles from that phase, including periods with no active voices. Reading it brings the count through the access cycle. A write does not set or reset this count; later reads still return the running sequence. Such a write is not rejected as a read-only-port fault.

A transfer completing at an output-sample edge is visible to voice processing for that sample. For an access to TRANSFER_ADDRESS, TRANSFER_DATA or TRANSFER_CONTROL at cycle t, the order is:

1. Complete earlier transfer deadlines, with intervening voice progress.
2. Advance voice processing through cycle t − 1.
3. Complete a transfer batch due exactly at t.
4. Perform the register access.
5. Advance voice processing through t.

Thus a control write at the batch's exact deadline cannot cancel that already-due batch. An address write at that deadline affects subsequent transfers, not the batch just completed. The same transfer-before-sample rule applies when no register access occurs.

### DMA transport and RAM commit are separate

DMA transports words between its source and the APU DATA port. The APU then transfers those words between its FIFO and private sample RAM. Each stage has its own timing and completion condition; adding only the sample-RAM cost does not give the complete upload time.

For a contiguous cartridge-ROM source and a fixed I/O destination, an admitted DMA block of N words costs **8 × N + 4 cycles**. The setup cost applies afresh to each admitted block. This cost and the APU's **32 × N** service cost describe separate stages.

The following controlled upload transfers 20 words. Before cycle 0, the address and DMA registers are programmed, DMA_WRITE is selected, and the FIFO is empty. The DMA source increments through readable cartridge ROM without a region crossing; its destination remains TRANSFER_DATA. Its blocks contain at most 16 words, with FORCE read admission and APU_WRITE write admission. There are no intervening mode/address writes or competing work. Cycle 0 is the first DMA block admission, not the start of CPU setup.

| Cycle | Event |
|---:|---|
| 0 | Admit the first 16-word DMA block. Its cost is 8 × 16 + 4 = 132 cycles. |
| 132 | DMA supplies 16 FIFO words. BLOCK_END schedules 16 words of RAM service: 512 cycles. |
| 644 | The first 16 words commit together. The empty FIFO requests the remaining four DMA words; their block costs 8 × 4 + 4 = 36 cycles. |
| 680 | DMA supplies the four-word tail, schedules 128 cycles of RAM service, and reaches channel DONE. The tail is not yet in sample RAM. |
| 808 | The four-word tail commits; TRANSFER_BUSY clears. All 20 words are now in sample RAM. |

Here, DMA DONE occurs at cycle 680, while final RAM commit occurs at cycle **132 + 512 + 36 + 128 = 808**. Switching to STOP at DMA DONE would cancel the tail's scheduled commit.

## Sample RAM transfer

![Three transfer modes share the private sample RAM and one FIFO](figures/apu-transfer.svg)

The rows are alternative mode paths through the same RAM. They are not three
separate memories. All DATA writes update the latch; CPU DATA reads return only
that latch and do not dequeue the FIFO.

### Private RAM and the two address forms

The APU contains 512 KiB of private sample RAM: 524,288 bytes or 131,072 four-byte words. Reset clears it to zero. A sample-source descriptor addresses these bytes at 40000000H–4007FFFFH inclusive. A nonempty descriptor must fit entirely within this range; descriptor binding neither wraps an overlong range nor requires word alignment.

This source-address range is **not a CPU load/store aperture**. An ordinary CPU word read there returns zero and raises system bus fault UNMAPPED = 1. A word write raises that fault without changing sample RAM. Use the transfer port to write or read back the private RAM.

| Address | Register | Function |
|---|---|---|
| 080001E8H | TRANSFER_ADDRESS | Program transfer offset; read raw programmed word |
| 080001ECH | TRANSFER_DATA | CPU data latch or DMA FIFO port |
| 080001F0H | TRANSFER_CONTROL | Program transfer mode; read raw programmed word |
| 08000178H | STATUS | Read transfer requests and scheduled-service state |

Writing TRANSFER_ADDRESS retains the entire word for readback and loads a separate moving byte offset:

**moving offset = programmed word AND 0007FFFCH**

Upper bits and bits 1:0 do not enter that offset. For example, programming 40000003H selects offset zero but still reads back as 40000003H. Offset zero corresponds to descriptor address 40000000H. Each actual RAM transfer reads or writes a little-endian four-byte word, then advances the offset:

**next offset = (current offset + 4) AND 0007FFFFH**

Transfers therefore wrap from the last RAM word to the first. TRANSFER_ADDRESS readback does not follow this progress.

### Modes, latch and FIFO

TRANSFER_CONTROL retains the entire programmed word. Only bits 1:0 select the mode; upper bits have no transfer function.

| Bits 1:0 | Mode | Sample-RAM operation |
|---:|---|---|
| 0 | STOP | No transfer batches |
| 1 | MANUAL_WRITE | CPU DATA writes store directly into RAM |
| 2 | DMA_WRITE | FIFO-to-RAM batches |
| 3 | DMA_READ | RAM-to-FIFO batches |

Changing the decoded mode cancels scheduled service, empties the 16-word FIFO and resets transfer timing carry. It preserves RAM, the data latch, TRANSFER_ADDRESS readback and the current moving offset. STOP is not a RAM clear. Rewriting the same mode—even with different upper bits—does not empty the FIFO, cancel an admitted batch or reset carry. Both kinds of control write update requests and attempt to schedule work when no batch is pending.

CPU DATA reads always return the existing data latch. They never fetch RAM, dequeue FIFO data or advance the offset. CPU DATA writes always replace the latch. In MANUAL_WRITE only, they also write RAM immediately and advance the offset. In every other mode a CPU DATA write changes only the latch; it cannot feed the DMA FIFO.

DMA DATA writes also replace the latch. In DMA_WRITE they append to the FIFO if space exists; a full FIFO discards the new word while retaining its value in the latch. Outside DMA_WRITE they neither enqueue nor write RAM. DMA DATA reads in DMA_READ dequeue the oldest available word into the latch and return it. An empty FIFO, or any other mode, returns the existing latch without dequeue or address movement. These full, empty and wrong-mode cases do not themselves raise an APU fault.

### Requests and admitted blocks

| DMA request selector | Asserted condition |
|---|---|
| APU_WRITE = 3 | DMA_WRITE mode and FIFO empty |
| APU_READ = 4 | DMA_READ mode and FIFO full with 16 words |

The controller admits a block only when both its read and write request selectors pass. FORCE = 0 always passes; DISABLED = 15 never passes. Once admitted, every word in that block executes even if the APU request drops after the first word. Requests gate **whole blocks**, not individual ready words. Use the appropriate APU selector, the intended transfer mode and a fixed TRANSFER_DATA endpoint; FORCE cannot override the latch, overflow or empty-read behavior above.

The final source access and final destination access of each admitted block carry BLOCK_END. In DMA_WRITE, that edge attempts to schedule FIFO-to-RAM service; in DMA_READ, it attempts a RAM-to-FIFO refill. It occurs for intermediate blocks as well as the block that finishes a channel. It is not synonymous with channel DONE.

With no batch pending, DMA_WRITE schedules the FIFO count then present. DMA_READ schedules the free capacity, 16 minus that count. Zero words schedule nothing. The scheduled count and deadline are fixed; later scheduling attempts neither enlarge nor reprice them. At completion, all admitted words transfer in FIFO order, the offset advances per word, requests update, and another batch may be scheduled from that completion deadline.

The offset is **not captured with the batch**. Writing TRANSFER_ADDRESS while service is pending retargets that batch to the new offset, unless the batch is already due at the access cycle. Changing mode instead cancels it.

### Status and CPU port ownership

| STATUS bit | Mask | Meaning |
|---:|---|---|
| 7 | 00000080H | DMA_REQUEST: read request OR write request |
| 8 | 00000100H | DMA_READ_REQUEST |
| 9 | 00000200H | DMA_WRITE_REQUEST |
| 10 | 00000400H | TRANSFER_BUSY: a RAM batch is scheduled |

TRANSFER_BUSY is not a mode indicator. DMA_WRITE with an empty FIFO can request a block while TRANSFER_BUSY is clear. DMA_READ with a full FIFO can likewise request a block without pending RAM service. STATUS BUSY, bit 2, concerns active voices or queued commands; it is not transfer completion.

A CPU DATA write waits while either busy DMA channel owns DATA as its exact read or write port, even when that channel is waiting for requests. For an admitted block, ownership uses its captured base address; otherwise it uses the channel's current programmed address. The write proceeds only after neither direction owns that port. This is not FIFO-full backpressure. CPU DATA reads are not blocked by this ownership rule. DMA DATA writes are always accepted by the port without an occupancy stall; their actual effect follows the FIFO rules above.

### Completing uploads and downloads

For upload, program the offset, select DMA_WRITE, and DMA to the fixed DATA port using APU_WRITE admission. DMA channel DONE reports completion of the controller's final mapped accesses and count/address updates; its DMA IRQ does not report sample-RAM commit. Wait for the final scheduled batch to finish before changing mode or using the new bytes. In particular, a mode change immediately after DONE can discard the final upload batch.

For download, program the offset before selecting DMA_READ. Filling the FIFO costs RAM-service time; APU_READ asserts only when all 16 words are available. DMA reads dequeue those prefetched words. Final BLOCK_END can schedule further prefetch even when the channel reaches DONE. After receiving the desired words, select STOP to cancel unwanted prefetch. CPU DATA reads cannot drain the FIFO. The transfer unit has no separate START/DONE register or transfer-completion IRQ.

A nonzero DMA count sets channel BUSY at START. Zero count reaches DONE at START without accessing DATA. Neither DONE nor TRANSFER_BUSY = 0 proves that the intended RAM bytes received valid data. An admitted DMA block is not aborted by a system bus fault and can still finish with DONE and its IRQ after accesses to an unmapped or read-only destination.

Use aligned word accesses for these ports. I/O byte writes, halfword accesses and unaligned word accesses raise system bus fault UNALIGNED_IO = 2 without performing the intended port operation. An aligned byte read invokes the word read and returns its low eight bits; it does not select a byte lane. STATUS rejects word writes with READ_ONLY = 3. These system bus faults are distinct from the APU fault latch.

Reset clears the programmed transfer words, offset, latch, FIFO contents/count and timing state, selects STOP, cancels service and deasserts both request lines. Reset clears sample RAM as well; ordinary STOP and mode changes preserve it.

## End events and interrupts

An output-reported natural or faded end clears the ended slot, then publishes
one SLOT_ENDED event. EVENT_KIND becomes `00000001H`, EVENT_SLOT identifies the
slot, and EVENT_SOURCE_ADDR records that slot's source address from before its
bank was cleared. EVENT_SEQ advances modulo 2³². All event words are published
before the central APU interrupt request, bit 5 (`00000020H`), is raised.

This is one latest-event latch, not an event FIFO. If slots 0 and 1 end in the
same advancement, the event sequence advances twice and the latest payload is
slot 1. The central pending bit may still represent only one unacknowledged
request. A callback count cannot reconstruct all coalesced ends or their source
addresses. Use the event sequence and active mask with that limitation in mind.

Reading event words does not clear them. There is no separate APU event-ACK
port. Acknowledge central bit 5 through the [interrupt controller](irq.md);
that does not erase the latest event payload. FAULT_ACK is not an event or
central interrupt acknowledgement.

Immediate explicit STOP, pause, resume, gain changes and command/source faults
do not emit SLOT_ENDED. In particular, a program waiting for an end IRQ after
STOP with zero fade will wait for an event that command does not produce.
A nonzero fade needs output progress to reach its end; pausing is not a way to
complete it. The playback section states its exact pause/fade behavior.

For one controlled outstanding end, sample a BSS service sequence before issuing
the operation that can produce the end, then wait on that predicate with
`halt_until_irq`. The handler must service the APU source and advance that
software sequence. Other IRQs may wake the caller without satisfying it.
No fixed request-to-handler delay or one-callback-per-output-end guarantee is
implied. The complete example below owns its slots and waits for one end at a time.

## Faults and reset

APU faults are retained separately from system memory bus faults and central
interrupt pending. An APU fault does not raise an interrupt request. The first
unacknowledged APU fault sets STATUS.FAULT and
retains FAULT_CODE/FAULT_DETAIL. Later raises preserve that first report.
A nonzero FAULT_ACK clears code, detail and the fault bit; zero changes nothing.
Neither operation clears an event, acknowledges central IRQ, flushes commands
or stops all other voices. FAULT_ACK reads zero.

| Code | Name | Condition and detail |
|---|---|---|
| `00000000H` | NONE | No latched fault |
| `00000001H` | BAD_CMD | Unrecognized complete CMD word; detail is that word |
| `00000102H` | SOURCE_RANGE | Source binding failed; detail is SOURCE_ADDR |

A failed PLAY bind leaves the prior slot unchanged. A failed active source-bank
write is different: the raw parameter has already changed; output stops and
the slot becomes inactive, but its raw bank is not cleared. Do not treat a
sequence of live source edits as a reversible transaction.

These fault conditions do not certify every metadata field, byte range or
format choice. DATA_BYTES does not bound decoding, and merely selecting a bit
depth does not validate that the source contains that encoding. The source and
format sections describe the actual datapath choices. No FIFO-full fault or
automatic producer stall protects a full command queue.

Ordinary CPU access to `40000000H` does not reach sample RAM; it raises the
system UNMAPPED fault. Invalid mapped I/O widths or alignment use the system
UNALIGNED_IO fault. Mapped writes to the read-only APU ports use system
READ_ONLY and do not change those ports. These system reports are not the APU
BAD_CMD/SOURCE_RANGE latch and do not retroactively undo accepted operations.

An APU reset clears sample RAM, transfer FIFO/state, commands, slots, output
voices, faults, events and sample-clock sequence. It restores the staging
parameter defaults and clears all slot-bank words. No global-reset command is
encoded among CMD zero through five. STOP_SLOT affects its target; transfer
STOP changes transfer mode. Neither is a private-sample-RAM clear operation.

## Worked BLua program

This complete program uses four slots in succession: looping ROM PCM, the same
PCM copied into private sample RAM, a square, and a one-shot BADP source. Run it
from ordinary cartridge startup with zeroed BSS and CPU interrupt acceptance
enabled. It owns slots 2–5, DMA channel 0, the first 64 sample-RAM bytes and the
APU transfer port. Other slots are idle, neither DMA channel has outstanding
work, no other IRQ sources are enabled, and no earlier APU fault, command
or DMA/APU interrupt request is pending.

Create a const module named `results`. Concatenate the following **Entry
module** parts in order into one entry module. The program requires the existing
`cartlib/apu`, `cartlib/dma` and `cartlib/irq` modules; do not add another global
`irq` function. The library's DMA callbacks remain installed. The program
registers only its APU callback, retaining one controlled end at a time in BSS.
The fixed `rodata` records and PCM array are typed ROM operands. Retained
observations and callback state live in explicit BSS.

Supply the mono 44,100 Hz, 4,410-frame tone resource distributed with this
example. Include it as an audio resource named `tone`. Its ordinary audio
packing produces the BADP source exported as
`audio_tone_addr` and `audio_tone_len` by `bmsx/assets`. The last part reads its
existing `badp_header` record and explicitly programs the source fields.
The APU does not parse that record to fill the staging bank for the cartridge.

### Follow the four sources

1. **ROM PCM16.** The 32 authored halfwords contain two copies of a 16-frame
   waveform. The loop uses only frames [0,16); a source rate of 7,040 frames/s
   and unity rate step therefore repeats it 440 times/s. Gain starts at one-half,
   then a selected-window write changes it to minus one-half. Pause retains the
   bank and active bit while the output sample clock continues. Resume retains
   its source phase; a 441-output-frame fade then ends it.
2. **Private-RAM PCM16.** Upload all 64 source bytes as sixteen words. Wait for
   DMA separately from TRANSFER_BUSY. Download sixteen words into BSS, then
   stop unwanted read prefetch. PLAY uses source address `40000000H`, not a CPU
   pointer to the downloaded BSS copy. Source and loop settings otherwise match
   the ROM voice; slot 3 is a different bank.
3. **Square.** Slot 4 uses GENERATOR_KIND=1, source rate 440, unity rate step,
   one-half duty and loop [0,1). The fractional cursor provides its period;
   FRAME_COUNT=1 is not a one-output-frame sound while that loop is enabled.
   The programmed quarter gain yields +8191 or −8192 per channel before the
   subsequent fade, in the absence of other contributions.
4. **BADP.** Slot 5 reads the packed tone directly from ROM at unity rate,
   one-half gain and no loop. Its 4,410 source frames play at the 44,100 Hz output
   cadence, then end naturally. The generated resource symbols supply its source
   address and byte length; the header supplies its data offset. No compressed
   bytes are expanded into BSS.

Each 2,205-frame interval is a **minimum observed sample-clock distance**; the
polling loop may observe a later frame. The 441-frame fades describe rendered
output duration, not CPU issue-to-return latency. Neither count includes an
invented fixed interrupt-delivery charge.

Requiring the DMA library enables its two completion sources. Registering the
APU callback adds bit 5, so the example's owned interrupt mask is `00000121H`.
VBlank remains masked and is deliberately allowed to become pending. The
shared dispatcher acknowledges only enabled serviced sources; a pending masked
VBlank must survive the sound and DMA work. Final FLAGS need not be zero.

### Const module: retained observations

The callback and foreground code share this fixed BSS record.

```lua
module<const>

struct apu_manual_event
  kind: word
  slot: word
  source_address: word
  hardware_sequence: word
end

struct apu_manual_result
  completed_phase: word
  service_sequence: word
  initial_event_sequence: word
  events: apu_manual_event[4]
  pcm_address: word
  pcm_selected_source: word
  pcm_active_mask: word
  pcm_status: word
  pcm_gain: word
  paused_sample_start: word
  paused_sample_end: word
  paused_active_mask: word
  paused_source: word
  paused_gain: word
  upload_dma_status: word
  upload_apu_status: word
  upload_committed_status: word
  transfer_address: word
  download_dma_status: word
  download_apu_status: word
  download_stopped_status: word
  transferred: word[16]
  ram_selected_source: word
  ram_active_mask: word
  square_selected_source: word
  square_active_mask: word
  square_rate_hz: word
  square_duty: word
  badp_address: word
  badp_bytes: word
  badp_version: word
  badp_channels: word
  badp_sample_rate_hz: word
  badp_frames: word
  badp_data_offset: word
  badp_seek_count: word
  badp_seek_offset: word
  badp_selected_source: word
  badp_active_mask: word
  final_active_mask: word
  final_status: word
  final_fault_code: word
  final_fault_detail: word
  initial_unrelated_pending: word
  final_irq_flags: word
end

bss result: apu_manual_result

return { result = result }
```

### Entry module: imports and word ports

The imported APU module supplies the existing register-record and BADP header types. Only the first 21 parameter fields of `selected` are used; its address is the live slot window, not the staging bank.

```lua
module<entry>

local apu<const> = require('cartlib/apu')
local dma<const> = require('cartlib/dma')
local irq<const> = require('cartlib/irq')
local assets<const> = require('bmsx/assets')
local state<const> = require('results')
local result<const>: *apu_manual_result = state.result
local commands<const>: *apu_command_registers = 0x08000120
local command_words<const>: *word = commands
local selected<const>: *apu_command_registers = 0x08000194
local status<const>: *word = 0x08000178
local selected_source<const>: *word = 0x0800018c
local active_mask<const>: *word = 0x08000190
local queued<const>: *word = 0x080001f4
local transfer_address<const>: *word = 0x080001e8
local transfer_control<const>: *word = 0x080001f0
local sample_sequence<const>: *word = 0x08000200
local event_kind<const>: *word = 0x0800017c
local event_slot<const>: *word = 0x08000180
local event_source<const>: *word = 0x08000184
local event_sequence<const>: *word = 0x08000188
local fault_code<const>: *word = 0x08010218
local fault_detail<const>: *word = 0x0801021c
local dma_status<const>: *word = 0x0800001c
local irq_flags<const>: *word = 0x08000000
local irq_ack<const>: *word = 0x08000004
local irq_mask<const>: *word = 0x08000008
```

### Entry module: fixed source and presets

The source address is supplied by a real word write when PLAY is staged. The preset contains the other literal operands. The copies below deliberately leave CMD until after all parameter writes.

```lua
-- Two authored sine periods. Loop [0,16) at 7040 source frames/s gives 440 Hz.
rodata pcm: i16[32] = {
  0, 3135, 5793, 7568, 8192, 7568, 5793, 3135,
  0, -3135, -5793, -7568, -8192, -7568, -5793, -3135,
  0, 3135, 5793, 7568, 8192, 7568, 5793, 3135,
  0, -3135, -5793, -7568, -8192, -7568, -5793, -3135,
}

-- The existing APU register record names every operand; CMD is written last.
rodata pcm_note: apu_command_registers = {
  source_addr = 0, source_bytes = sizeof(i16[32]), sample_rate_hz = 7040,
  channels = 1, bits_per_sample = 16, frame_count = 32,
  data_offset = 0, data_bytes = sizeof(i16[32]),
  loop_start_sample = 0, loop_end_sample = 16,
  slot = 2, rate_step_q16 = 0x00010000, gain_q12 = 0x00000800,
  start_sample = 0, filter_control = 0, filter_b0_b1 = 0x00004000,
  filter_b2_a1 = 0, filter_a2 = 0, fade_samples = 0,
  generator_kind = 0, generator_duty_q12 = 0x00000800, cmd = 1,
}
rodata square_note: apu_command_registers = {
  source_addr = 0, source_bytes = 0, sample_rate_hz = 440,
  channels = 1, bits_per_sample = 16, frame_count = 1,
  data_offset = 0, data_bytes = 0, loop_start_sample = 0, loop_end_sample = 1,
  slot = 4, rate_step_q16 = 0x00010000, gain_q12 = 0x00000400,
  start_sample = 0, filter_control = 0, filter_b0_b1 = 0x00004000,
  filter_b2_a1 = 0, filter_a2 = 0, fade_samples = 0,
  generator_kind = 1, generator_duty_q12 = 0x00000800, cmd = 1,
}
local pcm_note_words<const>: *word = pcm_note
local square_note_words<const>: *word = square_note
```

### Entry module: end service and masked pending

The callback records the latest hardware event before advancing the BSS service sequence. No second slot can end during a controlled wait in this program. This does not turn the hardware event latch into a queue.

```lua
-- cartlib/dma keeps its own DMA callbacks. Retain the single APU event latch.
irq.register(0x00000020, function()
  local index<const> = result.service_sequence
  result.events[index].kind = *event_kind
  result.events[index].slot = *event_slot
  result.events[index].source_address = *event_source
  result.events[index].hardware_sequence = *event_sequence
  result.service_sequence = index + 1
end)
*irq_ack = 0x00000121
result.initial_event_sequence = *event_sequence
-- Disabled VBlank is allowed to remain pending throughout every APU/DMA IRQ.
while (*irq_flags & 0x00000004) == 0 do
end
result.initial_unrelated_pending = *irq_flags & 0x00000004
```

### Entry module: ROM voice, live gain and pause

The end predicate is sampled before STOP. `halt_until_irq` may wake for a DMA source too; only the changed APU service sequence ends this wait.

```lua
-- 1. ROM PCM16: capture parameters on CMD, then select the committed slot.
result.pcm_address = pcm
commands->source_addr = pcm
for index = 1, 20 do
  command_words[index] = pcm_note_words[index]
end
commands->cmd = 1
while (*active_mask & 0x00000004) == 0 do
end
commands->slot = 2
result.pcm_selected_source = *selected_source
result.pcm_active_mask = *active_mask
result.pcm_status = *status
local playing_start<const> = *sample_sequence
while ((*sample_sequence - playing_start) & 0xffffffff) < 2205 do
end

-- A selected-window gain write is live, not a staged command. Negative is Q12.
selected->gain_q12 = 0xfffff800
result.pcm_gain = selected->gain_q12
apu.pause_slot(2)
while *queued ~= 0 do
end
commands->slot = 2
result.paused_sample_start = *sample_sequence
while ((*sample_sequence - result.paused_sample_start) & 0xffffffff) < 2205 do
end
result.paused_sample_end = *sample_sequence
result.paused_active_mask = *active_mask
result.paused_source = *selected_source
result.paused_gain = selected->gain_q12
apu.resume_slot(2)
while *queued ~= 0 do
end
local resumed_start<const> = *sample_sequence
while ((*sample_sequence - resumed_start) & 0xffffffff) < 2205 do
end
local pcm_end_sequence<const> = result.service_sequence
apu.stop_slot(2, 441)
while result.service_sequence == pcm_end_sequence do
  halt_until_irq
end
result.completed_phase = 1
```

### Entry module: private-RAM round trip and voice

The upload waits are deliberately separate. After download, STOP cancels extra prefetch; it does not erase the uploaded PCM. The returned BSS words retain the readback.

```lua
-- 2. Upload goes through FIFO to private RAM: DMA DONE is not final commit.
apu.upload(pcm, 0, sizeof(i16[32]) // 4)
dma.wait0_idle()
result.upload_dma_status = *dma_status
result.upload_apu_status = *status
while (*status & 0x00000400) ~= 0 do
end
result.upload_committed_status = *status
result.transfer_address = *transfer_address
apu.download(&result.transferred[0], 0, 16)
dma.wait0_idle()
result.download_dma_status = *dma_status
result.download_apu_status = *status
*transfer_control = 0
result.download_stopped_status = *status

-- 40000000H is a source descriptor address, not a CPU sample-memory pointer.
commands->source_addr = 0x40000000
for index = 1, 20 do
  command_words[index] = pcm_note_words[index]
end
commands->slot = 3
commands->cmd = 1
while (*active_mask & 0x00000008) == 0 do
end
commands->slot = 3
result.ram_selected_source = *selected_source
result.ram_active_mask = *active_mask
local ram_start<const> = *sample_sequence
while ((*sample_sequence - ram_start) & 0xffffffff) < 2205 do
end
local ram_end_sequence<const> = result.service_sequence
apu.stop_slot(3, 441)
while result.service_sequence == ram_end_sequence do
  halt_until_irq
end
result.completed_phase = 2
```

### Entry module: square voice

The square does not bind source bytes. Its active bit, rather than a nonzero selected source address, identifies the active slot.

```lua
-- 3. A square uses fractional cursor phase: one-frame loop, source rate 440 Hz.
for index = 0, 20 do
  command_words[index] = square_note_words[index]
end
commands->cmd = 1
while (*active_mask & 0x00000010) == 0 do
end
commands->slot = 4
result.square_selected_source = *selected_source
result.square_active_mask = *active_mask
result.square_rate_hz = selected->sample_rate_hz
result.square_duty = selected->generator_duty_q12
local square_start<const> = *sample_sequence
while ((*sample_sequence - square_start) & 0xffffffff) < 2205 do
end
local square_end_sequence<const> = result.service_sequence
apu.stop_slot(4, 441)
while result.service_sequence == square_end_sequence do
  halt_until_irq
end
result.completed_phase = 3
```

### Entry module: BADP source fields

The packed resource supplies the descriptor metadata. This authored source is a one-shot, so both loop words are explicitly zero.

```lua
-- 4. tone.wav is normally packed as BADP. Read its central header type in ROM.
local header<const>: *badp_header = assets.audio_tone_addr
result.badp_address = assets.audio_tone_addr
result.badp_bytes = assets.audio_tone_len
result.badp_version = header->version
result.badp_channels = header->channels
result.badp_sample_rate_hz = header->sample_rate_hz
result.badp_frames = header->frame_count
result.badp_data_offset = header->data_offset
result.badp_seek_count = header->seek_entry_count
result.badp_seek_offset = header->seek_table_offset
commands->source_addr = assets.audio_tone_addr
commands->source_bytes = assets.audio_tone_len
commands->sample_rate_hz = header->sample_rate_hz
commands->channels = header->channels
commands->bits_per_sample = 4
commands->frame_count = header->frame_count
commands->data_offset = header->data_offset
commands->data_bytes = assets.audio_tone_len - header->data_offset
-- This authored one-shot has no loop; neither field is inferred by the APU.
commands->loop_start_sample = 0
commands->loop_end_sample = 0
commands->slot = 5
commands->rate_step_q16 = 0x00010000
commands->gain_q12 = 0x00000800
commands->start_sample = 0
commands->filter_control = 0
commands->filter_b0_b1 = 0x00004000
commands->filter_b2_a1 = 0
commands->filter_a2 = 0
commands->fade_samples = 0
commands->generator_kind = 0
commands->generator_duty_q12 = 0x00000800
```

### Entry module: BADP command and final state

The sequence is sampled before PLAY because this source can end naturally. The final state is retained before the program enters its permanent wait.

```lua
local badp_end_sequence<const> = result.service_sequence
commands->cmd = 1
while (*active_mask & 0x00000020) == 0 do
end
commands->slot = 5
result.badp_selected_source = *selected_source
result.badp_active_mask = *active_mask
while result.service_sequence == badp_end_sequence do
  halt_until_irq
end
result.final_active_mask = *active_mask
result.final_status = *status
result.final_fault_code = *fault_code
result.final_fault_detail = *fault_detail
*irq_mask = 0
result.final_irq_flags = *irq_flags
result.completed_phase = 4
while true do
  halt_until_irq
end
```

### Interpret the retained observations

The controlled program distinguishes the following states. Its transfer-status
observations assume the inputs and exclusive ownership above, not arbitrary
concurrent DMA or voice work.

| Retained observation | Meaning |
|---|---|
| PCM ACTIVE_MASK=`00000004H`, source=`pcm` | Slot 2 is active and bound to the authored ROM data |
| Live gain=`fffff800H` | Signed Q12 minus one-half; the selected bank changed without another PLAY |
| Paused ACTIVE_MASK=`00000004H`; sample distance at least 2,205 | Pausing the slot does not pause the output clock or clear the bank |
| Upload DMA STATUS=`00000002H`, APU STATUS=`00000420H` | Submission is DONE; the final RAM batch is still pending |
| Upload committed STATUS=`000002a0H` | Empty command FIFO and empty-FIFO DMA_WRITE request; no pending RAM batch |
| Download DMA STATUS=`00000002H`, APU STATUS=`00000420H` | Desired words were dequeued; extra RAM prefetch is pending |
| Download stopped STATUS=`00000020H` | STOP canceled prefetch and cleared transfer requests |
| `transferred[0..15]` | Exact sixteen-word copy of the authored PCM data |
| RAM source=`40000000H`, ACTIVE_MASK=`00000008H` | Slot 3 binds private sample RAM, independently of the BSS readback |
| Square source=0, ACTIVE_MASK=`00000010H` | A zero source address does not mean a generator is inactive |
| BADP ACTIVE_MASK=`00000020H` | Slot 5 is the one-shot compressed source |
| Four retained events | Slots 2, 3, 4, 5, in that order; successive hardware sequences and the corresponding programmed source addresses |
| Final ACTIVE_MASK=0, STATUS=`00000020H` | No slots or commands remain active, and the transfer mode is STOP |
| Final FAULT_CODE=0, FAULT_DETAIL=0 | No APU command/source fault was raised by these inputs |
| Final MASK=0, FLAGS=`00000004H` | Delivery is disabled; unrelated masked VBlank remains pending |

The event source for the square is zero; the other three are the actual ROM,
private-RAM and packed-ROM source addresses. Natural and faded ends clear their
banks. The four BSS records are observations from these controlled operations,
not additional hardware event storage.
