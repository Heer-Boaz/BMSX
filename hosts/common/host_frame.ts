import { HostPauseReason, type HostExecutionControl } from './execution_control';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import type { HostAudioOutput } from './audio_output';
import type { VibrationInitialization } from './input/contracts';
import type { Input } from './input/manager';
import { HostMenuInput, type HostOverlayMenu } from './host_overlay_menu';
import { LogLevel, type LogOutput } from './log';
import type { RenderPresentationState } from './presentation_state';
import type { SystemOutputLog } from './system_output_log';
import type { HostRewind } from './rewind';
import {
	IO_SYS_STATUS,
	SYS_STATUS_SUPERVISOR_ACTIVE,
} from '../../machine/ts/spec/bmsx/io';

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

export class HostFrameSession {
	public currentTimeMs: number;
	public hostFps = 0;
	private hostUfpsScaled: number;

	public constructor(
		ufpsScaled: number,
		currentTimeMs: number,
		public readonly rewind: HostRewind,
		public readonly execution: HostExecutionControl,
	) {
		this.hostUfpsScaled = ufpsScaled;
		this.currentTimeMs = currentTimeMs;
	}

	public async initializeVibration(
		initialization: VibrationInitialization,
		logOutput: LogOutput,
	): Promise<void> {
		this.execution.setPauseReason(HostPauseReason.VibrationInitialization, true);
		try {
			await initialization.initialize();
		} catch (error) {
			logOutput.log(
				LogLevel.Error,
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			this.execution.setPauseReason(HostPauseReason.VibrationInitialization, false);
		}
	}

	public syncMachineOutput(
		runtime: Runtime,
		input: Input,
		audioOutput: HostAudioOutput,
	): void {
		const ufpsScaled = runtime.timing.ufpsScaled;
		if (ufpsScaled !== this.hostUfpsScaled) {
			this.hostUfpsScaled = ufpsScaled;
			input.setFrameDurationMs(runtime.timing.frameDurationMs);
			audioOutput.syncTiming(ufpsScaled);
		}
		audioOutput.muteSystem(
			(runtime.machine.memory.readIoU32(IO_SYS_STATUS) & SYS_STATUS_SUPERVISOR_ACTIVE) !== 0,
		);
	}
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
	session.syncMachineOutput(runtime, input, audioOutput);
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

export function syncAfterRuntimeUpdate(
	session: HostFrameSession,
	runtime: Runtime,
	input: Input,
	audioOutput: HostAudioOutput,
	screen: RenderPresentationState,
	previousTickSequence: number,
): void {
	session.syncMachineOutput(runtime, input, audioOutput);
	screen.syncAfterRuntimeUpdate(runtime, previousTickSequence);
}

function serviceNextGxBackendRequest(
	runtime: Runtime,
	presenter: VideoPresenter,
): void {
	const gxGpu = runtime.machine.gxGpu;
	if (gxGpu.backendCommandDrainPending()) {
		presenter.backend.executeGxGpuCommandDrain(gxGpu);
	} else {
		presenter.backend.executeGxGpuReadback(gxGpu);
	}
}

export function executeHostUpdate(
	session: HostFrameSession,
	runtime: Runtime,
	presenter: VideoPresenter,
	input: Input,
	audioOutput: HostAudioOutput,
	screen: RenderPresentationState,
	hostDeltaMs: number,
): void {
	const previousTickSequence = runtime.frameScheduler.lastTickSequence;
	runtime.frameScheduler.run(session.execution.consumeElapsedTime(hostDeltaMs));
	const gxGpu = runtime.machine.gxGpu;
	while (gxGpu.backendServicePending()) {
		serviceNextGxBackendRequest(runtime, presenter);
		runtime.frameScheduler.run(0);
	}
	syncAfterRuntimeUpdate(
		session,
		runtime,
		input,
		audioOutput,
		screen,
		previousTickSequence,
	);
}

/** Executes one retained machine tick, servicing backend fences without advancing a second tick. */
export function executeHostLogicalTick(
	session: HostFrameSession,
	runtime: Runtime,
	presenter: VideoPresenter,
	input: Input,
	audioOutput: HostAudioOutput,
	screen: RenderPresentationState,
): boolean {
	const previousTickSequence = runtime.frameScheduler.lastTickSequence;
	let completed = runtime.frameScheduler.runToNextLogicalTick();
	const gxGpu = runtime.machine.gxGpu;
	while (gxGpu.backendServicePending()) {
		serviceNextGxBackendRequest(runtime, presenter);
		if (!completed) {
			completed = runtime.frameScheduler.runToNextLogicalTick();
		}
	}
	syncAfterRuntimeUpdate(
		session,
		runtime,
		input,
		audioOutput,
		screen,
		previousTickSequence,
	);
	return completed;
}

/** Advances at most one host-time-backed logical tick and services its backend fences. */
export function advanceHostScheduledLogicalTick(
	runtime: Runtime,
	presenter: VideoPresenter,
	hostDeltaMs: number,
): boolean {
	let completed = runtime.frameScheduler.runScheduledToNextLogicalTick(hostDeltaMs);
	const gxGpu = runtime.machine.gxGpu;
	while (gxGpu.backendServicePending()) {
		serviceNextGxBackendRequest(runtime, presenter);
		if (!completed) {
			completed = runtime.frameScheduler.runScheduledToNextLogicalTick(0);
		}
	}
	return completed;
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
	audioOutput.pumpRuntimeAudio();
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
	session.rewind.service(true);
	if (session.rewind.playing && !session.execution.executionBlocked()) {
		session.rewind.runPlayback(session.execution.consumeElapsedTime(hostDeltaMs));
		session.syncMachineOutput(runtime, input, audioOutput);
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
			input,
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
	systemOutput.flush(runtime, logOutput);
	if (runtime.history.checkpointPending && session.rewind.tasks.ready) session.rewind.service(true);
	return HostFrameRunResult.Continue;
}
