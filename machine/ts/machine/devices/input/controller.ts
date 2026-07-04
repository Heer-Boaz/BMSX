import {
	INP_CTRL_ARM,
	INP_CTRL_RESET,
	IO_INP_CTRL,
	IO_INP_OUTPUT_CTRL,
	IO_INP_OUTPUT_DURATION_MS,
	IO_INP_OUTPUT_INTENSITY_Q16,
	IO_INP_OUTPUT_PORT,
	IO_INP_STATUS,
} from '../../bus/io';
import type { Value } from '../../cpu/cpu';
import { Memory } from '../../memory/memory';
import type { InputControllerState } from './save_state';
import { InputControllerRegisterFile } from './registers';
import { InputControllerOutputPort } from './output_port';
import { createInputControllerSnapshot, type InputControllerInputSource } from './contracts';

export class InputController {
	private sampleArmed = false;
	private sampleSequence = 0;
	private lastSampleCycle = 0;
	private readonly snapshot = createInputControllerSnapshot();
	private readonly outputPort: InputControllerOutputPort;
	private readonly registers = new InputControllerRegisterFile();

	public constructor(
		private readonly memory: Memory,
		private readonly input: InputControllerInputSource,
	) {
		this.outputPort = new InputControllerOutputPort(input, this.registers, memory);
		const registerWrite = this.registers.write.bind(this.registers);
		this.memory.mapIoWrite(IO_INP_CTRL, this.writeControl.bind(this));
		this.memory.mapIoWrite(IO_INP_OUTPUT_PORT, registerWrite);
		this.memory.mapIoWrite(IO_INP_OUTPUT_INTENSITY_Q16, registerWrite);
		this.memory.mapIoWrite(IO_INP_OUTPUT_DURATION_MS, registerWrite);
		this.memory.mapIoWrite(IO_INP_OUTPUT_CTRL, this.outputPort.writeOutputControlRegister.bind(this.outputPort));
	}

	public reset(): void {
		this.sampleArmed = false;
		this.sampleSequence = 0;
		this.lastSampleCycle = 0;
		this.registers.reset();
		this.memory.writeIoValue(IO_INP_OUTPUT_CTRL, 0);
		this.registers.mirror(this.memory);
		this.memory.writeIoValue(IO_INP_STATUS, this.sampleSequence);
	}

	private writeControl(_addr: number, value: Value): void {
		this.registers.write(IO_INP_CTRL, value);
		switch (this.registers.state.ctrl) {
			case INP_CTRL_ARM:
				this.sampleArmed = true;
				return;
			case INP_CTRL_RESET:
				this.sampleArmed = false;
				this.sampleSequence = 0;
				this.lastSampleCycle = 0;
				this.registers.reset();
				this.registers.mirror(this.memory);
				this.memory.writeIoValue(IO_INP_STATUS, this.sampleSequence);
				return;
		}
	}

	public onVblankEdge(currentTimeMs: number, nowCycles: number): void {
		if (!this.sampleArmed) {
			return;
		}
		this.sampleSequence = (this.sampleSequence + 1) >>> 0;
		this.lastSampleCycle = nowCycles >>> 0;
		this.sampleArmed = false;
		this.input.sampleInputControllerSnapshot(currentTimeMs, this.snapshot);
		this.registers.latchSnapshot(this.snapshot);
		this.registers.mirror(this.memory);
		this.memory.writeIoValue(IO_INP_STATUS, this.sampleSequence);
	}

	public cancelSampleArm(): void {
		this.sampleArmed = false;
	}

	public captureState(): InputControllerState {
		return {
			sampleArmed: this.sampleArmed,
			sampleSequence: this.sampleSequence,
			lastSampleCycle: this.lastSampleCycle,
			registers: this.registers.captureState(),
		};
	}

	public restoreState(state: InputControllerState): void {
		this.sampleArmed = state.sampleArmed;
		this.sampleSequence = state.sampleSequence;
		this.lastSampleCycle = state.lastSampleCycle;
		this.registers.restoreState(state.registers);
		this.memory.writeIoValue(IO_INP_OUTPUT_CTRL, 0);
		this.registers.mirror(this.memory);
		this.memory.writeIoValue(IO_INP_STATUS, this.sampleSequence);
	}
}
