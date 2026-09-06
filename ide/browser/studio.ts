import { HostExecutionControl } from '../../hosts/common/execution_control';
import { HostRewind } from '../../hosts/common/rewind';
import { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import {
	completeBrowserBoot,
	prepareBrowserStartup,
	showBrowserBootError,
} from '../../hosts/browser/boot';
import { BrowserClipboard } from './clipboard';
import { IdeMicrotaskQueue } from '../common/microtask_queue';
import { prepareWorkbenchRuntime } from '../workbench/machine_runtime';
import { bindBrowserFullscreenShortcut } from '../../hosts/browser/fullscreen';
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
		const hostOverlayMenu = new HostOverlayMenu(
			presenter,
			runtime,
			options.input,
			rewind,
			execution,
		);
		const ide = await prepareWorkbenchRuntime(
			options.systemRom,
			options.cartridgeSlots,
			runtime,
			presenter,
			options.videoOutput,
			options.input,
			audioOutput,
			runtimeTasks,
			execution,
			rewind,
			hostOverlayMenu,
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
			execution,
			options.logOutput,
		);
		window.addEventListener('beforeunload', (event) => {
			if (!BMSX_BROWSER_DEBUG) {
				event.preventDefault();
				event.returnValue = 'Are you sure you want to exit this awesome game?';
			}
		});
		window.addEventListener('pagehide', () => {
			persistWorkspaceSessionLocally();
		});
		runtime.frameScheduler.clearQueuedTime();
		const frameLoop = options.frames.start((currentTime) => {
			options.browserInput.poll(currentTime);
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
