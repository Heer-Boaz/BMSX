import { runtimeWorkbenchState } from './workbench_state';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { clearRuntimeFault } from './fault_state';

export function clearRuntimeDebuggerPause(runtime: Runtime): void {
	runtimeWorkbenchState.ide.debugger.pauseCoordinator.clearSuspension();
	runtimeWorkbenchState.ide.debugger.suspendSignal = null;
	runtimeWorkbenchState.ide.debugger.paused = false;
	clearRuntimeFault(runtime);
	runtimeWorkbenchState.ide.debugger.controller.clearPauseContext();
}
