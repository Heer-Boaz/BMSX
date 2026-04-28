import { convertToError } from '../../lua/value';
import {
	HOST_FAULT_FLAG_ACTIVE,
	HOST_FAULT_FLAG_STARTUP_BLOCKING,
	HOST_FAULT_STAGE_NONE,
	HOST_FAULT_STAGE_STARTUP_AUDIO_REFRESH,
	IO_SYS_HOST_FAULT_FLAGS,
	IO_SYS_HOST_FAULT_STAGE,
} from '../bus/io';
import { Runtime } from './runtime';

export class HostFaultState {
	private message: string | null = null;

	public getMessage(): string | null {
		return this.message;
	}

	public publishStartup(error: unknown): void {
		const normalized = convertToError(error);
		const message = normalized.message.length > 0 ? normalized.message : String(error);
		this.publish(
			HOST_FAULT_FLAG_ACTIVE | HOST_FAULT_FLAG_STARTUP_BLOCKING,
			HOST_FAULT_STAGE_STARTUP_AUDIO_REFRESH,
			message,
		);
	}

	public clear(): void {
		const runtime = Runtime.instance;
		this.message = null;
		runtime.machine.memory.writeValue(IO_SYS_HOST_FAULT_FLAGS, 0);
		runtime.machine.memory.writeValue(IO_SYS_HOST_FAULT_STAGE, HOST_FAULT_STAGE_NONE);
	}

	private publish(flags: number, stage: number, message: string): void {
		const runtime = Runtime.instance;
		this.message = message;
		runtime.machine.memory.writeValue(IO_SYS_HOST_FAULT_FLAGS, flags >>> 0);
		runtime.machine.memory.writeValue(IO_SYS_HOST_FAULT_STAGE, stage >>> 0);
	}
}
