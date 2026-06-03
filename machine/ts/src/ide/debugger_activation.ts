import { consoleCore } from '../core/console';

let _debuggerControlsVisible: boolean = false;

export function toggleDebuggerControls(): void {
	if (_debuggerControlsVisible) {
		consoleCore.paused = false;
		hideDebuggerControls();
	} else {
		consoleCore.paused = true;
		showDebuggerControls();
	}
}

function showDebuggerControls(): void {
	_debuggerControlsVisible = true;
	consoleCore.view.showFadingOverlay('⏸️');
}

function hideDebuggerControls(): void {
	_debuggerControlsVisible = false;
	consoleCore.view.hideFadingOverlay();
}
