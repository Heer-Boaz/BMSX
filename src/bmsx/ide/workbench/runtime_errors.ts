import type { Runtime } from '../../machine/runtime/runtime';
import { logDebugState } from '../../machine/runtime/debug';
import { recordLuaError } from '../runtime/fault_state';
import { activateTerminalMode } from './overlay_modes';

export function handleLuaError(runtime: Runtime, whatever: unknown): void {
	const recorded = recordLuaError(runtime, whatever);
	if (recorded) {
		console.error(recorded.stackText);
		logDebugState(runtime);
		runtime.terminal.appendError(recorded.error);
	}
	if (recorded || runtime.luaRuntimeFailed) {
		activateTerminalMode(runtime);
	}
}
