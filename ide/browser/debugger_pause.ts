import type { SoundMaster } from '../../machine/ts/audio/soundmaster';
import { runGate } from '../../machine/ts/common/taskgate';
import type { Input } from '../../machine/ts/input/manager';
import { GAME_PAUSE_KEY } from '../common/constants';

let debuggerControlsVisible = false;
const DEBUGGER_PAUSE_CATEGORY = 'debugger-pause';
const DEBUGGER_AUDIO_SUSPENSION = 'debugger';
const pauseOverlay = document.createElement('div');
pauseOverlay.id = 'pause-overlay';

export function bindBrowserDebuggerPauseShortcut(input: Input, soundMaster: SoundMaster): void {
	input.getGlobalShortcutRegistry().registerKeyboardShortcut(1, GAME_PAUSE_KEY, () => {
		toggleDebuggerControls(soundMaster);
	});
}

function toggleDebuggerControls(soundMaster: SoundMaster): void {
	if (debuggerControlsVisible) {
		runGate.endCategory(DEBUGGER_PAUSE_CATEGORY);
		soundMaster.resumeAll(DEBUGGER_AUDIO_SUSPENSION);
		hideDebuggerControls();
	} else {
		runGate.begin({
			blocking: true,
			category: DEBUGGER_PAUSE_CATEGORY,
			tag: DEBUGGER_PAUSE_CATEGORY,
		});
		soundMaster.suspendAll(DEBUGGER_AUDIO_SUSPENSION);
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
