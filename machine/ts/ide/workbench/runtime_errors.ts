import { machineManager } from '../../core/machine_manager';
import type { Runtime } from '../../machine/runtime/runtime';
import { LogLevel } from '../../platform/platform';
import { logDebugState } from '../runtime/debug_state';
import { recordLuaError } from '../runtime/fault_state';

export function handleLuaError(runtime: Runtime, whatever: unknown): void {
	const recorded = recordLuaError(runtime, whatever);
	if (recorded) {
		machineManager.platform.log(LogLevel.Error, recorded.stackText);
		logDebugState(runtime, machineManager.platform);
	}
}
