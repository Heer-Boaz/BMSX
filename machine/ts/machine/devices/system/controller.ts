import { IO_SYS_CONTROL, SYS_CONTROL_RESET } from '../../bus/io';
import type { CPU, Value } from '../../cpu/cpu';
import { Memory } from '../../memory/memory';

export type SystemControllerState = {
	resetRequested: boolean;
};

export class SystemController {
	private resetRequested = false;

	public constructor(
		private readonly memory: Memory,
		private readonly cpu: CPU,
	) {
		memory.mapIoWrite(IO_SYS_CONTROL, this, SystemController.writeControl);
	}

	public reset(): void {
		this.resetRequested = false;
		this.memory.writeIoValue(IO_SYS_CONTROL, 0);
	}

	private static writeControl(context: SystemController, _address: number, value: Value): void {
		if (((value as number) & SYS_CONTROL_RESET) !== 0) {
			context.resetRequested = true;
			context.cpu.requestYield();
		}
		context.memory.writeIoValue(IO_SYS_CONTROL, 0);
	}

	public takeResetRequest(): boolean {
		const requested = this.resetRequested;
		this.resetRequested = false;
		return requested;
	}

	public captureState(): SystemControllerState {
		return { resetRequested: this.resetRequested };
	}

	public restoreState(state: SystemControllerState): void {
		this.resetRequested = state.resetRequested;
		this.memory.writeIoValue(IO_SYS_CONTROL, 0);
	}
}
