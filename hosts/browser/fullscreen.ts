import { LogLevel } from '../../machine/ts/platform/platform';
import type { MachineHost } from '../common/machine_runtime';

export function bindBrowserFullscreenShortcut(host: MachineHost): void {
	host.input.getGlobalShortcutRegistry().registerKeyboardShortcut(1, 'F11', () => {
		if (host.input.debugHotkeysPaused) {
			return;
		}
		const enterFullscreen = document.fullscreenElement !== document.documentElement;
		const onKeyUp = async (event: KeyboardEvent) => {
			if (event.code !== 'F11') {
				return;
			}
			window.removeEventListener('keyup', onKeyUp);
			host.paused = true;
			try {
				if (enterFullscreen) {
					await document.documentElement.requestFullscreen();
				} else {
					await document.exitFullscreen();
				}
			} catch (error) {
				host.platform.log(
					LogLevel.Error,
					error instanceof Error ? error.message : String(error),
				);
			} finally {
				host.paused = false;
			}
		};
		window.addEventListener('keyup', onKeyUp);
	});
}
