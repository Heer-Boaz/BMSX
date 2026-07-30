import { runGate } from '../../machine/ts/common/taskgate';
import {
	initializeMachineRuntime,
	initializeMachineVideoPresenter,
} from '../common/machine_runtime';
import { HostAudioOutput } from '../common/audio_output';
import {
	HostFrameRunResult,
	HostFrameSession,
	runHostFrame,
} from '../common/host_frame';
import { HostOverlayMenu } from '../common/host_overlay_menu';
import { RenderPresentationState } from '../common/presentation_state';
import { SystemOutputLog } from '../common/system_output_log';
import {
	completeBrowserBoot,
	prepareBrowserStartup,
	showBrowserBootError,
} from './boot';
import { bindBrowserFullscreenShortcut } from './fullscreen';

declare const BMSX_BROWSER_DEBUG: boolean;

async function startBrowserPlayer(): Promise<void> {
	const systemRomPath = `./bmsx-bios${BMSX_BROWSER_DEBUG ? '.debug' : ''}.rom`;
	try {
		const options = await prepareBrowserStartup(
			BMSX_BROWSER_DEBUG,
			systemRomPath,
			document.body.dataset.defaultRom,
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
			options.audio,
			runtime.machine.audioController,
			runtime.machine.audioOutput.outputRing,
			runtime.timing.ufpsScaled,
		);
		const systemOutput = new SystemOutputLog();
		const session = new HostFrameSession(
			runtime.timing.ufpsScaled,
			options.clock.now(),
		);
		runtime.resetForSystemBoot();
		runtime.boot();
		systemOutput.flush(runtime, options.logOutput);
		audioOutput.bootstrap();
		bindBrowserFullscreenShortcut(
			options.input,
			session,
			audioOutput,
			options.logOutput,
		);
		if (!BMSX_BROWSER_DEBUG) {
			window.addEventListener('beforeunload', (event) => {
				event.preventDefault();
				event.returnValue = 'Are you sure you want to exit this awesome game?';
			});
		}
		const presentation = new RenderPresentationState();
		const hostOverlayMenu = new HostOverlayMenu(
			presenter,
			runtime,
			options.input,
		);
		runtime.frameScheduler.clearQueuedTime();
		const frameLoop = options.frames.start((currentTime) => {
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
				runGate.ready,
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
