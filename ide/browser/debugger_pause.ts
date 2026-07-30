import type { HostAudioOutput } from '../../hosts/common/audio_output';
import type { HostFrameSession } from '../../hosts/common/host_frame';
import type { Input } from '../../hosts/common/input/manager';
import { GAME_PAUSE_KEY } from '../common/constants';

let debuggerControlsVisible = false;
const pauseOverlay = document.createElement('div');
pauseOverlay.id = 'pause-overlay';

export function bindBrowserDebuggerPauseShortcut(
	input: Input,
	session: HostFrameSession,
	audioOutput: HostAudioOutput,
): void {
	input.getGlobalShortcutRegistry().registerKeyboardShortcut(1, GAME_PAUSE_KEY, () => {
		toggleDebuggerControls(session, audioOutput);
	});
}

function toggleDebuggerControls(
	session: HostFrameSession,
	audioOutput: HostAudioOutput,
): void {
	if (debuggerControlsVisible) {
		session.setDebuggerPaused(false, audioOutput);
		hideDebuggerControls();
	} else {
		session.setDebuggerPaused(true, audioOutput);
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
