import {
	completeBrowserBoot,
	prepareBrowserStartup,
	showBrowserBootError,
} from '../../hosts/browser/boot';
import { BrowserClipboard } from './clipboard';
import { IdeMicrotaskQueue } from '../common/microtask_queue';
import { prepareWorkbenchRuntime } from '../workbench/machine_runtime';
import { bindBrowserFullscreenShortcut } from '../../hosts/browser/fullscreen';
import { bindBrowserDebuggerPauseShortcut } from './debugger_pause';
import { defaultResourcePanelRatio } from '../workbench/contrib/resources/panel/layout';
import { persistWorkspaceSessionLocally } from '../workbench/workspace/storage';
import {
	initializeMachineRuntime,
	initializeMachineVideoPresenter,
} from '../../hosts/common/machine_runtime';
import { HostAudioOutput } from '../../hosts/common/audio_output';
import {
	HostFrameRunResult,
	HostFrameSession,
} from '../../hosts/common/host_frame';
import { HostOverlayMenu } from '../../hosts/common/host_overlay_menu';
import { RenderPresentationState } from '../../hosts/common/presentation_state';
import { SystemOutputLog } from '../../hosts/common/system_output_log';
import { runWorkbenchHostFrame } from '../workbench/host_frame';
import { runGate } from '../../machine/ts/common/taskgate';

declare const BMSX_BROWSER_DEBUG: boolean;

async function startBrowserStudio(): Promise<void> {
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
		const ide = await prepareWorkbenchRuntime(
			options.systemRom,
			options.cartridgeSlots,
			runtime,
			presenter,
			options.videoOutput,
			options.input,
			audioOutput,
			window.localStorage,
			options.clock,
			new BrowserClipboard(),
			new IdeMicrotaskQueue(),
			options.logOutput,
			defaultResourcePanelRatio(window.innerWidth / window.screen.width),
		);
		systemOutput.flush(runtime, options.logOutput);
		audioOutput.bootstrap();
		bindBrowserFullscreenShortcut(
			options.input,
			session,
			audioOutput,
			options.logOutput,
		);
		bindBrowserDebuggerPauseShortcut(options.input, audioOutput);
		window.addEventListener('beforeunload', (event) => {
			if (!BMSX_BROWSER_DEBUG) {
				event.preventDefault();
				event.returnValue = 'Are you sure you want to exit this awesome game?';
			}
		});
		window.addEventListener('pagehide', () => {
			persistWorkspaceSessionLocally();
		});
		const presentation = new RenderPresentationState();
		const hostOverlayMenu = new HostOverlayMenu(
			presenter,
			runtime,
			options.input,
		);
		runtime.frameScheduler.clearQueuedTime();
		const frameLoop = options.frames.start((currentTime) => {
			const result = runWorkbenchHostFrame(
				session,
				runtime,
				presenter,
				options.input,
				audioOutput,
				systemOutput,
				options.logOutput,
				ide,
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
	void startBrowserStudio();
}, { once: true });
