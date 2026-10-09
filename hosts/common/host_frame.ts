import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import type { HostAudioOutput } from './audio_output';
import type { Input } from './input/manager';
import { HostMenuExecution, HostMenuInput, type HostOverlayMenu } from './host_overlay_menu';
import { LogLevel, type LogOutput } from './log';
import type { RenderPresentationState } from './presentation_state';
import type { SystemOutputLog } from './system_output_log';
import type { HostFrameSession } from './frame_session';
import { executeHostUpdate } from './machine_step';

const MAX_HOST_FRAME_DELTA_MS = 250;

export const enum HostFrameAction {
	Execute,
	PresentPending,
	PresentPaused,
}

export type HostFramePresentation =
	| HostFrameAction.PresentPending
	| HostFrameAction.PresentPaused;

export const enum HostFrameRunResult {
	Continue,
	ExitRequested,
}

function rebootMachine(
	session: HostFrameSession,
	screen: RenderPresentationState,
	runtime: Runtime,
	presenter: VideoPresenter,
	input: Input,
	audioOutput: HostAudioOutput,
	systemOutput: SystemOutputLog,
	logOutput: LogOutput,
): void {
	runtime.rebootSystem();
	screen.reset(presenter, runtime);
	systemOutput.flush(runtime, logOutput);
	session.syncMachineOutput(runtime, audioOutput);
	input.setFrameDurationMs(runtime.timing.frameDurationMs);
	audioOutput.restart(runtime.timing.ufpsScaled);
	audioOutput.muteSystem(false);
}

export function executeHostMenuAction(
	menuInput: HostMenuInput,
	session: HostFrameSession,
	screen: RenderPresentationState,
	runtime: Runtime,
	presenter: VideoPresenter,
	input: Input,
	audioOutput: HostAudioOutput,
	systemOutput: SystemOutputLog,
	logOutput: LogOutput,
): boolean {
	switch (menuInput) {
		case HostMenuInput.Inactive:
		case HostMenuInput.Active:
			return false;
		case HostMenuInput.RebootCart:
			void session.rewind.tasks.schedule(async () => rebootMachine(
				session,
				screen,
				runtime,
				presenter,
				input,
				audioOutput,
				systemOutput,
				logOutput,
			), error => logOutput.log(LogLevel.Error, error instanceof Error ? error.message : String(error)));
			return true;
		case HostMenuInput.ExitGame:
			return true;
	}
}

export function beginHostFrame(
	session: HostFrameSession,
	input: Input,
	logOutput: LogOutput,
	currentTime: number,
): number {
	input.pollInput();
	if (!session.execution.vibrationInitializationActive) {
		const initialization = input.takePendingVibrationInitialization();
		if (initialization) {
			void session.initializeVibration(
				initialization,
				logOutput,
			);
		}
	}
	const hostDeltaMs = Math.min(
		currentTime - session.currentTimeMs,
		MAX_HOST_FRAME_DELTA_MS,
	);
	session.currentTimeMs = currentTime;
	session.hostFps = 1000 / hostDeltaMs;
	return hostDeltaMs;
}

/** Select execution policy before machine execution; drawing belongs to the presentation phase. */
export function prepareHostUpdate(
	session: HostFrameSession,
	runtime: Runtime,
	runReady: boolean,
	hostMenuInput: HostMenuInput,
	explicitStep = false,
): HostFrameAction {
	if (hostMenuInput === HostMenuInput.Active) {
		runtime.frameScheduler.clearQueuedTime();
		return HostFrameAction.PresentPending;
	}
	if (session.execution.executionBlocked(explicitStep)) return HostFrameAction.PresentPaused;
	if (!runReady) {
		runtime.frameScheduler.clearQueuedTime();
		return HostFrameAction.PresentPending;
	}
	return HostFrameAction.Execute;
}

export function presentHostPresentation(
	session: HostFrameSession,
	runtime: Runtime,
	presenter: VideoPresenter,
	audioOutput: HostAudioOutput,
	action: HostFramePresentation,
	screen: RenderPresentationState,
	hostDeltaMs: number,
): void {
	audioOutput.device.sink.pumpRuntimeAudio();
	switch (action) {
		case HostFrameAction.PresentPending:
			screen.presentPending(
				presenter,
				runtime,
				session.currentTimeMs,
				hostDeltaMs,
			);
			return;
		case HostFrameAction.PresentPaused:
			screen.presentPausedFrame(
				presenter,
				runtime,
				session.currentTimeMs,
				hostDeltaMs,
			);
			return;
	}
}

export function runHostFrame(
	session: HostFrameSession,
	runtime: Runtime,
	presenter: VideoPresenter,
	input: Input,
	audioOutput: HostAudioOutput,
	systemOutput: SystemOutputLog,
	logOutput: LogOutput,
	screen: RenderPresentationState,
	hostOverlayMenu: HostOverlayMenu,
	currentTime: number,
): HostFrameRunResult {
	const hostDeltaMs = beginHostFrame(
		session,
		input,
		logOutput,
		currentTime,
	);
	const hostMenuInput = hostOverlayMenu.tickInput();
	const menuExecution = hostOverlayMenu.executionMode;
	const menuPaused = menuExecution === HostMenuExecution.Paused;
	audioOutput.muteMenu(menuPaused || (menuExecution === HostMenuExecution.Rewind && !session.rewind.playing));
	if (hostMenuInput === HostMenuInput.ExitGame) {
		return HostFrameRunResult.ExitRequested;
	}
	if (executeHostMenuAction(
		hostMenuInput,
		session,
		screen,
		runtime,
		presenter,
		input,
		audioOutput,
		systemOutput,
		logOutput,
	)) {
		return HostFrameRunResult.Continue;
	}
	screen.clearPresentation();
	if (!menuPaused) {
		session.rewind.service(true);
		if (session.rewind.playing && !session.execution.executionBlocked()) {
			session.rewind.runPlayback(session.execution.consumeElapsedTime(hostDeltaMs));
			session.syncMachineOutput(runtime, audioOutput);
		}
	}
	let action = prepareHostUpdate(
		session,
		runtime,
		session.rewind.tasks.ready && !session.rewind.active,
		hostMenuInput,
	);
	if (action === HostFrameAction.Execute) {
		executeHostUpdate(
			session,
			runtime,
			presenter,
			audioOutput,
			screen,
			hostDeltaMs,
		);
		action = HostFrameAction.PresentPending;
	}
	if (hostOverlayMenu.queueFrameOverlayCommands(session.hostFps)
		|| session.rewind.active || !session.rewind.tasks.ready) screen.requestHeldPresentation();
	presentHostPresentation(
		session,
		runtime,
		presenter,
		audioOutput,
		action,
		screen,
		hostDeltaMs,
	);
	input.setFrameDurationMs(runtime.timing.frameDurationMs);
	systemOutput.flush(runtime, logOutput);
	if (!menuPaused && runtime.history.checkpointPending && session.rewind.tasks.ready) session.rewind.service(true);
	return HostFrameRunResult.Continue;
}
