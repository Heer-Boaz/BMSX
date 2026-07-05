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

const INPUT_OUTPUT_REGISTER_WRITE_ADDRS = [
	IO_INP_OUTPUT_PORT,
	IO_INP_OUTPUT_INTENSITY_Q16,
	IO_INP_OUTPUT_DURATION_MS,
] as const;

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
		this.memory.mapIoWrite(IO_INP_CTRL, this, InputController.writeControl);
		for (const addr of INPUT_OUTPUT_REGISTER_WRITE_ADDRS) {
			this.memory.mapIoWrite(addr, this.registers, InputControllerRegisterFile.writeThunk);
		}
		this.memory.mapIoWrite(IO_INP_OUTPUT_CTRL, this.outputPort, InputControllerOutputPort.writeOutputControlRegisterThunk);
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

	private static writeControl(context: InputController, _addr: number, value: Value): void {
		context.registers.state.ctrl = (value as number) >>> 0;
		switch (context.registers.state.ctrl) {
			case INP_CTRL_ARM:
				context.sampleArmed = true;
				return;
			case INP_CTRL_RESET:
				context.sampleArmed = false;
				context.sampleSequence = 0;
				context.lastSampleCycle = 0;
				context.registers.reset();
				context.registers.mirror(context.memory);
				context.memory.writeIoValue(IO_INP_STATUS, context.sampleSequence);
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
