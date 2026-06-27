import type { Runtime } from '../../machine/runtime/runtime';
import { clearRuntimeFault } from './fault_state';

export function clearRuntimeDebuggerPause(runtime: Runtime): void {
	runtime.pauseCoordinator.clearSuspension();
	runtime.debuggerSuspendSignal = null;
	runtime.debuggerPaused = false;
	clearRuntimeFault(runtime);
	runtime.debuggerController.clearPauseContext();
}
