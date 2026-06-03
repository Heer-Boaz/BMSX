import { Input } from '../../../input/manager';
import {
	IO_INP_OUTPUT_CTRL,
	IO_INP_OUTPUT_STATUS,
} from '../../bus/io';
import type { Value } from '../../cpu/cpu';
import { Memory } from '../../memory/memory';
import { InputControllerRegisterFile } from './registers';
import {
	decodeInputOutputIntensityQ16,
	INP_OUTPUT_CTRL_APPLY,
	INP_OUTPUT_STATUS_SUPPORTED,
} from './contracts';

export class InputControllerOutputPort {
	public constructor(
		private readonly input: Input,
		private readonly registers: InputControllerRegisterFile,
		private readonly memory: Memory,
	) {}

	public readStatus(player: number): number {
		return this.input.getPlayerInput(player).supportsVibrationEffect ? INP_OUTPUT_STATUS_SUPPORTED : 0;
	}

	public readRegister(addr: number): number {
		switch (addr) {
			case IO_INP_OUTPUT_STATUS:
				return this.readStatus(this.registers.selectedPlayerIndex());
			case IO_INP_OUTPUT_CTRL:
				return 0;
		}
		throw new Error(`ICU output register read is not mapped for ${addr >>> 0}.`);
	}

	public writeControl(command: number): void {
		switch (command) {
			case INP_OUTPUT_CTRL_APPLY:
				this.apply(this.registers.selectedPlayerIndex(), this.registers.state.outputIntensityQ16, this.registers.state.outputDurationMs);
				return;
		}
	}

	public writeOutputControlRegister(_addr: number, value: Value): void {
		this.writeControl((value as number) >>> 0);
		this.memory.writeIoValue(IO_INP_OUTPUT_CTRL, 0);
	}

	public apply(player: number, intensityQ16: number, durationMs: number): void {
		this.input.getPlayerInput(player).applyVibrationEffect({
			effect: 'dual-rumble',
			duration: durationMs,
			intensity: decodeInputOutputIntensityQ16(intensityQ16),
		});
	}
}
