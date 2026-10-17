# APU — frozen source evidence

Installed Book I audio unit. Register/command (APR), transfer/clock (APT) and
voice/format/datapath (APV) slices were independently extracted from scoped
mirrored spec leaves and live owners before public authorship. Actual BIOS,
cartridge-library and source-language producers (APUB) are explicitly shared,
not misrepresented as independent mirrors. No architecture document or
historical reference PDF supplied facts.

## Authority and boundaries

The live software contract is authoritative for this edition, as requested.
Undefined independent analog/pin/bus clocks, electrical sustained ratings and
external delivery latency are separate future specification decisions, not
invented numbers. Public fields remain raw register words; undeclared metadata
validation is not inferred from unused fault-code constants. Internal state
appendices below are not additional cartridge-visible words or a host API.
Cartridge socket/card programming remains Book II.

# APU register, command, slot, event and fault facts

Frozen 2026-10-17. Facts only, not chapter prose. No `docs/architecture.md` or reference PDF opened. No discrepancy found in the scoped paired declarations and owners. All addresses below are evaluated from the mirrored IO leaf; no inferred electrical ratings. Transfer datapath and sample-format/mix details belong to the other extractors. `R!` below means mapped writes raise the system READ_ONLY bus fault; `R/W0` means reads are device-produced and accepted writes do not alter that device state. This distinction is intentional, not a proposed runtime fix.

## APR01 — Address derivation and word ports

The APU register bank begins at `08000120h`. MMIO words are four bytes. The command staging bank contains 21 consecutive words; the selected-slot window contains 21 consecutive words at `08000194h`. `APU_SLOT_COUNT=16`, `APU_SLOT_INDEX_MASK=15`, `APU_PARAMETER_REGISTER_COUNT=21`.
- TS spec: `machine/ts/spec/bmsx/memory_map.ts:23–35`; `machine/ts/spec/bmsx/io.ts:3–97,297–360`; `machine/ts/spec/audio/apu.ts:25–52`.
- C++ spec: `machine/cpp/spec/bmsx/memory_map.h:29–39`; `machine/cpp/spec/bmsx/io.h:15–109,310–373`; `machine/cpp/spec/audio/apu.h:32–59`.

## APR02 — Complete 21-word command bank and selected-slot window

Each row: parameter index, staging name/address, corresponding selected-window address, staging reset, selected-window reset. All staging words and selected-window words are R/W raw words. Parameter datatypes/decoding are supplied by the playback/format fact slice, not invented here. The staging `SLOT` word is kept whole; actual selection uses bits 3:0.

| n | Name | Staging address | Selected-window address | Staging reset | Selected reset |
|---:|---|---|---|---|---|
|0|SOURCE_ADDR|08000120|08000194|00000000|00000000|
|1|SOURCE_BYTES|08000124|08000198|00000000|00000000|
|2|SOURCE_SAMPLE_RATE_HZ|08000128|0800019c|00000000|00000000|
|3|SOURCE_CHANNELS|0800012c|080001a0|00000000|00000000|
|4|SOURCE_BITS_PER_SAMPLE|08000130|080001a4|00000000|00000000|
|5|SOURCE_FRAME_COUNT|08000134|080001a8|00000000|00000000|
|6|SOURCE_DATA_OFFSET|08000138|080001ac|00000000|00000000|
|7|SOURCE_DATA_BYTES|0800013c|080001b0|00000000|00000000|
|8|SOURCE_LOOP_START_SAMPLE|08000140|080001b4|00000000|00000000|
|9|SOURCE_LOOP_END_SAMPLE|08000144|080001b8|00000000|00000000|
|10|SLOT|08000148|080001bc|00000000|00000000|
|11|RATE_STEP_Q16|0800014c|080001c0|00010000|00000000|
|12|GAIN_Q12|08000150|080001c4|00001000|00000000|
|13|START_SAMPLE|08000154|080001c8|00000000|00000000|
|14|FILTER_CONTROL|08000158|080001cc|00000000|00000000|
|15|FILTER_B0_B1|0800015c|080001d0|00004000|00000000|
|16|FILTER_B2_A1|08000160|080001d4|00000000|00000000|
|17|FILTER_A2|08000164|080001d8|00000000|00000000|
|18|FADE_SAMPLES|08000168|080001dc|00000000|00000000|
|19|GENERATOR_KIND|0800016c|080001e0|00000000|00000000|
|20|GENERATOR_DUTY_Q12|08000170|080001e4|00000800|00000000|

- Paired names/indices/addresses: TS `machine/ts/spec/audio/apu.ts:29–50`; `machine/ts/spec/bmsx/io.ts:58–89,297–341,353`; C++ `machine/cpp/spec/audio/apu.h:36–57`; `machine/cpp/spec/bmsx/io.h:70–101,310–354,366`.
- Staging raw write/default/reset/readback: TS `machine/ts/machine/devices/audio/command_latch.ts:25–69`; C++ `machine/cpp/machine/devices/audio/command_latch.cpp:10–47`.
- Selected window mapped R/W: TS `machine/ts/machine/devices/audio/controller.ts:109–113`; `command_executor.ts:107–120`; `slot_bank.ts:25–28,61–66`; C++ `machine/cpp/machine/devices/audio/controller.cpp:60–63`; `command_executor.cpp:66–81`; `slot_bank.cpp:9–12,45–50`.
- Raw read/write backing boundary: TS `machine/ts/machine/memory/memory.ts:366–375`; C++ `machine/cpp/machine/memory/memory.cpp:245–258`.

## APR03 — Other guest-visible addresses/access/reset

| Address | Name | Access | Reset read value |
|---|---|---|---|
|08000174|CMD|R/W trigger; reads zero after every public command case|00000000|
|08000178|STATUS|R!|00000020|
|0800017c|EVENT_KIND|R!|00000000|
|08000180|EVENT_SLOT|R!|00000000|
|08000184|EVENT_SOURCE_ADDR|R!|00000000|
|08000188|EVENT_SEQ|R!|00000000|
|0800018c|SELECTED_SOURCE_ADDR|R!|00000000|
|08000190|ACTIVE_MASK|R!|00000000|
|080001e8|TRANSFER_ADDRESS|R/W|00000000|
|080001ec|TRANSFER_DATA|R/W|00000000|
|080001f0|TRANSFER_CONTROL|R/W|00000000|
|080001f4|CMD_QUEUED|R/W0|00000000|
|080001f8|CMD_FREE|R/W0|00000010|
|080001fc|CMD_CAPACITY|R/W0|00000010|
|08000200|SAMPLE_SEQUENCE|R/W0|00000000|
|08010218|FAULT_CODE|R!|00000000|
|0801021c|FAULT_DETAIL|R!|00000000|
|08010220|FAULT_ACK|R/W acknowledge; reads zero|00000000|

Transfer port operation and sample clock progression are supplied by transfer facts; included here only for complete evaluated map/reset. STATUS reset is the OR of reset fault=0, no active/queued slots, FIFO empty bit5, transfer bits0.
- Paired address derivation: TS `machine/ts/spec/bmsx/io.ts:80–108,342–360`; C++ `machine/cpp/spec/bmsx/io.h:92–121,355–373`.
- CMD reset/clear: TS `machine/ts/machine/devices/audio/command_latch.ts:49–69`; `command_ingress.ts:25–45`; C++ `machine/cpp/machine/devices/audio/command_latch.cpp:27–47`; `command_ingress.cpp:23–45`.
- STATUS read/reset inputs: TS `machine/ts/machine/devices/audio/status_register.ts:21–29`; `slot_bank.ts:25–28`; `command_fifo.ts:24–49`; `sample_transfer.ts:54–67,85–91`; `controller.ts:124–133`; C++ `machine/cpp/machine/devices/audio/status_register.cpp:25–39`; `slot_bank.cpp:9–12`; `command_fifo.cpp:5–30`; `sample_transfer.cpp:23–36,54–71`; `controller.cpp:72–81`.
- Event reset/mirrors: TS `machine/ts/machine/devices/audio/event_latch.ts:31–36,65–69`; C++ `machine/cpp/machine/devices/audio/event_latch.cpp:13–18,47–51`.
- Selected-source/active reset: TS `machine/ts/machine/devices/audio/selected_slot_latch.ts:17–20`; `active_slots.ts:30–34`; `slot_bank.ts:25–28`; C++ `machine/cpp/machine/devices/audio/selected_slot_latch.cpp:16–19`; `active_slots.cpp:25–27`; `slot_bank.cpp:9–12`.
- Transfer port mapping and reset: TS `machine/ts/machine/devices/audio/service_clock.ts:42–48`; `sample_transfer.ts:54–67`; C++ `machine/cpp/machine/devices/audio/service_clock.cpp:29–36`; `sample_transfer.cpp:23–36`.
- Queue count/free/capacity read values: TS `machine/ts/machine/devices/audio/queue_status_registers.ts:11–18`; `command_fifo.ts:24–49`; C++ `machine/cpp/machine/devices/audio/queue_status_registers.cpp:11–19`; `command_fifo.cpp:5–30`.
- SAMPLE_SEQUENCE mapping/read/reset: TS `machine/ts/machine/devices/audio/service_clock.ts:43,51–63`; C++ `machine/cpp/machine/devices/audio/service_clock.cpp:31,39–42,93–99`.
- Fault register reset/ACK: TS `machine/ts/machine/devices/device_status.ts:25–55`; C++ `machine/cpp/machine/devices/device_status.cpp:12–30,53–63`.
- R! rejection list and system-fault edge: TS `machine/ts/machine/memory/memory.ts:627–632,852–895`; C++ `machine/cpp/machine/memory/memory.cpp:522–527,729–772`. Queue and SAMPLE_SEQUENCE are NOT in the rejected list and have no state-changing write handler: TS `audio/controller.ts:106–116`, `audio/service_clock.ts:42–48`; C++ `audio/controller.cpp:55–64`, `audio/service_clock.cpp:31–36`. Raw backing writes are overwritten/hidden by mapped read results, not command queue/sample-clock writes.

## APR04 — The staging write edge

Writing any of the 21 staging ports stores that whole word. Only writing staging `SLOT` immediately refreshes the selected-source/activity latch using its low four bits. It does not copy into a slot bank. Staging readback is the raw word backing.
- TS `machine/ts/machine/devices/audio/command_latch.ts:32–46`; `machine/ts/machine/memory/memory.ts:366–375`.
- C++ `machine/cpp/machine/devices/audio/command_latch.cpp:13–24`; `machine/cpp/machine/memory/memory.cpp:245–258`.

## APR05 — Six public command words, exact values

`NONE=00000000`, `PLAY=00000001`, `STOP_SLOT=00000002`, `SET_SLOT_GAIN=00000003`, `PAUSE_SLOT=00000004`, `RESUME_SLOT=00000005`. The full word is switched, not merely a low-byte opcode. Other words raise BAD_CMD with the entire command word as detail.
- Spec TS `machine/ts/spec/audio/apu.ts:18–23,68–77`; C++ `machine/cpp/spec/audio/apu.h:25–30,75–84`.
- Owner TS `machine/ts/machine/devices/audio/command_ingress.ts:25–45`; C++ `machine/cpp/machine/devices/audio/command_ingress.cpp:23–45`.

## APR06 — Capture, clearing, and NONE

A CMD write first synchronizes audio to the current service cycle. For each of commands1–5 it copies all21 current staging words into the FIFO, requests the next service edge, then resets all staging words to APR02 defaults, mirrors CMD0, and refreshes selection as slot0. The executing slot is captured in the FIFO; clearing the visible staging SLOT does not retarget the captured command. NONE queues nothing and does not clear the staged parameter words. An unrecognized word faults, clears staging to defaults, and schedules service. No branch tests a current APU fault to block valid later commands.
- TS `machine/ts/machine/devices/audio/command_ingress.ts:25–45`; `command_fifo.ts:52–67`; `command_latch.ts:49–69`.
- C++ `machine/cpp/machine/devices/audio/command_ingress.cpp:23–45`; `command_fifo.cpp:33–48`; `command_latch.cpp:27–47`.

## APR07 — FIFO capacity, order, and overflow behavior

The command FIFO has16 entries. Each entry stores one command word and21 parameter words. Entry admission copies the raw words; editing staging after admission does not change that FIFO entry. Pop reads the oldest entry, copies its21 words into dispatch, clears its stored command/parameters, advances read index, decrements count. When a write arrives while count16, it overwrites the oldest entry: count stays16 and read index becomes the new write index. There is no FIFO-full fault/rejection in this admission path. Therefore full/free status is useful for preserving every command; it is not an automatic producer stall.
- Spec TS `machine/ts/spec/audio/apu.ts:5,29,52`; C++ `machine/cpp/spec/audio/apu.h:23,36,59`.
- Owners TS `machine/ts/machine/devices/audio/command_fifo.ts:17–22,24–84`; `command_ingress.ts:25–45`; C++ `machine/cpp/machine/devices/audio/command_fifo.cpp:5–65`; `command_ingress.cpp:23–45`.

## APR08 — Execution edge and order

An APU service first synchronizes preceding audio/sample time, drains every queued command in FIFO order, then schedules further service. The draining loop itself does not assign a per-command elapsed-cycle cost or interleave sample rendering between successive queued commands. It dispatches PLAY/STOP/GAIN/PAUSE/RESUME, not NONE.
- TS `machine/ts/machine/devices/audio/controller.ts:186–189`; `command_executor.ts:82–86,123–143`.
- C++ `machine/cpp/machine/devices/audio/controller.cpp:93–96`; `command_executor.cpp:42–46,84–104`.

## APR09 — PLAY target, replacement, and failed binding

PLAY uses captured SLOT bits3:0. It loads the captured source fields, binds the source against the cartridge selection at execution, and only on successful binding sets target phase PLAYING, copies all21 captured words into that slot bank, and starts its output voice. A source binding failure raises SOURCE_RANGE with source address as detail and returns before replacing that slot's bank/phase/output. A nonzero generator-kind source does not require a sample-buffer binding in this path; generator production semantics belong to playback facts.
- TS `machine/ts/machine/devices/audio/command_executor.ts:146–159,228–236`; `slot_bank.ts:45–50`; `source.ts:28–44`.
- C++ `machine/cpp/machine/devices/audio/command_executor.cpp:107–120,187–193`; `slot_bank.cpp:29–34`; `source.cpp:5–17`; `source.h:15–17`.

## APR10 — STOP_SLOT

STOP_SLOT targets captured SLOT bits3:0 and reads captured FADE_SAMPLES. If target inactive, or if FADE_SAMPLES0, it stops the output and clears target phase and all21 target bank words. If target active and FADE_SAMPLES>0, it changes the phase to FADING plus any existing PAUSED flag and asks output to stop over that sample count. It does not clear the bank in the fading branch. Fade arithmetic/timing is supplied by playback facts. An immediate explicit stop does not call event emission.
- TS `machine/ts/machine/devices/audio/command_executor.ts:161–176`; `active_slots.ts:42–44`; `slot_bank.ts:53–58`.
- C++ `machine/cpp/machine/devices/audio/command_executor.cpp:122–137`; `active_slots.cpp:35–37`; `slot_bank.cpp:37–42`.

## APR11 — PAUSE_SLOT, RESUME_SLOT and SET_SLOT_GAIN

PAUSE_SLOT changes a non-idle, not-already-paused target to its old phase OR PAUSED and pauses output; idle/already-paused is unchanged. RESUME_SLOT acts only when PAUSED set, resumes output, and clears that phase flag. Neither operation clears target bank words. SET_SLOT_GAIN targets captured SLOT bits3:0 and routes the captured GAIN_Q12 raw word through the same selected-slot-write machinery as an immediate bank write; inactive slots retain the written gain word too. Exact gain decode belongs to playback facts.
- TS `machine/ts/machine/devices/audio/command_executor.ts:178–225`; `slot_bank.ts:35–42,65–66`; `contracts.ts:5–8`.
- C++ `machine/cpp/machine/devices/audio/command_executor.cpp:139–184`; `slot_bank.cpp:19–26,49–50`; `contracts.h:15–18`.

## APR12 — Slot-bank state and activity

There are16 banks of21 words, separate from the one staging bank and16 FIFO entries. Reset clears all slot words to0. PLAY copies21 words into the target bank. An idle phase clears that slot's ACTIVE_MASK bit; any non-idle phase sets it, including paused/fading phases. Writing a raw bank word does not itself activate an idle slot. Explicit stop and natural-ended stop clear bank words; deactivate-on-bad-live-rebind sets phase idle without clearing its bank.
- TS `machine/ts/machine/devices/audio/slot_bank.ts:16–67`; `active_slots.ts:37–54`; `command_executor.ts:201–211`.
- C++ `machine/cpp/machine/devices/audio/slot_bank.cpp:5–50`; `active_slots.cpp:30–47`; `command_executor.cpp:162–172`.

## APR13 — Selected-window read/write edge

Every selected-window read synchronizes audio to the access cycle and returns the indicated raw word in the bank selected by current staging SLOT bits3:0. Every selected-window write likewise synchronizes prior audio, stores the raw bank word immediately, applies its active-voice effect, refreshes the current selected-source/activity latch, and schedules service. This does not enqueue a command or reset staging. The selected-window's own parameter10 word is stored data; staging SLOT remains the window selector. Staging changes and bank writes are not the same write path.
- TS `machine/ts/machine/devices/audio/command_executor.ts:107–120,201–225`; `slot_bank.ts:61–66`.
- C++ `machine/cpp/machine/devices/audio/command_executor.cpp:66–81,162–184`; `slot_bank.cpp:45–50`.

## APR14 — Active source-buffer edits and failed live rebind

For active slots, bank writes to SOURCE_ADDR, SOURCE_BYTES, SOURCE_SAMPLE_RATE_HZ, SOURCE_CHANNELS, SOURCE_BITS_PER_SAMPLE, SOURCE_FRAME_COUNT, SOURCE_DATA_OFFSET, SOURCE_DATA_BYTES or GENERATOR_KIND take the source-buffer-replacement branch. Rebinding uses the cartridge selection at this write. Failure stops output, deactivates the slot without clearing raw bank words, raises SOURCE_RANGE with raw source address detail, and returns. Success replaces the output source. Other indices use the output's parameter-update path. Exact decoder/cursor/filter consequences belong to playback facts, not this extraction.
- TS `machine/ts/machine/devices/audio/source.ts:47–61`; `command_executor.ts:201–225`; `active_slots.ts:47–49`.
- C++ `machine/cpp/machine/devices/audio/source.h:19–28`; `command_executor.cpp:162–184`; `active_slots.cpp:40–42`.

## APR15 — Selected-source readback and active mask

SELECTED_SOURCE_ADDR is the selected bank's raw SOURCE_ADDR only while that slot active; otherwise0 even if its stored SOURCE_ADDR nonzero. STATUS selected-active bit1 is refreshed from the same selected-slot active bit. ACTIVE_MASK uses bit n for slot n. Changing staging SLOT, clearing staging to defaults, activating/stopping/deactivating/changing-phase, and selected-bank writes invoke relevant refreshes; the source readback is not a playback byte cursor.
- TS `machine/ts/machine/devices/audio/selected_slot_latch.ts:17–20`; `active_slots.ts:30–54`; `command_latch.ts:41–46,64–69`; `command_executor.ts:223–225`; `slot_bank.ts:76–77`.
- C++ `machine/cpp/machine/devices/audio/selected_slot_latch.cpp:16–19`; `active_slots.cpp:25–47`; `command_latch.cpp:18–24,42–47`; `command_executor.cpp:184`; `slot_bank.cpp:60–61`.

## APR16 — Complete STATUS bits

|Bit|Mask|Name|Condition at read|
|---:|---|---|---|
|0|00000001|FAULT|fault latch active|
|1|00000002|SELECTED_SLOT_ACTIVE|selected-source/activity latch set|
|2|00000004|BUSY|any active slot OR nonempty command FIFO|
|5|00000020|CMD_FIFO_EMPTY|command FIFO count0|
|6|00000040|CMD_FIFO_FULL|command FIFO count16|
|7|00000080|DMA_REQUEST|APU read OR write request|
|8|00000100|DMA_READ_REQUEST|mode DMA_READ3 AND transfer FIFO count16|
|9|00000200|DMA_WRITE_REQUEST|mode DMA_WRITE2 AND transfer FIFO count0|
|10|00000400|TRANSFER_BUSY|transfer batch scheduledWords nonzero|

Status reads synchronize audio first. Bits3–4 and11–31 are not added by these reset/runtime status producers. BUSY is not the sample-transfer-busy flag; paused active slots remain BUSY. Transfer bits supplied/confirmed by transfer extractor and independently opened at cited narrow owner lines.
- Spec TS `machine/ts/spec/audio/apu.ts:58–66`; C++ `machine/cpp/spec/audio/apu.h:65–73`.
- TS owner `machine/ts/machine/devices/audio/status_register.ts:21–29`; `selected_slot_latch.ts:17–20`; `sample_transfer.ts:85–91`; `slot_bank.ts:35–42`.
- C++ owner `machine/cpp/machine/devices/audio/status_register.cpp:25–39`; `selected_slot_latch.cpp:16–19`; `sample_transfer.cpp:54–71`; `slot_bank.cpp:19–26`.

## APR17 — Fault latch and acknowledgment

The first fault while FAULT0 stores raw code/detail and sets STATUS bit0. Further raises while bit0 set preserve that first code/detail. Reset gives code0/detail0/FAULT0. Any nonzero FAULT_ACK write clears code/detail and bit0, preserves other status flags, and resets ACK readback0. A zero write does nothing. This is an independent device-status latch: its raise/ACK path has no IRQ raise/ack call. It does not flush command FIFO or stop all voices.
- Binding of APU code/detail/ACK/FAULT mask: TS `machine/ts/machine/devices/audio/controller.ts:39–46,108`; C++ `machine/cpp/machine/devices/audio/controller.cpp:12–19,64`.
- Shared latch owner TS `machine/ts/machine/devices/device_status.ts:25–29,39–75`; C++ `machine/cpp/machine/devices/device_status.cpp:12–16,26–63`.

## APR18 — Faults actually raised by the scoped live APU owners

|Code|Name|Producer and detail|
|---|---|---|
|00000001|BAD_CMD|unrecognized full CMD word; detail is that word|
|00000102|SOURCE_RANGE|PLAY sample binding fails, or active bank source replacement binding fails; detail is SOURCE_ADDR|

PLAY source binding failure occurs before new activation/copy. Live bank failure occurs after raw bank write and deactivates that slot. Neither automatic action discards the first-latched fault if another remains unacknowledged.
- Code spec TS `machine/ts/spec/audio/apu.ts:68–77`; C++ `machine/cpp/spec/audio/apu.h:75–84`.
- TS producers `machine/ts/machine/devices/audio/command_ingress.ts:41–44`; `command_executor.ts:140–142,152–158,201–211`.
- C++ producers `machine/cpp/machine/devices/audio/command_ingress.cpp:41–44`; `command_executor.cpp:101–103,113–119,162–172`.

## APR19 — Declared fault words with no producer in this scoped live audio tree

Spec also names SOURCE_BYTES0101, SOURCE_SAMPLE_RATE0103, SOURCE_CHANNELS0104, SOURCE_FRAME_COUNT0105, SOURCE_DATA_RANGE0106, SOURCE_BIT_DEPTH0107, UNSUPPORTED_FORMAT0201. These names/values are declarations only; do NOT promise validation/fault conditions from the names. Scoped live `machine/{ts,cpp}/machine/devices/audio` only raises APR18 codes (enumerated occurrences checked). This is an editorial source distinction, not a mismatch: spec leaf declares constants, not mandatory validations.
- Spec TS `machine/ts/spec/audio/apu.ts:68–77`; C++ `machine/cpp/spec/audio/apu.h:75–84`.
- Actual complete raise sites: APR18 source paths/lines (plus internal executor unknown-command default there).

## APR20 — Slot-ended event, sequence, ordering and IRQ

The one event latch stores latest kind/slot/source address, not an event FIFO. `EVENT_NONE=0`, `EVENT_SLOT_ENDED=1`. When output reports an ended slot during sample advancement, the active-slot owner reads that slot's raw source address, stops/clears the slot, then emits SLOT_ENDED. It scans slots in ascending0..15 order. Emit increments EVENT_SEQ modulo2^32, replaces latest event kind/slot/source address, mirrors all four registers, then raises central `IRQ_APU` bit5 (`00000020`). Multiple ends in one scan therefore increment the sequence for each and leave the last/highest ended slot in the event latch. An immediate explicit STOP, pause/resume/gain, bad CMD or binding fault has no call to this emit path. Natural/fade-end timing belongs to playback facts.
- Spec TS `machine/ts/spec/audio/apu.ts:83–84`; `machine/ts/spec/bmsx/io.ts:367`; C++ `machine/cpp/spec/audio/apu.h:90–91`; `machine/cpp/spec/bmsx/io.h:380`.
- TS `machine/ts/machine/devices/audio/active_slots.ts:57–64`; `event_latch.ts:31–36,56–69`; `command_executor.ts:161–198`.
- C++ `machine/cpp/machine/devices/audio/active_slots.cpp:50–57`; `event_latch.cpp:13–18,38–51`; `command_executor.cpp:122–159`.

## APR21 — Read side effects for queue, events, status and selection

CMD_QUEUED/FREE/CAPACITY report FIFO count/16-count/16 without an audio synchronization call in their own handlers. Event words, ACTIVE_MASK and SELECTED_SOURCE_ADDR are backing mirrors, not read-to-clear. STATUS and selected-window reads explicitly synchronize prior audio. SAMPLE_SEQUENCE explicitly synchronizes then returns low32. No APU event-read/ACK operation is mapped by the controller; central IRQ acknowledgment is a separate installed IRQ controller operation (its semantics are outside this sheet).
- TS `machine/ts/machine/devices/audio/controller.ts:106–116`; `queue_status_registers.ts:11–18`; `status_register.ts:21–29`; `command_executor.ts:107–112`; `event_latch.ts:65–69`; `service_clock.ts:43,51–53`; `machine/ts/machine/memory/memory.ts:366–368`.
- C++ `machine/cpp/machine/devices/audio/controller.cpp:55–64`; `queue_status_registers.cpp:11–19`; `status_register.cpp:25–39`; `command_executor.cpp:66–72`; `event_latch.cpp:47–51`; `service_clock.cpp:31,39–42`; `machine/cpp/machine/memory/memory.cpp:245–250`.

## APR22 — Reset ownership (guest behavior only)

APU reset resets FIFO, all slot state/banks, sample-memory/transfer/service clock, output voices, fault latch, staging defaults, event latch and active/selected mirrors. No reset command is among CMD0..5. Do not invent an APU global-reset CMD value.
- TS `machine/ts/machine/devices/audio/controller.ts:124–133`; `command_ingress.ts:25–45`.
- C++ `machine/cpp/machine/devices/audio/controller.cpp:72–81`; `command_ingress.cpp:23–45`.

## Internal state only — NOT extra guest registers

APR-I01: Snapshot first synchronizes current audio. It saves staging21 raw words; FIFO command16 and parameter336 words/read/write/count; event sequence/kind/slot/source; slot phases16 and bank336 words; sample RAM; sample-transfer state; output-voice state; sample carry/sequence; APU status/code/detail. Restore reinstalls these and voices then schedules next service. These are persistence fields, not a guest-visible MMIO expansion.
- TS `machine/ts/machine/devices/audio/controller.ts:136–174`; `command_fifo.ts:9–14,87–106`; `save_state.ts:62–78`.
- C++ `machine/cpp/machine/devices/audio/save_state.cpp:75–112`; `command_fifo.cpp:68–83`; `save_state.h:70–86`.


---

# Frozen APU transfer and clock facts

Scope: mirrored audio spec leaf, installed model and I/O spec, APU sample-memory/transfer/service-clock owners, and their narrow mapped-memory/DMA/CPU boundary. No architecture document, reference PDF, host audio resampling, or runtime modifications. Facts frozen 2026-10-17. No behavior disagreement found in this bounded slice. Sources are repository-relative; TS and C++ source lines were read directly. This is an editorial evidence sheet, not public chapter prose. Complete register addresses belong to the register extractor.

## Public hardware facts

### APT01 — Private sample RAM and source addressing
- Installed sample RAM capacity is 512 × 1024 bytes = 524,288 bytes = 131,072 words. The sample-source address base is 40000000H. Its bounded byte range is 40000000H–4007FFFFH inclusive. Reset fills its bytes with zero.
- A nonempty source descriptor addresses sample RAM only when its full byte range fits there. Source binding does not wrap an overlong descriptor around RAM. Sample RAM source offsets are byte offsets; binding imposes no word alignment.
- Sources: `machine/ts/spec/audio/apu.ts:6–8`; `machine/cpp/spec/audio/apu.h:10–12`; `machine/ts/machine/devices/audio/sample_memory.ts:16–29`; `machine/cpp/machine/devices/audio/sample_memory.cpp:13–28`.

### APT02 — No ordinary CPU load/store aperture at the source base
- Ordinary mapped reads/writes have system-ROM, installed RAM and cartridge aperture paths, but no sample-RAM path. Address 40000000H is beyond cartridge-bus end 31000000H and is unmapped on that path: word reads return zero and raise system bus fault UNMAPPED=1; word writes raise that bus fault without writing sample RAM. Programs use the APU transfer port to modify/read back sample RAM; 40000000H is a sample-source descriptor address, not a CPU pointer to those bytes.
- Sources: `machine/ts/spec/bmsx/memory_map.ts:9–21`; `machine/cpp/spec/bmsx/memory_map.h:15–27`; `machine/ts/machine/memory/memory.ts:544–570,627–656`; `machine/cpp/machine/memory/memory.cpp:434–460,522–550`; UNMAPPED encoding `machine/ts/spec/bmsx/io.ts:399–400`; `machine/cpp/spec/bmsx/io.h:412–413`.

### APT03 — Transfer address is raw programming, not progress readback
- TRANSFER_ADDRESS retains the full written word. A write replaces the internal sample-RAM offset with `word & 0007FFFCH`: upper bits and bits 1:0 do not enter the offset.
- A transfer word is little-endian, four bytes. Each actual sample-RAM transfer advances the internal offset by four, wrapping with mask 0007FFFFH. This progression does not update the programmed TRANSFER_ADDRESS word. Readback of that port remains the full programmed word, not the moving offset.
- Sources: `machine/ts/machine/devices/audio/sample_transfer.ts:142–145,151–156,201–216`; `machine/cpp/machine/devices/audio/sample_transfer.cpp:113–116,134–140,195–210`; sample-memory word access `machine/ts/machine/devices/audio/sample_memory.ts:41–47`; `machine/cpp/machine/devices/audio/sample_memory.cpp:33–39`; raw MMIO fallback/read/write `machine/ts/machine/memory/memory.ts:366–376`; `machine/cpp/machine/memory/memory.cpp:245–259`; transfer mapping has ADDRESS write only `machine/ts/machine/devices/audio/service_clock.ts:43–48`; `machine/cpp/machine/devices/audio/service_clock.cpp:31–36`.

### APT04 — Transfer control retained word and mode
- TRANSFER_CONTROL retains all written bits; bits 1:0 select mode: 0 STOP, 1 MANUAL_WRITE, 2 DMA_WRITE, 3 DMA_READ. No other bits are decoded by this datapath.
- A change of the decoded mode cancels the scheduled batch, empties FIFO indices/count, resets fractional transfer timing carry, then adopts the new mode. It does not clear sample RAM, the data latch, the programmed address or the current offset.
- Rewriting the same mode, including a word differing only in upper bits, does not clear FIFO, cancel an admitted batch or reset carry. Either form of control write updates requests and tries to schedule work if no batch is already scheduled.
- Sources: `machine/ts/spec/audio/apu.ts:12–16`; `machine/cpp/spec/audio/apu.h:15–19`; `machine/ts/machine/devices/audio/sample_transfer.ts:182–199,218–243`; `machine/cpp/machine/devices/audio/sample_transfer.cpp:153–177,212–242`.

### APT05 — CPU data accesses
- CPU DATA reads return the existing data latch without popping FIFO, reading sample RAM or advancing address, in every mode.
- CPU DATA writes always replace that latch. In MANUAL_WRITE only, the word is written directly into sample RAM at the current offset and the offset advances immediately by four with wrap. In other modes this CPU write only changes the latch: it neither enqueues FIFO nor writes sample RAM.
- Sources: `machine/ts/machine/devices/audio/sample_transfer.ts:147–157`; `machine/cpp/machine/devices/audio/sample_transfer.cpp:118–120,134–140`; bus-master dispatch `machine/ts/machine/devices/audio/service_clock.ts:152–171`; `machine/cpp/machine/devices/audio/service_clock.cpp:45–74`.

### APT06 — DMA data accesses and saturation behavior
- DMA DATA writes always replace the data latch. In mode2 they attempt to append the word to FIFO. A full FIFO discards the appended word; the data latch still changes. Outside mode2 these DMA writes do not enqueue or modify sample RAM.
- DMA DATA reads in mode3 with nonempty FIFO pop its oldest word into the latch and return it. Outside mode3, or with empty FIFO, they return the existing latch, with no dequeue/address movement.
- FIFO capacity is 16 words. The ring's read/write ordering is FIFO ordering. The listed full/empty/wrong-mode behaviors do not themselves raise an APU fault in this datapath.
- Sources: `machine/ts/spec/audio/apu.ts:9`; `machine/cpp/spec/audio/apu.h:13`; `machine/ts/machine/devices/audio/sample_transfer.ts:159–180,245–258`; `machine/cpp/machine/devices/audio/sample_transfer.cpp:122–132,142–151,179–193`.

### APT07 — DMA block-end scheduling
- Mode2 DMA writes update request lines after each append. On the last word of an admitted DMA-controller block, they then try to schedule the FIFO→RAM batch.
- Mode3 DMA reads update request lines after each dequeue. On the last word of an admitted DMA-controller block, they then try to schedule the RAM→FIFO refill batch.
- This is block-end, not DMA-channel DONE: a channel with further words also supplies the edge. Both source and destination mapped accesses of the final word carry BLOCK_END. An already scheduled APU batch is not enlarged or repriced by another scheduling attempt.
- Sources: `machine/ts/machine/devices/audio/sample_transfer.ts:159–180,218–236`; `machine/cpp/machine/devices/audio/sample_transfer.cpp:122–132,142–151,212–235`; `machine/ts/machine/devices/dma/controller.ts:229–235`; `machine/cpp/machine/devices/dma/controller.cpp:159–165`.

### APT08 — Batch size and service edge
- With no batch scheduled, mode2 schedules exactly the FIFO count then present; mode3 schedules exactly `16 - FIFO count` then present. STOP/MANUAL_WRITE schedule no work. Zero words schedule no service.
- All scheduled words become effective at the single batch completion edge, not one visible word every transfer-word interval. Mode2 pops that many FIFO words and writes them to sample RAM in order; mode3 reads that many consecutive sample-RAM words and pushes them to FIFO in order. Address progression occurs there, once per transferred word.
- The scheduled count and deadline are retained, but the address is the current internal offset at completion: writing TRANSFER_ADDRESS while a batch is pending changes where that pending batch accesses RAM. Mode changes cancel it as APT04.
- Completion clears scheduled-word count, transfers the batch, updates requests, then tries to schedule the next batch anchored to the completed stored deadline.
- Sources: `machine/ts/machine/devices/audio/sample_transfer.ts:135–145,201–243`; `machine/cpp/machine/devices/audio/sample_transfer.cpp:113–116,166–171,195–242`.

### APT09 — Request lines and STATUS transfer bits
- APU_WRITE selector3 is asserted iff mode2 and FIFO count=0.
- APU_READ selector4 is asserted iff mode3 and FIFO count=16.
- STATUS bit7 DMA_REQUEST is the OR of these; bit8 DMA_READ_REQUEST reflects the read condition; bit9 DMA_WRITE_REQUEST reflects the write condition; bit10 TRANSFER_BUSY is set iff a sample-RAM batch is scheduled.
- Thus DMA_WRITE mode with empty FIFO can have write request=1 and TRANSFER_BUSY=0; DMA_READ mode with full FIFO can have read request=1 and TRANSFER_BUSY=0, without having stopped mode3.
- Sources: selectors `machine/ts/spec/bmsx/io.ts:386–387`; `machine/cpp/spec/bmsx/io.h:399–400`; status encodings `machine/ts/spec/audio/apu.ts:63–66`; `machine/cpp/spec/audio/apu.h:70–73`; predicates `machine/ts/machine/devices/audio/sample_transfer.ts:85–92,261–265`; `machine/cpp/machine/devices/audio/sample_transfer.cpp:54–72,244–248`.

### APT10 — Admission versus ready words
- DMA-controller block admission ANDs its read and write request selectors. FORCE0 always passes, DISABLED15 never passes. APU request dropping after the first word does not interrupt the already admitted block: the controller performs every read/write in that block and marks only its final pair BLOCK_END.
- Correct APU request selection gates complete blocks when FIFO is empty/full; it is not a substitute for correct fixed DATA address or mode. FORCE does not override APT06 latch/full/empty behavior.
- Sources: `machine/ts/machine/devices/dma/controller.ts:229–235,403–405,487–501`; `machine/cpp/machine/devices/dma/controller.cpp:159–165,327–328,412–426`; APT06/APT09 paired APU sources.

### APT11 — CPU DATA-write ownership and wait
- DMA DATA writes are always reported ready by the APU port; they are not stalled by FIFO occupancy (APT06 determines what they do).
- CPU DATA writes are ready iff neither busy DMA channel owns DATA as its exact read or exact write port. This excludes CPU writes while either direction is DMA-owned, including a channel waiting for its requests. The ownership test is not a FIFO-full test and does not block CPU DATA reads.
- Ownership uses the captured block base address for an active admitted channel, otherwise the channel's current programmed address, and BUSY status. CPU typed store execution waits before performing a not-ready mapped write; DMA completion/port release resumes a blocked write only when neither direction still owns that exact address.
- Sources: `machine/ts/machine/devices/audio/service_clock.ts:43–48,173–183`; `machine/cpp/machine/devices/audio/service_clock.cpp:31–36,76–83`; `machine/ts/machine/devices/dma/controller.ts:180–196,377–383,517–530`; `machine/cpp/machine/devices/dma/controller.cpp:110–126,301–307,442–455`; `machine/ts/machine/memory/memory.ts:261–266`; `machine/cpp/machine/memory/memory.cpp:181–186`; CPU store `machine/ts/machine/cpu/cpu.ts:3117–3133`; `machine/cpp/machine/cpu/cpu_dispatch.inl:646–660`.

### APT12 — Timing constants
- Sample-clock rate is 44,100 samples/second. Transfer budget is `44,100 × 24 = 1,058,400` words/second.
- Installed system cycle frequency is 33,868,800 cycles/second. Therefore one sample-clock interval is exactly 768 system cycles; sample-RAM transfer scheduling costs exactly32 cycles per word, so 16 words cost512 cycles and 4 words cost128 cycles, at installed timing and normal zero carry. These are internal transfer costs, not complete CPU-call or DMA source-bus costs and not electrical pin/bus ratings.
- Sources: `machine/ts/spec/audio/apu.ts:1,10`; `machine/cpp/spec/audio/apu.h:9,14`; installed model `machine/ts/spec/bmsx/model.ts:7,46–47`; `machine/cpp/spec/bmsx/model.h:12,51–52`; propagation `machine/ts/machine/machine.ts:123–125`; `machine/cpp/machine/machine.cpp:66–68`; transfer timing owner APT13.

### APT13 — Exact transfer carry/deadline calculation
- For system-cycle frequency H, word budget R=1,058,400, carry C and admitted words N, needed=`N*H-C`. Cycles=1 when needed<=0, otherwise integer quotient `(needed+R-1)/R`. New carry=`(R*cycles+C) % H`. Batch deadline=`anchor+cycles`. The carry is updated on scheduling, not on each data access.
- Initial/reset carry0, mode changes reset it; same-mode writes do not. At installed H=32R with reset carry0, all admitted integer-word batches have cycles32N and carry stays0.
- Sources: `machine/ts/machine/scheduler/budget.ts:12–19`; `machine/cpp/machine/scheduler/budget.h:18–21`; `machine/ts/machine/devices/audio/sample_transfer.ts:54–67,182–192,218–236`; `machine/cpp/machine/devices/audio/sample_transfer.cpp:23–36,153–163,212–235`.

### APT14 — Transfer before sample-clock edge
- Synchronization completes every due transfer batch in deadline order. It advances voices up to cycle `deadline-1`, completes the transfer batch, then advances voices through `deadline`. Consequently a RAM batch completing at a sample-clock edge is visible to that edge's voice processing.
- Transfer MMIO access at cycle t first completes earlier transfers with normal intervening voice progress; advances voices through t-1; completes transfers due exactlyt; applies the register access; then advances voices through t. Thus transfers due at that cycle precede the register access, and the register access precedes voice processing at that cycle. This ordering applies ADDRESS writes, DATA reads/writes and CONTROL writes.
- Sources: `machine/ts/machine/devices/audio/service_clock.ts:118–127,145–171,185–205`; `machine/cpp/machine/devices/audio/service_clock.cpp:45–74,85–91,156–165,187–200`.

### APT15 — Sample sequence and sample carry
- SAMPLE_SEQUENCE read synchronizes through current cycle and returns the low32 bits of the accumulated sample count. Reset count is0 and reset fractional sample carry0, with the reset cycle establishing the time origin.
- With elapsed cycles d, sample budget numerator=`44100*d+carry`; whole samples=integer quotient by system-cycle frequency, next carry=remainder. Active slot advancement receives the previous sequence and whole sample count, then sequence increases by that whole count, including intervals with no active slots. At installed timing the sequence increments once every768 cycles from its reset phase.
- Sources: `machine/ts/machine/devices/audio/service_clock.ts:43,51–63,207–221`; `machine/cpp/machine/devices/audio/service_clock.cpp:31,39–43,93–100,202–216`; `machine/ts/machine/scheduler/budget.ts:6–10`; `machine/cpp/machine/scheduler/budget.h:12–16`.

### APT16 — Register readback/write-access distinction
- ADDRESS/CONTROL are mapped writes with no custom read callback, hence read their raw full programmed MMIO words. DATA has both read/write callbacks. SAMPLE_SEQUENCE has a read callback but no write callback.
- The system bus read-only-address switch does NOT include SAMPLE_SEQUENCE. A word write therefore changes its raw backing MMIO slot without changing its internal sequence; subsequent mapped read still reports the synchronized internal sequence, not that written backing word. Do not claim such a write is rejected with a read-only fault.
- This is an access fact, not advice to use that ignored-for-sequence write.
- Sources: `machine/ts/machine/devices/audio/service_clock.ts:43–48,51–54`; `machine/cpp/machine/devices/audio/service_clock.cpp:31–43`; raw-slot dispatch `machine/ts/machine/memory/memory.ts:366–376,627–642,852–895`; `machine/cpp/machine/memory/memory.cpp:245–259,522–536,729–772`.

### APT17 — Reset of transfer unit
- Reset cancels transfer service, zeros all16 stored FIFO words and empties FIFO indices/count, clears raw ADDRESS/DATA/CONTROL readback0, internal offset0, latch0, modeSTOP, transfer carry0, scheduled count/deadline0, and deasserts both APU request lines.
- Sample RAM zeroing is separate from stopping/changing modes. STOP is not a sample-memory clear operation (APT04).
- Sources: `machine/ts/machine/devices/audio/sample_transfer.ts:54–68,195–199,239–243,261–265`; `machine/cpp/machine/devices/audio/sample_transfer.cpp:23–37,173–177,238–248`; sample memory reset `machine/ts/machine/devices/audio/sample_memory.ts:16–18`; `machine/cpp/machine/devices/audio/sample_memory.cpp:13–15`.

### APT18 — DMA DONE versus sample-RAM completion
- DMA START with nonzero count sets channel STATUS BUSY; final mapped-word accesses and address/count readback updates occur before setting channel STATUS DONE and raising its DMA0/DMA1 IRQ. Zero count completes at START without port accesses. The APU sample-transfer unit itself has no START/DONE register and raises no completion IRQ in these transfer methods.
- For upload, final DMA DATA writes enqueue FIFO and schedule the APU batch at block end; controller DONE can therefore precede sample-RAM commit. A program needing committed sample bytes must distinguish the DMA channel's completion from STATUS TRANSFER_BUSY becoming0; before switching away from DMA_WRITE ensure the final scheduled batch has completed, because a mode change cancels it.
- For download, a full FIFO is filled before APU_READ request permits admission. DMA then dequeues its data; block end can schedule another prefetch even when the DMA channel will becomeDONE. A program may change toSTOP after reading the desired words to cancel unnecessary further prefetch; DATA CPU reads never drain it.
- Sources: `machine/ts/machine/devices/dma/controller.ts:131–143,229–253,365–370`; `machine/cpp/machine/devices/dma/controller.cpp:62–73,159–183,289–294`; `machine/ts/machine/devices/audio/sample_transfer.ts:159–192,201–236,261–265`; `machine/cpp/machine/devices/audio/sample_transfer.cpp:122–171,195–235,244–248`.

### APT19 — Narrow mapped-I/O bus faults
- APU register ports are four-byte word ports. Mapped byte writes or halfword accesses in I/O raise system bus fault UNALIGNED_IO=2; unaligned mapped word I/O also raises that fault without port callback. A mapped byte read at an aligned I/O word address executes that word's read callback and returns low8 bits; it is not a byte lane read.
- STATUS, APU_FAULT_CODE/DETAIL and event/selected-source/active-mask read-only words listed by the bus reject mapped word writes with READ_ONLY=3 before updating the raw slot/callback. The three transfer ports are not read-only. These are system-bus faults, separate from APU source/command fault latches.
- Sources: `machine/ts/spec/bmsx/io.ts:399–402`; `machine/cpp/spec/bmsx/io.h:412–415`; `machine/ts/machine/memory/memory.ts:442–449,466–470,503–507,549–555,603–607,627–646,875–883`; `machine/cpp/machine/memory/memory.cpp:332–339,356–360,393–397,439–445,498–502,522–540,752–760`.

### APT20 — Fault does not retroactively negate DMA DONE
- The admitted DMA loop has no bus-fault abort branch: it executes its captured word count, advances addresses/count and finishes a channel normally if count reaches0. A transfer to an unmapped or read-only destination can therefore still yield DMA DONE/IRQ. Neither DMA DONE nor TRANSFER_BUSY=0 proves correct data reached the intended bytes; use the intended mapped DATA port and transfer mode.
- Sources: `machine/ts/machine/devices/dma/controller.ts:211–253`; `machine/cpp/machine/devices/dma/controller.cpp:141–184`; faulting mapped paths as APT02/APT19.

## Editorial/internal facts — exclude from cartridge-manual prose

### APTI01 — Save-state words
- Transfer snapshot stores FIFO16 words, read/write indices/count, raw address/data/control, current offset, transfer timing carry, scheduled words and remaining scheduled cycles. Restore reconstructs mode from control bits1:0, reestablishes raw mirrors/requests and reschedules retained nonzero work. RAM snapshot is all524,288 bytes; service-clock snapshot includes sample carry and sequence. This does not create cartridge-visible save registers.
- Sources: `machine/ts/machine/devices/audio/sample_transfer.ts:94–133`; `machine/cpp/machine/devices/audio/sample_transfer.cpp:74–111`; `machine/ts/machine/devices/audio/sample_memory.ts:49–56`; `machine/cpp/machine/devices/audio/sample_memory.cpp:41–48`; `machine/ts/machine/devices/audio/service_clock.ts:74–96`; `machine/cpp/machine/devices/audio/service_clock.cpp:111–134`.

### APTI02 — Non-cartridge clock hold and model timing
- Voice-clock hold synchronizes first, suppresses later voice/sample-sequence accrual, and clears output ring/cancels voice service when held. Transfer synchronization continues independently. It is an internal supervisor/host lifecycle control, not a cartridge register. Restores clear held state.
- setCpuHz synchronizes old state, retimes transfer (cancelling admitted transfer batch and zeroing its carry when the supplied frequency differs), then adopts the new system frequency. Installed manual constants are APT12, not constructor placeholder frequencies.
- Sources: `machine/ts/machine/devices/audio/service_clock.ts:90–116,118–127,207–221`; `machine/cpp/machine/devices/audio/service_clock.cpp:123–165,202–216`; `machine/ts/machine/devices/audio/sample_transfer.ts:75–83`; `machine/cpp/machine/devices/audio/sample_transfer.cpp:44–52`.

### APTI03 — Deliberate omissions
- This slice supplies no independent analog DAC clock, external sample-memory bus frequency, pin timing, electrical sustained transfer rating, audio-output transport latency, format decoding, voice interpolation, command FIFO execution cost, source-fault detail encodings or PLAY configuration. Do not infer those from the transfer budget. Other scoped extractors own playback/format and command/register facts.


---

# Frozen APU voice, sample-format and output facts

Scope: mirrored `spec/audio/apu` plus the live source, playback, output, decoder, filter and directly supporting slot/executor/sample-memory owners. Transfer protocol, host transport, resampling and publication prose are excluded. `docs/architecture.md` and the reference PDF were not opened. No confirmed spec/owner/mirror disagreement was found in the facts below. A constant declaring a fault number does not by itself declare an emitting condition.

Each APV fact is a bounded source-backed fact slice. Paired TS/C++ locations are supplied for independent review. Text after **Internal** is not cartridge-manual material. Formulas use mathematical signed integers; `ASR_k` is signed division by 2^k rounded toward negative infinity; `WRAP32` retains the low word interpreted as signed.

## Installed voice resources and source words

### APV01 — Voice/output resources
- Sixteen independently indexed slots, selected using the low four bits of the slot word. There are 21 parameter words per slot.
- Output sampling frequency is 44,100 stereo frames per second. The output datapath finally emits signed 16-bit left and right samples.
- Sources: `machine/ts/spec/audio/apu.ts:1–4,25–29,51–55`; `machine/cpp/spec/audio/apu.h:9,20–22,32–36,58–62`; output stereo and final signed range: `machine/ts/machine/devices/audio/output.ts:320,390–392,440–446`; `machine/cpp/machine/devices/audio/output.cpp:231,309–311,363–369`.

### APV02 — Raw source metadata
- Parameter indices 0–9 contain source address, source byte extent, source sample rate in Hz, channels, bits per sample, frame count, data offset, data byte count, loop-start sample, loop-end sample. Generator kind and duty occupy indices 19 and 20.
- Loading a source copies those parameter words directly. There is no parsing of a PCM container header to obtain those fields.
- Sources: `machine/ts/spec/audio/apu.ts:30–39,49–50`; `machine/cpp/spec/audio/apu.h:37–46,56–57`; `machine/ts/machine/devices/audio/source.ts:28–40`; `machine/cpp/machine/devices/audio/source.cpp:5–17`.

### APV03 — Source-region binding and lifetime
- A non-generator source binds the entire `(SOURCE_ADDR, SOURCE_BYTES)` region at PLAY execution. A successful bind is required before the slot is replaced or activated. The cartridge source slot used is the currently selected cartridge slot at execution.
- Sample RAM sources use base `40000000H`, capacity 512 KiB, nonzero byte extent, and a region wholly within that RAM. Otherwise binding is restricted to ROM regions; ordinary main RAM is not a playback source.
- The voice retains a view of the bound storage, not a copied payload. PCM reads and BADP reads are performed from that storage during decoding. BADP also caches its current and previous decoded frame, so rewriting compressed bytes is not a promise to invalidate already-decoded frames.
- Sources: PLAY/bind `machine/ts/machine/devices/audio/command_executor.ts:146–158,228–236`; `machine/cpp/machine/devices/audio/command_executor.cpp:107–119,187–193`; RAM `machine/ts/machine/devices/audio/sample_memory.ts:20–38`; `machine/cpp/machine/devices/audio/sample_memory.cpp:17–30`; ROM-only view `machine/ts/machine/memory/memory.ts:708–718`; `machine/cpp/machine/memory/memory.cpp:623–633`; retained view `machine/ts/machine/devices/audio/output.ts:460–470,532–546`; `machine/cpp/machine/devices/audio/output.cpp:383–395,470–493`; BADP cache `machine/ts/machine/devices/audio/badp_decoder_hot_path.ts:69–89`; `machine/cpp/machine/devices/audio/badp_decoder_hot_path.h:154–179`.

### APV04 — Binding failure is the checked PLAY source failure
- A failed non-generator bind raises `SOURCE_RANGE = 0102H` with `SOURCE_ADDR` as detail and returns before changing the active slot.
- The live PLAY path does not test source sample rate, channels, frame count, data offset, data byte count or bit depth. The corresponding declared fault numbers must not be described as metadata-validation behavior merely because they exist in the spec leaf.
- The decoder uses FRAME_COUNT and DATA_OFFSET. DATA_BYTES is retained in the source/slot words but does not bound the PCM/BADP reads in the output path. SOURCE_BYTES bounds the binding, not each subsequent decode operation. Do not promise clipping, padding, silence, or recovery for a metadata/data mismatch.
- Sources: `machine/ts/machine/devices/audio/command_executor.ts:146–158,228–236`; `machine/cpp/machine/devices/audio/command_executor.cpp:107–119,187–193`; declarations `machine/ts/spec/audio/apu.ts:68–77`; `machine/cpp/spec/audio/apu.h:75–84`; source copies `machine/ts/machine/devices/audio/source.ts:28–40`; `machine/cpp/machine/devices/audio/source.cpp:5–17`; output build/read paths `machine/ts/machine/devices/audio/output.ts:460–488,532–546`; `machine/cpp/machine/devices/audio/output.cpp:383–417,470–493`.

### APV05 — Format/generator selection is a datapath branch
- Generator kind zero selects source-buffer playback; any nonzero kind bypasses source binding. The defined square generator is kind one.
- For a non-generator source, bits-per-sample four selects BADP. Otherwise bit depth sixteen selects 16-bit PCM; every other bit-depth word reaches the 8-bit PCM branch. The owner does not raise UNSUPPORTED_FORMAT for that branch selection.
- The actual output generator branch tests specifically for kind one. Do not invent output behavior or validity guarantees for other nonzero generator kinds; these do not acquire bound source bytes.
- Sources: `machine/ts/spec/audio/apu.ts:27–28`; `machine/cpp/spec/audio/apu.h:34–35`; generator test `machine/ts/machine/devices/audio/source.ts:43–45`; `machine/cpp/machine/devices/audio/source.h:15–17`; bind bypass `machine/ts/machine/devices/audio/command_executor.ts:228–236`; `machine/cpp/machine/devices/audio/command_executor.cpp:187–193`; format/generator branches `machine/ts/machine/devices/audio/output.ts:358–364,468–470,532–546`; `machine/cpp/machine/devices/audio/output.cpp:273–282,383–385,470–493`.

## PCM and BADP byte formats

### APV06 — PCM sample layout
- A PCM frame starts at sample index `frame * CHANNELS`; channel zero is left; channel one is right. A one-channel source repeats its left sample to the right output.
- PCM8 bytes are unsigned offset-binary: decoded sample `(byte − 128) * 256`, giving −32768 through 32512.
- PCM16 consists of signed little-endian halfwords.
- PCM data begins at `SOURCE_ADDR + DATA_OFFSET`; PCM16 sample n uses relative byte offset `DATA_OFFSET + 2*n`, PCM8 sample n uses `DATA_OFFSET + n`.
- Sources: `machine/ts/machine/devices/audio/output.ts:460–465,539–546`; `machine/cpp/machine/devices/audio/output.cpp:391–396,488–493`; `machine/ts/machine/devices/audio/pcm_decoder_hot_path.ts:4–8`; `machine/cpp/machine/devices/audio/pcm_decoder_hot_path.h:8–12`; signed little-endian primitive `machine/ts/common/endian.ts:1–7`; `machine/cpp/common/endian.h:10–15`.

### APV07 — Linear sample interpolation
- The cursor fraction `f` is the low 16 fractional bits (0 to 65535 for an in-range nonnegative cursor). For left and right independently, interpolate frame n and n+1 as `first + ASR_16((second − first) * f)`.
- With no loop, at the last source frame the next frame is the same last frame (no read of frame FRAME_COUNT for interpolation).
- With a loop, when n+1 reaches or passes LOOP_END, the next interpolation frame is LOOP_START. This wraps the interpolation neighbor as well as later cursor advancement.
- BADP-decoded samples use this same interpolation path.
- Sources: `machine/ts/machine/devices/audio/output.ts:364–382`; `machine/cpp/machine/devices/audio/output.cpp:282–301`; `machine/ts/machine/devices/audio/pcm_decoder_hot_path.ts:11–15`; `machine/cpp/machine/devices/audio/pcm_decoder_hot_path.h:15–18`.

### APV08 — BADP seek-table fields read from the source header
- When BADP is selected, the decoder reads a little-endian word at source byte offset 28 as seek-entry count, and a little-endian word at source byte offset 32 as seek-table byte offset relative to SOURCE_ADDR.
- Each seek entry is eight bytes: little-endian frame number then little-endian compressed-data byte offset. The entry's compressed offset is relative to the data start at SOURCE_ADDR + DATA_OFFSET.
- Search chooses the last entry whose frame is no greater than the requested frame. If the table is empty, decoding begins with source frame zero and data offset zero. If no entry frame is no greater than the request, the search's initial entry-zero selection remains.
- No other BADP header fields, signature check or version check are supplied by these decoder owners; omit such claims.
- Sources: `machine/ts/machine/devices/audio/badp_decoder.ts:26–29`; `machine/cpp/machine/devices/audio/badp_decoder.cpp:11–14`; search `machine/ts/machine/devices/audio/badp_decoder_hot_path.ts:125–152`; `machine/cpp/machine/devices/audio/badp_decoder_hot_path.h:109–140`; source-relative data binding `machine/ts/machine/devices/audio/output.ts:463–470`; `machine/cpp/machine/devices/audio/output.cpp:383–395,411–417`.

### APV09 — BADP block header
- At a block offset relative to the data start: offset +0 is little-endian 16-bit block frame count; +2 is little-endian 16-bit total block byte count. The next block begins at current block offset + block byte count.
- Then, for each channel in increasing channel order, a four-byte record holds signed little-endian 16-bit predictor at +0, 8-bit step-table index at +2, and one byte not read by the decoder at +3.
- Payload begins `4 + 4*CHANNELS` bytes from block start. Loading a block resets its frame index and nibble cursor to zero and replaces the predictor/index per channel.
- Sources: `machine/ts/machine/devices/audio/badp_decoder_hot_path.ts:92–110`; `machine/cpp/machine/devices/audio/badp_decoder_hot_path.h:28–43`.

### APV10 — BADP payload order and initial predictor
- Payload is consumed high nibble first, then low nibble. For each frame, codes are consumed channel zero first, then the next channel; the nibble cursor continues across frames.
- The block-header predictor is the decoder's starting accumulator; it is not emitted as a separate first frame. Each emitted frame first applies the next nibble to its channel predictor.
- In mono, the decoded left sample is duplicated to right. After BLOCK_FRAMES decoded frames, the next frame loads the next block using BLOCK_BYTES.
- Sources: `machine/ts/machine/devices/audio/badp_decoder_hot_path.ts:155–199`; `machine/cpp/machine/devices/audio/badp_decoder_hot_path.h:46–88`.

### APV11 — Exact BADP step/index decode
- Step table, indices 0–88:
```
7,8,9,10,11,12,13,14,16,17,19,21,23,25,28,31,34,37,41,45,
50,55,60,66,73,80,88,97,107,118,130,143,157,173,190,209,230,253,279,307,
337,371,408,449,494,544,598,658,724,796,876,963,1060,1166,1282,1411,1552,1707,1878,2066,
2272,2499,2749,3024,3327,3660,4026,4428,4871,5358,5894,6484,7132,7845,8630,9493,10442,11487,12635,13899,
15289,16818,18500,20350,22385,24623,27086,29794,32767
```
- For code c, let s be the current step. Start difference at `s >> 3`; add s for bit2, `s >> 1` for bit1, `s >> 2` for bit0. Bit3 subtracts difference from predictor; otherwise add. Saturate predictor to −32768..32767.
- Index delta for low-three-bit code 0..7 is `−1,−1,−1,−1,2,4,6,8`, independent of sign bit. Apply the delta, then saturate updated index to 0..88.
- Header step index is loaded as a raw byte and used before the update saturation. Do not claim an out-of-range header index is checked or clipped before lookup.
- Sources: `machine/ts/machine/devices/audio/badp_decoder_hot_path.ts:14–29,102–104,168–184`; `machine/cpp/machine/devices/audio/badp_decoder_hot_path.h:11–25,35–36,53–73`.

### APV12 — BADP seeking and reverse traversal
- Reset/seek invalidates both decoded-frame caches. It locates a starting block from the seek table, advances block headers to the block containing the requested frame, then decodes forward through that requested frame.
- If a requested frame is the current or previous cached frame it returns that cached pair. Otherwise a request before nextFrame seeks again, then decodes forward. Negative playback therefore does not reverse the predictor recurrence; it obtains earlier frame values through the same seek/forward-decode path.
- Sources: `machine/ts/machine/devices/audio/badp_decoder_hot_path.ts:50–89,113–152`; `machine/cpp/machine/devices/audio/badp_decoder_hot_path.h:93–179`.

## Voice start, cursor, looping and live changes

### APV13 — PLAY execution
- Slot is the command's slot word masked with 0FH. After binding succeeds, PLAY copies all 21 command parameter words into that slot and changes its phase to PLAYING (1).
- PLAY resets filter histories and filter output, builds a cursor at `START_SAMPLE * 65536` with zero phase remainder, decodes signed gain from its raw word, and clears all fade progress. The new voice becomes resident and running.
- Replaying an already active slot replaces it with this new voice, rather than layering another voice in the same slot.
- Sources: `machine/ts/machine/devices/audio/command_executor.ts:146–158`; `machine/cpp/machine/devices/audio/command_executor.cpp:107–119`; copy/phase `machine/ts/machine/devices/audio/slot_bank.ts:45–50`; `machine/cpp/machine/devices/audio/slot_bank.cpp:29–34`; start `machine/ts/machine/devices/audio/output.ts:139–162`; `machine/cpp/machine/devices/audio/output.cpp:39–62`; phase constants `machine/ts/machine/devices/audio/contracts.ts:5–8`; `machine/cpp/machine/devices/audio/contracts.h:15–18`.

### APV14 — Selected-slot access edge
- Selected-slot reads and writes first advance voice time through the current access cycle. A selected-slot write then changes the chosen slot word and applies the corresponding change; it cannot retroactively change the samples already due through that access cycle.
- This is distinct from transfer-data access ordering, which is covered by the transfer/cadence sheet; do not merge the two write-visibility rules.
- Sources: `machine/ts/machine/devices/audio/command_executor.ts:107–120,201–220`; `machine/cpp/machine/devices/audio/command_executor.cpp:66–81,162–181`.

### APV15 — Active source-buffer reprogramming
- The source-buffer-replacement group is source address, byte extent, sample rate, channels, bits per sample, frame count, data offset, data byte count, and generator kind (indices 0–7 and 19).
- Writing one of those words in an active slot stores the word, reloads the complete slot metadata, and rebinds the entire region using the currently selected cartridge slot. It preserves cursor, phase remainder, current gain, fade progress and filter histories. It configures the current slot's phase step, loop bounds and filter coefficients; it resets/seeks BADP state when BADP is selected.
- If this new bind fails, the voice is stopped and the slot is deactivated, SOURCE_RANGE is raised with the newly programmed source address, and its slot register words remain retained (not cleared by this failure path).
- Source fields are not atomically grouped by a sequence of selected-slot stores. Each source-group store can apply a replacement before the next store.
- Sources: field group `machine/ts/machine/devices/audio/source.ts:47–60`; `machine/cpp/machine/devices/audio/source.h:19–28`; executor `machine/ts/machine/devices/audio/command_executor.ts:201–220`; `machine/cpp/machine/devices/audio/command_executor.cpp:162–181`; preserved cursor/remainder and build `machine/ts/machine/devices/audio/output.ts:165–179,460–488`; `machine/cpp/machine/devices/audio/output.cpp:65–79,383–417`; deactivate-without-clear `machine/ts/machine/devices/audio/active_slots.ts:47–49`; `machine/cpp/machine/devices/audio/active_slots.cpp:40–42`.

### APV16 — Other active selected-slot writes
- LOOP_START/LOOP_END changes recompute loop bounds; RATE_STEP changes recompute the rate quotient/remainder without resetting accumulated phase remainder; GAIN changes signed current gain and, when fading, replans the fade over its remaining duration; DUTY changes square duty; START_SAMPLE seeks immediately and clears accumulated phase remainder (and seeks BADP when used).
- FILTER_CONTROL and any coefficient store reconfigure all five coefficients from the complete slot register bank without resetting filter histories.
- Other parameter indices have no direct output-side action in this dispatch. In particular a FADE_SAMPLES store does not itself start a stop/fade command.
- These changes are applied for every non-idle slot, including a paused slot; its active-mask bit remains set while paused.
- Sources: `machine/ts/machine/devices/audio/output.ts:197–228,492–528`; `machine/cpp/machine/devices/audio/output.cpp:104–140,422–465`; executor non-idle active-mask gate `machine/ts/machine/devices/audio/command_executor.ts:201–220`; `machine/cpp/machine/devices/audio/command_executor.cpp:162–181`; nonzero phases set active mask `machine/ts/machine/devices/audio/slot_bank.ts:35–42`; `machine/cpp/machine/devices/audio/slot_bank.cpp:19–26`.

### APV17 — Signed Q16 rate conversion
- RATE_STEP is a signed 32-bit Q16 word; 00010000H means a ratio of one. SOURCE_SAMPLE_RATE_HZ is an unsigned word.
- Let P = signed(RATE_STEP) * SOURCE_SAMPLE_RATE_HZ. Divide P by 44100 with quotient q truncated toward zero and signed remainder r: `P = q*44100 + r`, `|r| < 44100`.
- q is the whole Q16 cursor increment per output frame; r is retained as a per-frame phase remainder increment. This preserves the source/output-rate ratio instead of discarding the fractional rate conversion at each frame.
- Negative rate traverses backward; zero rate (or zero source rate) does not advance the cursor. There is no rejecting/clamping rate check in this path.
- Sources: `machine/ts/spec/audio/apu.ts:1–2,32,41`; `machine/cpp/spec/audio/apu.h:9,20,39,48`; exact quotient/remainder `machine/ts/machine/devices/audio/playback.ts:13–48`; `machine/cpp/machine/devices/audio/playback.cpp:7–10`; configure `machine/ts/machine/devices/audio/output.ts:492–495`; `machine/cpp/machine/devices/audio/output.cpp:422–425`.

### APV18 — Per-output-frame phase edge
- Render/interpolate the current cursor first, apply filter if enabled, and add current-gain products to the mix. Then add r to accumulated phase remainder. At >=44100 subtract 44100 and add a cursor carry of +1; at <=−44100 add 44100 and carry −1. Advance cursor by q plus that carry.
- A loop wraps this new cursor after advancement. Fade gain adjustment follows phase advancement, so the current output sample always uses the old gain for that edge.
- Sources: `machine/ts/machine/devices/audio/output.ts:355–421`; `machine/cpp/machine/devices/audio/output.cpp:270–344`.

### APV19 — START_SAMPLE
- START_SAMPLE is an unsigned source frame index, converted to a Q16 cursor by multiplication by 65536, not interpreted as a signed word. PLAY starts with accumulated phase remainder zero; a live START_SAMPLE write also resets phase remainder to zero.
- START does not reset filter history on a live seek. BADP seeks to the new source frame; PCM uses the new cursor on later output.
- Sources: `machine/ts/machine/devices/audio/output.ts:139–155,213–215,524–528`; `machine/cpp/machine/devices/audio/output.cpp:39–55,125–127,455–465`.

### APV20 — Loop enable and unconditional wrapping
- A loop exists exactly when unsigned LOOP_END_SAMPLE > LOOP_START_SAMPLE. Otherwise looping is disabled. Bounds are converted directly to Q16; they are not limited to FRAME_COUNT by the owner.
- At the start of rendering a running voice, a loop wraps the cursor into the half-open interval [loop start, loop end); cursor advancement wraps after every frame too. Thus a START_SAMPLE before LOOP_START does not create a one-shot introduction before that loop; it is wrapped before the first sample.
- Exact wrap: `loopStart + positiveModulo(cursor − loopStart, loopEnd − loopStart)`, including negative cursors and advances longer than the loop length.
- Sources: `machine/ts/machine/devices/audio/output.ts:330–348,403–405,514–521,549–555`; `machine/cpp/machine/devices/audio/output.cpp:241–263,322–324,445–452,496–502`.

### APV21 — Nonloop natural end
- A running nonloop voice whose cursor is already outside [0, FRAME_COUNT*65536) at render entry ends without adding a sample.
- Otherwise each frame renders current cursor then advances it. When no fade is active, a cursor that has just crossed either end terminates the voice after that rendered frame; the voice ceases to be running/resident and contributes its slot bit to the ended mask.
- Zero rate at an in-range frame does not reach a natural end by phase motion alone. Fractional interpolation at the last source frame uses the held last frame as specified in APV07.
- A fade branch is checked before the post-sample natural-end check; see APV29 for the resulting programming hazard, rather than assuming a fade is automatically shortened at source end.
- Sources: `machine/ts/machine/devices/audio/output.ts:346–352,403–436`; `machine/cpp/machine/devices/audio/output.cpp:261–267,322–359`.

### APV22 — Square generator
- Generator kind one outputs the same signed sample on left and right: +32767 when `(cursor mod 65536)*4096 < DUTY_Q12*65536`, otherwise −32768.
- Duty is a raw unsigned Q12 word, not signed gain: zero produces only −32768; 00000800H is one-half duty; 00001000H or larger produces only +32767 for an in-range fractional cursor.
- Generator phase still advances using the signed Q16 rate and source sample-rate word; FRAME_COUNT and loop bounds still govern duration/wrapping. The generator does not access source sample bytes.
- Sources: kind/scale `machine/ts/spec/audio/apu.ts:1–4,27–28`; `machine/cpp/spec/audio/apu.h:9,20–22,34–35`; square output `machine/ts/machine/devices/audio/output.ts:330–360,394–405,460–478`; `machine/cpp/machine/devices/audio/output.cpp:241–278,313–324,391–402`.

## Gain, filter, mix and stop/fade

### APV23 — Signed Q12 gain
- GAIN_Q12 is decoded as the signed value of its complete word. 00001000H is unity, 00000000H is silence, FFFFF000H is minus unity. Negative gain inverts the sample. Values greater than unity are not clipped on gain write.
- Current voice gain can differ from the programmed slot GAIN word during a fade; only the output-side retained current gain is decremented by fade advancement.
- Sources: constants `machine/ts/spec/audio/apu.ts:3–4`; `machine/cpp/spec/audio/apu.h:21–22`; signed play/live gain `machine/ts/machine/devices/audio/output.ts:155,498–501`; `machine/cpp/machine/devices/audio/output.cpp:55,428–431`; signed word conversion `machine/ts/machine/common/numeric.ts:14–15`; `machine/cpp/machine/common/numeric.h:14–17`; retained fade-only updates `machine/ts/machine/devices/audio/output.ts:421,430`; `machine/cpp/machine/devices/audio/output.cpp:340–344,353`.

### APV24 — Mix and final output saturation
- For each left and right channel independently, sum `filteredSample * currentGainQ12` across all running slots before shifting. There is no per-voice gain-product saturation in this mix path.
- Final sample is `saturateSigned16(ASR_12(sum))`, range −32768..32767. Summing occurs before the Q12 shift, so fractional contributions combine before quantization.
- An enabled per-slot filter has its own signed-16 output saturation before this gain/mix stage; final mix saturation does not replace that filter saturation.
- Sources: `machine/ts/machine/devices/audio/output.ts:385–392,440–446`; `machine/cpp/machine/devices/audio/output.cpp:304–311,363–369`; arithmetic shift `machine/ts/machine/common/numeric.ts:32–36`; `machine/cpp/machine/common/numeric.h:35–39`; filter saturation `machine/ts/machine/devices/audio/biquad_filter.ts:8–15,56–64`; `machine/cpp/machine/devices/audio/biquad_filter.h:25–50`.

### APV25 — Filter control and coefficient fields
- FILTER_CONTROL bit0 enables the per-slot stereo biquad. Other control bits have no decoded effect here.
- Coefficients are signed 16-bit Q14 (unity 4000H): FILTER_B0_B1 low halfword b0/high b1; FILTER_B2_A1 low b2/high a1; FILTER_A2 low a2; its high halfword is not decoded.
- Both channels share coefficients but have independent two-word histories.
- Sources: `machine/ts/spec/audio/apu.ts:79–81`; `machine/cpp/spec/audio/apu.h:86–88`; `machine/ts/machine/devices/audio/biquad_filter.ts:18–30,47–53`; `machine/cpp/machine/devices/audio/biquad_filter.h:8–19`; `machine/cpp/machine/devices/audio/biquad_filter.cpp:20–26`.

### APV26 — Exact filter recurrence and state widths
- For one channel, let x be the interpolated/generator signed sample and z1,z2 the retained signed words. Compute:
```
y  = ASR_14(b0*x + z1)
z1 = WRAP32(b1*x - a1*y + z2)
z2 = WRAP32(b2*x - a2*y)
filterOutput = saturateSigned16(y)
```
- Update histories using the unsaturated y, not the signed-16 saturated filter output. Left uses l1,l2; right uses r1,r2.
- Q14 right shift rounds negative results toward negative infinity. History overflow wraps modulo 2^32; it is not saturated. Output saturation range is −32768..32767.
- Sources: `machine/ts/machine/devices/audio/biquad_filter.ts:56–64`; `machine/cpp/machine/devices/audio/biquad_filter.h:25–39,43–50`; wrap/shift `machine/ts/machine/common/numeric.ts:28–36`; `machine/cpp/machine/common/numeric.h:30–39`.

### APV27 — Filter history edges
- PLAY resets histories to zero before installing coefficients. Reset defaults are disabled, b0=4000H, all other coefficients/histories/output samples zero.
- Live coefficient/control changes retain histories; disabling bypasses processing entirely, so histories do not advance while bypassed. Re-enabling resumes with retained histories.
- Source replacement and live seek do not clear histories. Pausing a voice also retains histories, because it is skipped rather than rendered.
- Sources: reset `machine/ts/machine/devices/audio/biquad_filter.ts:32–44`; `machine/cpp/machine/devices/audio/biquad_filter.cpp:5–17`; configure does not clear `machine/ts/machine/devices/audio/biquad_filter.ts:47–53`; `machine/cpp/machine/devices/audio/biquad_filter.cpp:20–26`; PLAY reset/source replacement/seek `machine/ts/machine/devices/audio/output.ts:145–178,524–528`; `machine/cpp/machine/devices/audio/output.cpp:45–78,455–465`; skip/bypass `machine/ts/machine/devices/audio/output.ts:325–328,385–388`; `machine/cpp/machine/devices/audio/output.cpp:236–239,304–307`.

### APV28 — Immediate stop versus fade stop
- STOP_SLOT on a non-idle slot with FADE_SAMPLES zero stops immediately and clears all 21 slot register words; STOP on an already idle slot also clears the bank.
- With positive FADE_SAMPLES and a non-idle slot, STOP changes phase to FADING (2), retaining the PAUSED bit if set, and configures a fade for that many output frames. A fade on a paused voice waits until resumed because paused voices are not rendered.
- Immediate command stop does not call the SLOT_ENDED emission path; naturally ended/fade-ended output slots do (APV32).
- Sources: `machine/ts/machine/devices/audio/command_executor.ts:161–175`; `machine/cpp/machine/devices/audio/command_executor.cpp:122–136`; clear bank `machine/ts/machine/devices/audio/active_slots.ts:42–44`; `machine/cpp/machine/devices/audio/active_slots.cpp:35–37`; `machine/ts/machine/devices/audio/slot_bank.ts:53–58`; `machine/cpp/machine/devices/audio/slot_bank.cpp:37–42`; output stop/skip `machine/ts/machine/devices/audio/output.ts:232–243,325–328`; `machine/cpp/machine/devices/audio/output.cpp:144–155,236–239`.

### APV29 — Exact fade edge and source-length hazard
- For retained signed gain G and nonzero duration N, configure signed quotient Q=trunc(G/N), signed remainder R=G−Q*N; set error=N−1, remaining=N, total=N.
- Each rendered frame first uses the current G. After phase advancement, decrement remaining. At zero, end immediately; there is no further gain update on that last frame. Otherwise add |R| to error; when error>=N subtract N and use carry sign(R), else carry zero. New gain is WRAP32(G−Q−carry).
- This produces N rendered frames from the configured gain toward zero, not an additional final zero-gain frame. For G=4096,N=4, the frame gains are 4096,3072,2048,1024, then stop.
- During a nonzero fade the same per-frame branch does not run the post-frame natural-end test. The owner does not shorten a fade to remaining source length; a nonloop source can advance beyond its declared end during a longer fade. Do not promise automatic padding, clipping or recovery. Program the fade within remaining data or use a valid loop for the fade's duration.
- Sources: configure `machine/ts/machine/devices/audio/output.ts:505–511`; `machine/cpp/machine/devices/audio/output.cpp:435–442`; advancement/branch order `machine/ts/machine/devices/audio/output.ts:390–424`; `machine/cpp/machine/devices/audio/output.cpp:309–347`. The four-gain example is direct integer substitution in that recurrence, not a timing measurement.

### APV30 — Gain retarget during a fade
- A GAIN write replaces the current signed gain immediately after selected-slot synchronization, and if remaining fade count is nonzero, recomputes Q/R/error using that new gain and the remaining frame count. The fade's remaining duration is not restarted to its old original total.
- Sources: `machine/ts/machine/devices/audio/output.ts:498–511`; `machine/cpp/machine/devices/audio/output.cpp:428–442`; selected-slot synchronization `machine/ts/machine/devices/audio/command_executor.ts:115–120`; `machine/cpp/machine/devices/audio/command_executor.cpp:75–81`.

### APV31 — Pause/resume phase and retained state
- PAUSE acts only on a non-idle, not-yet-paused phase; it clears running activity but retains resident voice data and sets phase bit2 (PAUSED=4). The slot's active-mask bit remains set for every nonzero phase.
- RESUME acts only when PAUSED is set, restores running activity if resident, and clears PAUSED. An ordinary paused playing phase is 5; a paused fading phase is 6.
- A skipped paused voice does not consume source phase, fade frames or filter state. RESUME does not re-PLAY, reset the cursor or reset filter state.
- Sources: phase constants `machine/ts/machine/devices/audio/contracts.ts:5–8`; `machine/cpp/machine/devices/audio/contracts.h:15–18`; commands `machine/ts/machine/devices/audio/command_executor.ts:178–192`; `machine/cpp/machine/devices/audio/command_executor.cpp:139–153`; output `machine/ts/machine/devices/audio/output.ts:242–248,325–328`; `machine/cpp/machine/devices/audio/output.cpp:154–160,236–239`; active mask `machine/ts/machine/devices/audio/slot_bank.ts:35–42`; `machine/cpp/machine/devices/audio/slot_bank.cpp:19–26`.

### APV32 — Output-end state and event
- After rendering reports a slot's ended bit, the controller captures that slot's programmed SOURCE_ADDR, stops it (phase idle and all 21 slot words zero), then emits SLOT_ENDED kind1 with slot and captured address.
- Multiple ended bits are serviced in increasing slot order. Every emission increments the 32-bit event sequence, overwrites the one event-kind/slot/source-address latch, mirrors it, and raises APU IRQ. It is not a FIFO of ended events; the last processed slot is the final latched record.
- Sources: `machine/ts/spec/audio/apu.ts:83–84`; `machine/cpp/spec/audio/apu.h:90–91`; end handling `machine/ts/machine/devices/audio/active_slots.ts:57–64`; `machine/cpp/machine/devices/audio/active_slots.cpp:50–56`; stop/clear `machine/ts/machine/devices/audio/active_slots.ts:42–44`; `machine/cpp/machine/devices/audio/active_slots.cpp:35–37`; `machine/ts/machine/devices/audio/slot_bank.ts:53–58`; `machine/cpp/machine/devices/audio/slot_bank.cpp:37–42`; event latch `machine/ts/machine/devices/audio/event_latch.ts:56–69`; `machine/cpp/machine/devices/audio/event_latch.cpp:38–51`.

## Internal retained-state appendix — NOT cartridge-visible registers

### APV-I01 — Output save-state fields
- Only resident voices are included in output capture, including paused resident voices. Each captures slot, source cartridge slot, cursorQ16, phaseRemainder, signed current gainQ12, fade quotient/remainder/error/remaining/total, four filter histories, and BADP predictors/indices/block/frame/payload/nibble/cached-frame state.
- Source parameters remain in the slot register bank; coefficient words are reconstructed from those source parameters when rebuilding a voice, while histories are restored separately. Running/paused state is restored from the slot phase.
- These fields are internal continuation state, not extra guest registers, commands, peek ports or a cartridge save-state ABI.
- Sources: `machine/ts/machine/devices/audio/save_state.ts:19–56,93–159`; `machine/cpp/machine/devices/audio/save_state.h:13–50`; `machine/cpp/machine/devices/audio/save_state.cpp:8–72,115–122`; resident capture `machine/ts/machine/devices/audio/output.ts:128–136`; restore/rebuild `machine/ts/machine/devices/audio/output.ts:182–194,460–485`; `machine/cpp/machine/devices/audio/output.cpp:82–101,383–408`; paused reconstruction `machine/ts/machine/devices/audio/command_executor.ts:89–104`; `machine/cpp/machine/devices/audio/command_executor.cpp:49–63`.

### APV-I02 — Output playback reset versus programmed banks
- Output playback reset clears running/resident flags; slot-bank reset independently makes all phases idle, active mask zero and all 21*16 slot words zero. Source RAM reset zeros all 512 KiB.
- Do not expose constructor gain unity/filter identity/history defaults as the reset value of the guest parameter banks: the banks themselves reset to zero.
- Sources: `machine/ts/machine/devices/audio/output.ts:119–125`; `machine/cpp/machine/devices/audio/output.cpp:31–36`; slot reset `machine/ts/machine/devices/audio/slot_bank.ts:25–28`; `machine/cpp/machine/devices/audio/slot_bank.cpp:9–12`; sample RAM reset `machine/ts/machine/devices/audio/sample_memory.ts:16–17`; `machine/cpp/machine/devices/audio/sample_memory.cpp:13–14`.

## Extraction limitations / editorial boundaries
- No independent APU core clock, electrical DAC width/rate, pin bus speed, sample-fetch cycle cost, per-format throughput rating, channel-count validator, data-range validator, clipping-to-source-length rule, malformed BADP recovery, or filter-stability validator is established by these owners/spec leaves. None is inferred.
- Format relationships needed for an authored buffer (PCM mono/stereo storage extent, valid BADP block payload sizes, step-index 0..88, loop bounds within actual storage) are programming constraints derived from direct indexing, not new runtime fault behavior.
- The APU source owners do not define the entire authoring container header. APV08 documents only the BADP fields actually read by the decoder; no external IMA/WAV/Sony header structure should be imported into this chapter.
- No repo files were edited by this extraction. All public facts above were verified live rather than taken from memory. A quick historical memory pass only located the current owner family and reinforced leaving cadence/transport alone; it supplies no factual source for this sheet.


---

# APU — actual source-language and firmware precedents

Editorial facts only; no architecture document or reference PDF read. Existing
BIOS/cartlib/compiler producers below are single-source, not called mirrored.
Hardware semantics belong to independently paired APU register/transfer/voice
sheets. No new runtime or source-language feature is assumed.

| ID | Fact | Source |
|---|---|---|
| APUB01 | Named fixed structs and typed readonly records are actually authored in firmware; mutable arrays/counters are explicit BSS. | `machine/bios/shell/commands.lua:61–94,96–124`; `machine/bios/tty/terminal.lua:41–73`. |
| APUB02 | Firmware binds typed scalar word ports, snapshots a static completion sequence before source/destination/count/control/START writes, and waits on a sequence predicate containing statement halt_until_irq. | `machine/bios/kernel/dma.lua:4–33`; actual direct cartridge example `carts/dma_manual/cart.lua`. |
| APUB03 | Existing central `cartlib/apu` declares `apu_command_registers`:21 parameter words and final command word in hardware order, with named fields; it binds a typed pointer at08000120. This is an existing record type, not a new cart-local encoding helper. | `cartlib/apu.lua:19–43,50`; hardware address/order independently in APU register sheet. |
| APUB04 | Requiring `cartlib/apu` requires cartlib/dma, which requires cartlib/irq and initializes DMA0/1 callbacks. cartlib/irq installs its own global irq handler, ACKs each enabled pending bit before invoking its registered callback. A sample using this route must not define a second direct global irq function. | `cartlib/apu.lua:3`; `cartlib/dma.lua:2–3,30–45`; `cartlib/irq.lua:1–34`. |
| APUB05 | Existing `apu.upload`/download program STOP, transfer address offset and DMA write/read mode, then call actual channel0 DMA programming functions. These calls start transfer; DMA's separate wait0_idle waits for its completion, not necessarily sample-memory work. | `cartlib/apu.lua:68–83`; `cartlib/dma.lua:47–56,77–89`; transfer/DONE boundary independently sourced in APUT facts. |
| APUB06 | Actual cartridge APIs play/play_plain write every named parameter before command1. stop_slot writes slot/fade/command2; set_slot_gain writes slot/gain/command3; pause/resume write slot and command4/5. | `cartlib/apu.lua:130–202`; hardware effects require paired command facts. |
| APUB07 | Existing const APU event module exposes addresses0800017c/180/184 and ended kind1; it does not install another handler. Actual event sequencing/IRQ remains owner facts. | `cartlib/apu/event.lua:1–10`. |
| APUB08 | The final ordinary cartridge imports the existing APU types, declares named readonly `apu_command_registers` records and i16 PCM, obtains typed word views, writes the actual source address, copies parameter words1..20 and explicitly writes CMD last. It builds and executes through ordinary startup without compiler or library changes. | `carts/apu_manual/cart.lua:1–59,77–119,137–179`; `carts/apu_manual/results.lua:1–60`; `tests/carts/apu_manual/apu_manual_assert.lua:1–93`; ordinary execution evidence recorded in `docs/book1/reviews/apu-source.md`. |

An initial scratch probe using a symbol as a primitive readonly source-address
initializer did not compile. The checked route supplies the source address as a
real typed MMIO word and uses literal static operands for remaining fields.
This is a language-boundary finding, not a reason to add a compiler feature,
local address encoder, runtime descriptor facade or undocumented loader API.

| ID | Fact | Source |
|---|---|---|
| APUB09 | An existing real BLua cartridge already performs APU upload, waits for its DMA0 service predicate, separately polls APU TRANSFER_BUSY, downloads, and compares the retained words. This is a usable precedent, not an invented API or host bridge. It overrides DMA0's registered callback, so its own sequence predicate is used instead of dma.wait0_idle. | `carts/cartridge_conformance/entry.lua:1–12,29–37,76–99`; hardware transfer semantics in APUT sheet. |
| APUB10 | The current normal resource producer classifies wav/ogg/adpcm as audio and encodes audio payloads through the central BADP producer. The generated const bmsx/assets module exports a type-prefixed resource name with _addr/_len values; these are direct ROM symbols, not a runtime asset lookup facade. | `scripts/rompacker/rombuilder.ts:417–423,860–871`; `toolchain/ts/rompack/asset_symbols.ts:40–66,75–94`; actual const-module usage `carts/2025/globals.lua:5–9`. |

The failed address-in-integer readonly initializer was reproduced independently
while keeping sizeof(i16[4]) unchanged. The scalar initializer producer accepts
compile-time integers and serializes those raw words; this is not an automatic
symbol-address relocation feature: `toolchain/ts/lua/compiler.ts:3799–3817`.
The isolated probe is compile evidence only. The final normal cartridge was
subsequently built and executed; its source is the durable programming example.
No compiler or library source was edited for these findings.


## APUB11 — Authored complete program and executed observations

The actual cartridge supplies named PCM16 data and two readonly command presets,
a BSS result record and four controlled source operations in slots2–5. Its PCM
loop length16 at sourceHz7040 gives440 periods/s; square kind1 uses sourceHz440,
frameCount1, loop[0,1), duty0800H and gain0400H. Each controlled fade is441 output
frames; each polling interval observes at least2205 output-clock increments.
`cartlib/irq` owns the global vector; only the APU callback is registered by
this cartridge. Existing DMA callbacks remain installed.
- Inputs/program: `carts/apu_manual/cart.lua:30–59,61–179`.
- BSS/event/result layout: `carts/apu_manual/results.lua:1–60`.
- Asset source: `carts/apu_manual/res/audio/tone.wav` (authored mono PCM16,44100Hz,4410frames); normal producer from APUB10; header fields `cartlib/apu.lua:5–17`.
- Final BADP source programming: `carts/apu_manual/cart.lua:181–233`.
- Executed assertions: `tests/carts/apu_manual/apu_manual_assert.lua:25–93`; exact commands/results/limits retained in `docs/book1/reviews/apu-source.md`.

Normal packing produces2333 BADP bytes, version1, channels1, sampleHz44100,
frameCount4410, dataOffset56, seekCount1, seekOffset48. Actual ordinary guest
execution observes upload DMA STATUS2/APU0420H then committed02a0H; download
DMA2/APU0420H then STOP0020H; all16 readback words equal the PCM inputs; four
end events retain slots2/3/4/5 and exact source addresses/sequences; ended banks
are zero, final ACTIVE_MASK0/STATUS0020H/faultcode0/detail0/MASK0/FLAGS4. These
controlled observations are not electrical timings, audible output or fixed
CPU instruction-to-handler latency. The ordinary headless audio sink discards
sound; discrete sample identity requires separate output-owner execution.
