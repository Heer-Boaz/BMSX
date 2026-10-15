import { HostExecutionControl } from '../common/execution_control';
import { HostRewind } from '../common/rewind';
import { RuntimeTaskQueue } from '../common/runtime_task_queue';
import {
	initializeMachineRuntime,
	initializeMachineVideoPresenter,
} from '../common/machine_runtime';
import { HostAudioOutput } from '../common/audio_output';
import { HostAudioDevice } from '../common/audio_device';
import { HostFrameRunResult, runHostFrame } from '../common/host_frame';
import { HostFrameSession } from '../common/frame_session';
import { HostOverlayMenu, HostOverlayOutcome } from '../common/host_overlay_menu';
import { OnScreenKeyboard } from '../common/input/on_screen_keyboard';
import { HostKeyboardInteraction } from '../common/input/host_keyboard_interaction';
import { BrowserOnscreenKeyboard } from './onscreen_keyboard';
import { BrowserHostControls } from './host_controls';
import { BROWSER_KEYBOARD_PAGES } from './onscreen_keyboard_layout';
import { RenderPresentationState } from '../common/presentation_state';
import { SystemOutputLog } from '../common/system_output_log';
import {
	completeBrowserBoot,
	prepareBrowserStartup,
	loadBrowserMedia,
	showBrowserBootError,
} from './boot';
import { bindBrowserFullscreenShortcut } from './fullscreen';

declare const BMSX_BROWSER_DEBUG: boolean;

async function startBrowserPlayer(): Promise<void> {
	try {
		const options = await prepareBrowserStartup(
			BMSX_BROWSER_DEBUG,
			await loadBrowserMedia(document.body.dataset.systemRom, document.body.dataset.defaultRom),
			'overscan',
		);
		const runtime = initializeMachineRuntime(
			options.systemRom,
			options.cartridgeSlots,
			options.machineModel,
			options.input,
		);
		const presenter = initializeMachineVideoPresenter(
			runtime,
			options.videoOutput,
			options.videoBackend,
		);
		const audioOutput = new HostAudioOutput(
			new HostAudioDevice(options.audio),
			runtime.machine.audioController,
			runtime.timing.ufpsScaled,
		);
		const systemOutput = new SystemOutputLog();
		const runtimeTasks = new RuntimeTaskQueue(audioOutput, presenter);
		const presentation = new RenderPresentationState();
		const execution = new HostExecutionControl(audioOutput);
		const rewind = new HostRewind(runtime, presenter, presentation, runtimeTasks, audioOutput, options.logOutput);
		const session = new HostFrameSession(
			runtime.timing.ufpsScaled,
			options.clock.now(),
			rewind,
			execution,
		);
		runtime.resetForSystemBoot();
		runtime.boot();
		systemOutput.flush(runtime, options.logOutput);
		audioOutput.device.select(audioOutput);
		bindBrowserFullscreenShortcut(
			options.input,
			execution,
			options.logOutput,
		);
		if (!BMSX_BROWSER_DEBUG) {
			window.addEventListener('beforeunload', (event) => {
				event.preventDefault();
				event.returnValue = 'Are you sure you want to exit this awesome game?';
			});
		}
		const keyboardModel = new OnScreenKeyboard(options.input, BROWSER_KEYBOARD_PAGES);
		const keyboardInteraction = new HostKeyboardInteraction(options.input, keyboardModel, presenter, undefined);
		const hostOverlayMenu = new HostOverlayMenu(
			presenter,
			runtime,
			options.input,
			rewind,
			execution,
			keyboardInteraction,
			[...options.menuOptions, {
				kind: 'value', label: 'PICTURE',
				values: [{ label: 'FIT' }, { label: 'OVERSCAN 5%' }],
				getIndex: () => options.videoOutput.screenFit === 'fit' ? 0 : 1,
				setIndex: index => options.videoOutput.setScreenFit(index === 0 ? 'fit' : 'overscan'),
			}],
		);
		options.browserInput.setOnscreenKeyboard(new BrowserOnscreenKeyboard(
			document, keyboardModel, () => hostOverlayMenu.dismiss(HostOverlayOutcome.Cancel),
		));
		options.browserInput.setForegroundPointerCapture(keyboardInteraction.capturesPointer);
		options.browserInput.setHostControls(new BrowserHostControls(
			document, hostOverlayMenu.requestToggleKeyboard, hostOverlayMenu.requestToggleMenu,
		));
		runtime.frameScheduler.clearQueuedTime();
		const frameLoop = options.frames.start((currentTime) => {
			options.browserInput.poll(currentTime);
			const result = runHostFrame(
				session,
				runtime,
				presenter,
				options.input,
				audioOutput,
				systemOutput,
				options.logOutput,
				presentation,
				hostOverlayMenu,
				currentTime,
			);
			if (result === HostFrameRunResult.ExitRequested) {
				window.close();
				if (window.closed) {
					frameLoop.stop();
				}
			}
		});
		completeBrowserBoot();
	} catch (error) {
		showBrowserBootError(error);
	}
}

window.addEventListener('load', () => {
	void startBrowserPlayer();
}, { once: true });
