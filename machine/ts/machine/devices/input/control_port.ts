import type { Value } from '../../cpu/cpu';
import { Memory } from '../../memory/memory';
import {
	INP_CTRL_ARM,
	INP_CTRL_RESET,
	IO_INP_CTRL,
	IO_INP_STATUS,
} from '../../bus/io';
import { InputControllerRegisterFile } from './registers';
import { InputControllerSampleLatch } from './sample_latch';

export class InputControllerControlPort {
	public constructor(
		private readonly memory: Memory,
		private readonly registers: InputControllerRegisterFile,
		private readonly sampleLatch: InputControllerSampleLatch,
	) {}

	public writeControl(_addr: number, value: Value): void {
		this.registers.write(IO_INP_CTRL, value);
		switch (this.registers.state.ctrl) {
			case INP_CTRL_ARM:
				this.sampleLatch.arm();
				return;
			case INP_CTRL_RESET:
				this.sampleLatch.reset();
				this.registers.reset();
				this.registers.mirror(this.memory);
				this.memory.writeIoValue(IO_INP_STATUS, this.sampleLatch.sequence());
				return;
		}
	}
}
