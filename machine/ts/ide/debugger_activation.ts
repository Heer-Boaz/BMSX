import { machineManager } from '../core/machine_manager';

let _debuggerControlsVisible: boolean = false;

export function toggleDebuggerControls(): void {
	if (_debuggerControlsVisible) {
		machineManager.paused = false;
		hideDebuggerControls();
	} else {
		machineManager.paused = true;
		showDebuggerControls();
	}
}

function showDebuggerControls(): void {
	_debuggerControlsVisible = true;
	machineManager.view.showFadingOverlay('⏸️');
}

function hideDebuggerControls(): void {
	_debuggerControlsVisible = false;
	machineManager.view.hideFadingOverlay();
}
