import type { Runtime } from '../../machine/runtime/runtime';
import { machineManager } from '../../core/machine_manager';
import { clearRuntimeFault } from './fault_state';

export function clearRuntimeDebuggerPause(runtime: Runtime): void {
	machineManager.ideState.debugger.pauseCoordinator.clearSuspension();
	machineManager.ideState.debugger.suspendSignal = null;
	machineManager.ideState.debugger.paused = false;
	clearRuntimeFault(runtime);
	machineManager.ideState.debugger.controller.clearPauseContext();
}
