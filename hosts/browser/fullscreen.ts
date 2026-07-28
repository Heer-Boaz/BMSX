import { machineManager } from '../../machine/ts/core/machine_manager';
import { Input } from '../../machine/ts/input/manager';
import { LogLevel } from '../../machine/ts/platform/platform';

export function bindBrowserFullscreenShortcut(): void {
	Input.instance.getGlobalShortcutRegistry().registerKeyboardShortcut(1, 'F11', () => {
		if (Input.instance.debugHotkeysPaused) {
			return;
		}
		const enterFullscreen = document.fullscreenElement !== document.documentElement;
		const onKeyUp = async (event: KeyboardEvent) => {
			if (event.code !== 'F11') {
				return;
			}
			window.removeEventListener('keyup', onKeyUp);
			machineManager.paused = true;
			try {
				if (enterFullscreen) {
					await document.documentElement.requestFullscreen();
				} else {
					await document.exitFullscreen();
				}
			} catch (error) {
				machineManager.platform.log(
					LogLevel.Error,
					error instanceof Error ? error.message : String(error),
				);
			} finally {
				machineManager.paused = false;
			}
		};
		window.addEventListener('keyup', onKeyUp);
	});
}
