import { machineManager } from '../../core/machine_manager';
import type { Runtime } from '../../machine/runtime/runtime';
import { logDebugState } from '../runtime/debug_state';
import { recordLuaError } from '../runtime/fault_state';
import { activateTerminalMode } from './overlay_modes';

export function handleLuaError(runtime: Runtime, whatever: unknown): void {
	const recorded = recordLuaError(runtime, whatever);
	if (recorded) {
		console.error(recorded.stackText);
		logDebugState(runtime);
		machineManager.ideState.terminal.appendError(recorded.error);
	}
	if (recorded || runtime.luaRuntimeFailed) {
		activateTerminalMode();
	}
}
