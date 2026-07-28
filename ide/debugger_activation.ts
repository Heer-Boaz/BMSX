import { machineManager } from '../machine/ts/core/machine_manager';

let _debuggerControlsVisible: boolean = false;
const pauseOverlay = document.createElement('div');
pauseOverlay.id = 'pause-overlay';

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
	pauseOverlay.textContent = '⏸️';
	pauseOverlay.classList.remove('fade-out');
	pauseOverlay.classList.add('visible');
	document.body.appendChild(pauseOverlay);
}

function hideDebuggerControls(): void {
	_debuggerControlsVisible = false;
	pauseOverlay.classList.add('fade-out');
	pauseOverlay.classList.remove('visible');
	void pauseOverlay.offsetWidth;
	pauseOverlay.addEventListener('animationend', () => {
		pauseOverlay.classList.remove('fade-out');
		pauseOverlay.remove();
	}, { once: true });
}
