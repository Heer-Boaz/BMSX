import {
	IO_INP_CTRL,
	IO_INP_OUTPUT_CTRL,
	IO_INP_OUTPUT_DURATION_MS,
	IO_INP_OUTPUT_INTENSITY_Q16,
	IO_INP_OUTPUT_PORT,
	IO_INP_STATUS,
} from '../../bus/io';
import { Memory } from '../../memory/memory';
import type { InputControllerState } from './save_state';
import { InputControllerRegisterFile } from './registers';
import { InputControllerSampleLatch } from './sample_latch';
import { InputControllerSampleEdge } from './sample_edge';
import { InputControllerOutputPort } from './output_port';
import { InputControllerControlPort } from './control_port';
import type { InputControllerInputSource } from './contracts';

export class InputController {
	private readonly sampleLatch: InputControllerSampleLatch;
	private readonly sampleEdge: InputControllerSampleEdge;
	private readonly controlPort: InputControllerControlPort;
	private readonly outputPort: InputControllerOutputPort;
	private readonly registers = new InputControllerRegisterFile();

	public constructor(
		private readonly memory: Memory,
		input: InputControllerInputSource,
	) {
		this.sampleLatch = new InputControllerSampleLatch();
		this.controlPort = new InputControllerControlPort(memory, this.registers, this.sampleLatch);
		this.outputPort = new InputControllerOutputPort(input, this.registers, memory);
		this.sampleEdge = new InputControllerSampleEdge(input, this.sampleLatch, this.registers, memory);
		const registerWrite = this.registers.write.bind(this.registers);
		this.memory.mapIoWrite(IO_INP_CTRL, this.controlPort.writeControl.bind(this.controlPort));
		this.memory.mapIoWrite(IO_INP_OUTPUT_PORT, registerWrite);
		this.memory.mapIoWrite(IO_INP_OUTPUT_INTENSITY_Q16, registerWrite);
		this.memory.mapIoWrite(IO_INP_OUTPUT_DURATION_MS, registerWrite);
		this.memory.mapIoWrite(IO_INP_OUTPUT_CTRL, this.outputPort.writeOutputControlRegister.bind(this.outputPort));
	}

	public reset(): void {
		this.sampleLatch.reset();
		this.registers.reset();
		this.memory.writeIoValue(IO_INP_OUTPUT_CTRL, 0);
		this.registers.mirror(this.memory);
		this.memory.writeIoValue(IO_INP_STATUS, this.sampleLatch.sequence());
	}

	// runtime enters at the ICU device boundary; sample_edge owns the VBlank datapath.
	public onVblankEdge(currentTimeMs: number, nowCycles: number): void {
		this.sampleEdge.onVblankEdge(currentTimeMs, nowCycles);
	}

	public cancelSampleArm(): void {
		this.sampleLatch.cancel();
	}

	public captureState(): InputControllerState {
		return {
			...this.sampleLatch.captureState(),
			registers: this.registers.captureState(),
		};
	}

	public restoreState(state: InputControllerState): void {
		this.sampleLatch.restoreState(state);
		this.registers.restoreState(state.registers);
		this.memory.writeIoValue(IO_INP_OUTPUT_CTRL, 0);
		this.registers.mirror(this.memory);
		this.memory.writeIoValue(IO_INP_STATUS, this.sampleLatch.sequence());
	}
}
