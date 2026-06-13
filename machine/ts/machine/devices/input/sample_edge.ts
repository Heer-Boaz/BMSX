import { IO_INP_STATUS } from '../../bus/io';
import { Memory } from '../../memory/memory';
import type { InputControllerSampleLatch } from './sample_latch';
import type { InputControllerRegisterFile } from './registers';
import { createInputControllerSnapshot, type InputControllerInputSource } from './contracts';

export class InputControllerSampleEdge {
	private readonly snapshot = createInputControllerSnapshot();

	public constructor(
		private readonly input: InputControllerInputSource,
		private readonly sampleLatch: InputControllerSampleLatch,
		private readonly registers: InputControllerRegisterFile,
		private readonly memory: Memory,
	) {}

	public onVblankEdge(currentTimeMs: number, nowCycles: number): void {
		if (!this.sampleLatch.consumeVblankEdge(nowCycles)) {
			return;
		}
		this.input.sampleInputControllerSnapshot(currentTimeMs, this.snapshot);
		this.registers.latchSnapshot(this.snapshot);
		this.registers.mirror(this.memory);
		this.memory.writeIoValue(IO_INP_STATUS, this.sampleLatch.sequence());
	}
}
