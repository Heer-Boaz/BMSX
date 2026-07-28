import type { HostAudioOutput } from '../../hosts/common/audio_output';
import { runGate } from '../../machine/ts/common/taskgate';
import type { Input } from '../../machine/ts/input/manager';
import { GAME_PAUSE_KEY } from '../common/constants';

let debuggerControlsVisible = false;
const DEBUGGER_PAUSE_CATEGORY = 'debugger-pause';
const pauseOverlay = document.createElement('div');
pauseOverlay.id = 'pause-overlay';

export function bindBrowserDebuggerPauseShortcut(input: Input, audioOutput: HostAudioOutput): void {
	input.getGlobalShortcutRegistry().registerKeyboardShortcut(1, GAME_PAUSE_KEY, () => {
		toggleDebuggerControls(audioOutput);
	});
}

function toggleDebuggerControls(audioOutput: HostAudioOutput): void {
	if (debuggerControlsVisible) {
		runGate.endCategory(DEBUGGER_PAUSE_CATEGORY);
		audioOutput.muteDebugger(false);
		hideDebuggerControls();
	} else {
		runGate.begin({
			blocking: true,
			category: DEBUGGER_PAUSE_CATEGORY,
			tag: DEBUGGER_PAUSE_CATEGORY,
		});
		audioOutput.muteDebugger(true);
		showDebuggerControls();
	}
}

function showDebuggerControls(): void {
	debuggerControlsVisible = true;
	pauseOverlay.textContent = '⏸️';
	pauseOverlay.classList.remove('fade-out');
	pauseOverlay.classList.add('visible');
	document.body.appendChild(pauseOverlay);
}

function hideDebuggerControls(): void {
	debuggerControlsVisible = false;
	pauseOverlay.classList.add('fade-out');
	pauseOverlay.classList.remove('visible');
	void pauseOverlay.offsetWidth;
	pauseOverlay.addEventListener('animationend', () => {
		pauseOverlay.classList.remove('fade-out');
		pauseOverlay.remove();
	}, { once: true });
}
