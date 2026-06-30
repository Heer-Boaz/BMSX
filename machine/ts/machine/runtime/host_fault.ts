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
	constructor(private readonly runtime: Runtime) {
	}

	public publishStartup(error: unknown): void {
		const normalized = convertToError(error);
		const message = normalized.message.length > 0 ? normalized.message : String(error);
		const runtime = this.runtime;
		runtime.setGlobal('sys_host_fault_message', runtime.internString(message));
		runtime.machine.memory.writeValue(IO_SYS_HOST_FAULT_FLAGS, (HOST_FAULT_FLAG_ACTIVE | HOST_FAULT_FLAG_STARTUP_BLOCKING) >>> 0);
		runtime.machine.memory.writeValue(IO_SYS_HOST_FAULT_STAGE, HOST_FAULT_STAGE_STARTUP_AUDIO_REFRESH);
	}

	public clear(): void {
		const runtime = this.runtime;
		runtime.setGlobal('sys_host_fault_message', null);
		runtime.machine.memory.writeValue(IO_SYS_HOST_FAULT_FLAGS, 0);
		runtime.machine.memory.writeValue(IO_SYS_HOST_FAULT_STAGE, HOST_FAULT_STAGE_NONE);
	}

}
