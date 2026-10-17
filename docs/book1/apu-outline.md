# APU manuscript: paragraph assignments

Editorial work list, not a public contents page or another publishing manifest.
The installed APU is one chapter. Its full programming contract includes sound
sources, playback, mixing and sample transfer; a register list alone is not the
chapter. The existing manual publisher and review schema are sufficient.

Facts are extracted from scoped mirrored spec leaves and live owners. Authors
receive frozen slices, not architecture prose or a historical hardware PDF.
The actual BIOS static-data, typed-pointer, BSS and interrupt idioms determine
the BLua examples. Existing cartridge APIs/types are checked before reuse;
private firmware exports or missing source-language features are not invented.

| Assignment | Reader task | Evidence scope | State |
|---|---|---|---|
| P01 | Identify installed slots, DAC cadence, sample RAM, command and transfer capacities; separate local sound work from system DMA and external delivery. | APU spec/model and public register/transfer/voice facts. | Integrated; independent source/math/reader/figure and every-page print checks pass. |
| P02 | Program the staging words, capture a command, understand queue overflow and distinguish the selected-slot live bank. | Register/command/FIFO owners. | Integrated; independent source/math/reader/figure and every-page print checks pass. |
| P03 | Budget commands, DAC edges, sample sequence and sample-transfer batches in system cycles without inventing oscillator or bandwidth ratings. | Service clock, installed model, transfer owner. | Integrated; independent source/math/reader/figure and every-page print checks pass. |
| P04 | Bind real source bytes in ROM or private sample RAM; preserve their lifetime and distinguish addresses from transfer offsets. | Source-binding, sample-memory and transfer facts. | Integrated; independent source/math/reader/figure and every-page print checks pass. |
| P05 | Author mono/stereo PCM8 and PCM16, decode channel/sample/byte units, interpolation and raw-value behavior. | Voice and PCM datapath facts. | Integrated; independent source/math/reader/figure and every-page print checks pass. |
| P06 | Author/use BADP source headers, channel blocks, seek state and nibble decoding; do not import Sony ADPCM or SNES BRR. | BADP owner and central format constants. | Integrated; independent source/math/reader/figure and every-page print checks pass. |
| P07 | Program signed Q16 rate, source-Hz conversion, phase/start, forward/reverse loops and end conditions. | Playback, output and command facts. | Integrated; independent source/math/reader/figure and every-page print checks pass. |
| P08 | Generate a square source and choose period/duty/loop data with the actual hardware fields. | Generator/output facts. | Integrated; independent source/math/reader/figure and every-page print checks pass. |
| P09 | Set signed Q12 gain, stereo accumulation, clipping and sample-based fade; distinguish retained values from effective DAC values. | Output/playback facts. | Integrated; independent source/math/reader/figure and every-page print checks pass. |
| P10 | Program the Q14 biquad, packed coefficient halves, enable/bypass and retained histories. | Filter/output and live-edit facts. | Integrated; independent source/math/reader/figure and every-page print checks pass. |
| P11 | PLAY, STOP, gain, pause/resume and live-edit each slot without confusing capture with execution. | Command executor, slot bank and output facts. | Integrated; independent source/math/reader/figure and every-page print checks pass. |
| P12 | Upload/download sample RAM through CPU/manual or DMA modes, use DREQ/block boundaries and wait for actual transfer completion. | Transfer/memory/DMA facts. | Integrated; independent source/math/reader/figure and every-page print checks pass. |
| P13 | Observe single-latch end events, sequence/coalescence and source/controller acknowledgement; distinguish faults. | Event/fault/IRQ owners. | Integrated; independent source/math/reader/figure and every-page print checks pass. |
| R01 | Use all staging, command/status/fault/event, selected-slot, transfer, queue and clock ports with access/reset/full fields. | Complete register fact sheet plus scoped transfer facts. | Integrated; independent source/math/reader/figure and every-page print checks pass. |
| F01 | Predict actual fault emission, rejected source binds and representable metadata; distinguish declared codes from enforced behavior and reset from STOP. | Live validation/fault/reset facts. | Integrated; independent source/math/reader/figure and every-page print checks pass. |
| W01 | Execute real readonly PCM playback, slot selection/live gain, pause/resume/fade/end-event programming with typed authored data. | Frozen facts, existing BIOS/cartlib/compiler producers. | Integrated; independent source/math/reader/figure and every-page print checks pass. |
| W02 | Execute sample-RAM upload/readback and playback, waiting for DMA and APU stages separately. | Frozen transfer/voice/DMA facts and actual source-language route. | Integrated; independent source/math/reader/figure and every-page print checks pass. |
| W03 | Exercise square and compressed sources with meaningful inputs, expected output arithmetic and actual decode/clock evidence. | Frozen generator/BADP/filter/mixer facts and real asset producer if used. | Integrated; independent source/math/reader/figure and every-page print checks pass. |

## Acceptance

Merge the independently authored paragraphs without new hardware claims. Check
every address/field/reset/visibility/fault against current paired sources, replay
raw datapath/timing examples in both owners, and execute the actual cartridge
through ordinary startup. Printed code must reproduce runnable source. Perform
separate complete-reader, semantic-figure and every-page actual PDF checks.
Do not approve publication or declare the handbook complete by page count or a
green build. Undefined electrical ratings are future specification decisions,
not guessed numbers; the requested software-authoritative note is retained.

Previous goal turn was concrete progress: DMA chapter, real guest execution,
independent reviews, actual PDF inspection, commit and push completed. The full
installed-machine handbook remains active and incomplete.

The assigned APU manuscript and real cartridge are accepted. Source/reader and
all 28 printed pages were checked separately; this does not declare Book I
complete. The newly requested broader technical-specification audit and actual
graphics-output illustrations remain pending in `docs/manual/README.md`.
