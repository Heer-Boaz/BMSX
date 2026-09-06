import { HostPauseReason, type HostExecutionControl } from '../common/execution_control';
import { LogLevel } from '../common/log';
import type { Input } from '../common/input/manager';
import type { LogOutput } from '../common/log';

export function bindBrowserFullscreenShortcut(
	input: Input,
	execution: HostExecutionControl,
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
			execution.setPauseReason(HostPauseReason.Fullscreen, true);
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
				execution.setPauseReason(HostPauseReason.Fullscreen, false);
			}
		};
		window.addEventListener('keyup', onKeyUp);
	});
}
