# Bounded control-unit prose source review

- Draft: `/tmp/bmsx-overview-control-prose.md`
- SHA-256: `aec89b22561b5b10a46bb8ede87111e38030ab807df83b7ac6427bdb029eb169`
- Inspected checkout: `master`, `58bbf76d7`.
- Result: **bounded failures below**. Actual paired TypeScript/native specs and owners were read; the fact sheet was used only as their index. No implementation, builds/tests, architecture document, reference PDFs, CPU7/Table audit or unrelated owner sweep.
- Scope: the draft's CPU instruction-word/model-timebase claims; IRQ/SYSTEM/INPUT/IMGDEC resources and behavior, including reset, capture, routed IMGDEC output and charged work. No other concrete disagreement found in that bounded source inspection.

## 1. INPUT capture does not clear the retained ARM control word

Exact draft sentence, line 25:

> Capture samples the raw states, increments the sequence, records the cycle, clears ARM and publishes the input latches and status.

The accepted capture clears the **pending sample latch**, not the retained ARM word. As written, “clears ARM” conflates these two distinct states. The command owner stores the complete ARM word; the capture path clears only `sampleArmed`, then republishes `state.ctrl` unchanged.

Exact TypeScript source:

- `machine/ts/machine/devices/input/controller.ts:61-66`:

```ts
private static writeControl(context: InputController, _addr: number, value: number): void {
	context.registers.state.ctrl = value;
	switch (context.registers.state.ctrl) {
		case INP_CTRL_ARM:
			context.sampleArmed = true;
			return;
```

- `machine/ts/machine/devices/input/controller.ts:95-100`:

```ts
this.sampleSequence = (this.sampleSequence + 1) >>> 0;
this.lastSampleCycle = nowCycles >>> 0;
this.sampleArmed = false;
this.registers.latchSnapshot(this.snapshot);
this.registers.mirror(this.memory);
this.memory.writeIoU32(IO_INP_STATUS, this.sampleSequence);
```

- `machine/ts/machine/devices/input/registers.ts:121-122`:

```ts
public mirror(memory: Memory): void {
	memory.writeIoU32(IO_INP_CTRL, this.state.ctrl);
```

Exact native counterparts:

- `machine/cpp/machine/devices/input/controller.cpp:31-36` stores the control word and arms the pending latch; `machine/cpp/machine/devices/input/registers.cpp:42-46` contains:

```cpp
void InputControllerRegisterFile::write(uint32_t addr, u32 value) {
	switch (addr) {
		case IO_INP_CTRL:
			state.ctrl = value;
			return;
```

- `machine/cpp/machine/devices/input/controller.cpp:64-69`:

```cpp
m_sampleSequence += 1u;
m_lastSampleCycle = nowCycles;
m_sampleArmed = false;
m_registers.latchSnapshot(m_snapshot);
m_registers.mirror(m_memory);
m_memory.writeIoU32(IO_INP_STATUS, m_sampleSequence);
```

- `machine/cpp/machine/devices/input/registers.cpp:59-60`:

```cpp
void InputControllerRegisterFile::mirror(Memory& memory) const {
	memory.writeIoU32(IO_INP_CTRL, state.ctrl);
```

## 2. Not every IMGDEC DATA read pops queued output

Exact draft sentence, line 29:

> Reading DATA pops the output FIFO.

This is unconditional, but CPU reads while DMA owns the DATA read port return the retained DATA latch without popping, even if the FIFO contains output. A read with an empty output FIFO also does not pop.

Exact TypeScript source, `machine/ts/machine/devices/imgdec/controller.ts:583-592`:

```ts
private static readDataThunk(context: ImgDecController, _address: number, busSignals: MappedBusSignals): number {
	const dmaRead = (busSignals & MAPPED_BUS_MASTER_DMA) !== 0;
	if (!dmaRead && context.dma.ownsReadPort(IO_IMGDEC_DATA)) {
		return context.dataWord;
	}
	if (!context.outputFifo.empty()) {
		context.dataWord = context.outputFifo.pop();
		context.memory.writeIoU32(IO_IMGDEC_DATA, context.dataWord);
		context.outputWordsRead = (context.outputWordsRead + 1) >>> 0;
	}
```

Exact native source, `machine/cpp/machine/devices/imgdec/controller.cpp:491-501`:

```cpp
u32 ImgDecController::readDataThunk(void* context, u32, MappedBusSignals busSignals) {
	auto& controller = *static_cast<ImgDecController*>(context);
	const bool dmaRead = (busSignals & MAPPED_BUS_MASTER_DMA) != 0u;
	if (!dmaRead && controller.m_dma.ownsReadPort(IO_IMGDEC_DATA)) {
		return controller.m_dataWord;
	}
	if (!controller.m_outputFifo.empty()) {
		controller.m_dataWord = controller.m_outputFifo.pop();
		controller.m_memory.writeIoU32(IO_IMGDEC_DATA, controller.m_dataWord);
		controller.m_outputWordsRead += 1u;
	}
```

## 3. The CPU is the IRQ consumer, not a named interrupt source

Exact draft sentence, line 15:

> CPU, DMA and device interrupt sources share IRQ.

The wording groups CPU with IRQ-producing sources. The paired installed assembly shares one controller between the CPU consumer and DMA/device producers; it does not establish a CPU interrupt source. The complete named IRQ-source declarations are `machine/ts/spec/bmsx/io.ts:362-372` and `machine/cpp/spec/bmsx/io.h:375-385`: DMA0_DONE, GX_PCRTC, VBLANK, GEO_DONE, GEO_ERROR, APU, GPU, IMGDEC, DMA1_DONE, CARTRIDGE_SLOT0 and CARTRIDGE_SLOT1, with no CPU source.

Exact TypeScript CPU consumption, `machine/ts/machine/cpu/cpu.ts:1680-1683`:

```ts
public canAcceptMaskableInterruptLine(): boolean {
	return (this.statusWord & CPU_STATUS_INTERRUPT_ENABLE_CURRENT) !== 0
		&& this.irqController.hasAssertedMaskableInterruptLine();
}
```

Exact native CPU consumption, `machine/cpp/machine/cpu/cpu.cpp:2242-2245`:

```cpp
bool CPU::canAcceptMaskableInterruptLine() const {
	return (m_statusWord & CPU_STATUS_INTERRUPT_ENABLE_CURRENT) != 0u
		&& m_irqController.hasAssertedMaskableInterruptLine();
}
```

Exact installed-assembly ranges: `machine/ts/machine/machine.ts:58-81`; `machine/cpp/machine/machine.cpp:14-23`. The CPU owners' remaining references to their IRQ-controller field only query the line for interrupt acceptance/HALT handling (`machine/ts/machine/cpu/cpu.ts:484,1682,1823,1891`; `machine/cpp/machine/cpu/cpu.cpp:359-363,2244,2409,2427`), not source raises.

## Targeted revision recheck

- Current draft SHA-256: `4e6bb17c7a56ac11fc2f1ce12a031596557e7d0d6a377d63bc3a534734e42498`.
- Re-read the literal revised draft. **All three findings above are resolved; no remaining concrete incorrect or unsupported sentence identified within this bounded review.** The findings above document the earlier hash, not the current draft.
- Line 15 now says: “DMA and device interrupt sources feed the shared IRQ controller; the CPU accepts its enabled interrupt line.” This preserves the producer/consumer distinction supported by `machine/ts/machine/machine.ts:58-81`, `machine/cpp/machine/machine.cpp:14-23`, `machine/ts/machine/cpu/cpu.ts:1680-1683` and `machine/cpp/machine/cpu/cpu.cpp:2242-2245`.
- Line 25 now says: “Capture samples the raw states, increments the sequence, records the cycle, consumes the pending capture request and publishes the input latches and status.” This describes the pending latch, without claiming to clear the retained ARM word; supported by `machine/ts/machine/devices/input/controller.ts:95-100` and `machine/cpp/machine/devices/input/controller.cpp:64-69`.
- Line 29 now says: “An admitted DATA read removes one queued output word; CPU reads while DMA owns that read port, and reads of an empty FIFO, return the retained DATA word without removing output.” The explicit exceptions match `machine/ts/machine/devices/imgdec/controller.ts:583-592` and `machine/cpp/machine/devices/imgdec/controller.cpp:491-501`.
- Revised line 3 retains the configured system-timebase/instruction-throughput distinction and drops the reconfiguration claim. The retained numeric/model statement remains supported by `machine/ts/spec/bmsx/model.ts:7,46-53`, `machine/cpp/spec/bmsx/model.h:12,51-58`, `machine/ts/machine/runtime/timing/state.ts:23-32` and `machine/cpp/machine/runtime/timing/state.cpp:10-22`, together with the product/model wiring inspected in the initial bounded pass.
- This was a targeted recheck of the stated edits against previously inspected paired sources, not a broader re-audit. No builds/tests or repository edits.

## Public-reader scope refinement

Root removed only “records the cycle” from the final public capture sentence:
there is no corresponding captured-cycle register in the public INPUT map.
The internal assignment remains in both owners (`input/controller.ts:96`,
`input/controller.cpp:65`) but is not offered as a cartridge observation. No
new capture behavior is asserted; the prior bounded audit applies to the
retained text, with this deletion explicitly recorded.
