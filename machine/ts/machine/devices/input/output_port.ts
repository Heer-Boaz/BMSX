import { IO_INP_OUTPUT_CTRL } from '../../bus/io';
import type { Value } from '../../cpu/cpu';
import { Memory } from '../../memory/memory';
import { InputControllerRegisterFile } from './registers';
import {
	decodeInputOutputIntensityQ16,
	INP_OUTPUT_CTRL_APPLY,
	type InputControllerInputSource,
} from './contracts';

export class InputControllerOutputPort {
	public constructor(
		private readonly input: InputControllerInputSource,
		private readonly registers: InputControllerRegisterFile,
		private readonly memory: Memory,
	) {}

	public static writeOutputControlRegisterThunk(context: InputControllerOutputPort, _addr: number, value: Value): void {
		const command = (value as number) >>> 0;
		if (command === INP_OUTPUT_CTRL_APPLY) {
			context.input.applyInputControllerVibrationEffect(
				context.registers.selectedPadIndex(),
				context.registers.state.outputDurationMs,
				decodeInputOutputIntensityQ16(context.registers.state.outputIntensityQ16),
			);
		}
		context.memory.writeIoValue(IO_INP_OUTPUT_CTRL, 0);
	}
}
