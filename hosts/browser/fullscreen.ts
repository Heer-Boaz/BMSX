import { LogLevel } from '../common/log';
import type { HostAudioOutput } from '../common/audio_output';
import type { HostFrameSession } from '../common/host_frame';
import type { Input } from '../common/input/manager';
import type { LogOutput } from '../common/log';

export function bindBrowserFullscreenShortcut(
	input: Input,
	session: HostFrameSession,
	audioOutput: HostAudioOutput,
	logOutput: LogOutput,
): void {
	input.getGlobalShortcutRegistry().registerKeyboardShortcut(1, 'F11', () => {
		if (input.debugHotkeysPaused) {
			return;
		}
		const enterFullscreen = document.fullscreenElement !== document.documentElement;
		const onKeyUp = async (event: KeyboardEvent) => {
			if (event.code !== 'F11') {
				return;
			}
			window.removeEventListener('keyup', onKeyUp);
			session.setPaused(true, audioOutput);
			try {
				if (enterFullscreen) {
					await document.documentElement.requestFullscreen();
				} else {
					await document.exitFullscreen();
				}
			} catch (error) {
				logOutput.log(
					LogLevel.Error,
					error instanceof Error ? error.message : String(error),
				);
			} finally {
				session.setPaused(false, audioOutput);
			}
		};
		window.addEventListener('keyup', onKeyUp);
	});
}
