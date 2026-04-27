import { engineCore } from '../core/engine';

let _debuggerControlsVisible: boolean = false;

export function toggleDebuggerControls(): void {
	if (_debuggerControlsVisible) {
		engineCore.paused = false;
		hideDebuggerControls();
	} else {
		engineCore.paused = true;
		showDebuggerControls();
	}
}

function showDebuggerControls(): void {
	_debuggerControlsVisible = true;
	engineCore.view.showFadingOverlay('⏸️');
}

function hideDebuggerControls(): void {
	_debuggerControlsVisible = false;
	engineCore.view.hideFadingOverlay();
}
