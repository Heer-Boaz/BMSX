import type { Value } from '../../cpu/cpu';
import { Memory } from '../../memory/memory';
import {
	INP_CTRL_ARM,
	INP_CTRL_COMMIT,
	INP_CTRL_RESET,
	IO_INP_CTRL,
} from '../../bus/io';
import { InputControllerActionTable } from './action_table';
import { InputControllerRegisterFile } from './registers';
import { InputControllerSampleLatch } from './sample_latch';

export class InputControllerControlPort {
	public constructor(
		private readonly memory: Memory,
		private readonly registers: InputControllerRegisterFile,
		private readonly actionTable: InputControllerActionTable,
		private readonly sampleLatch: InputControllerSampleLatch,
	) {}

	public writeControl(_addr: number, value: Value): void {
		this.registers.write(IO_INP_CTRL, value);
		switch (this.registers.state.ctrl) {
			case INP_CTRL_COMMIT:
				this.actionTable.commitAction(this.registers.selectedPlayerIndex(), this.registers.state.actionStringId, this.registers.state.bindStringId);
				return;
			case INP_CTRL_ARM:
				this.sampleLatch.arm();
				return;
			case INP_CTRL_RESET:
				this.actionTable.resetActions(this.registers.selectedPlayerIndex());
				this.registers.writeResult(this.memory, 0, 0, 0, 0);
				return;
		}
	}
}
