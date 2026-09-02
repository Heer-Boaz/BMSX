import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import type { HostAudioOutput } from './audio_output';
import type { VibrationInitialization } from './input/contracts';
import type { Input } from './input/manager';
import { HostMenuInput, type HostOverlayMenu } from './host_overlay_menu';
import { LogLevel, type LogOutput } from './log';
import type { RenderPresentationState } from './presentation_state';
import type { SystemOutputLog } from './system_output_log';
import {
	IO_SYS_STATUS,
	SYS_STATUS_SUPERVISOR_ACTIVE,
} from '../../machine/ts/spec/bmsx/io';

const MAX_HOST_FRAME_DELTA_MS = 250;

const enum HostPauseReason {
	Requested = 1 << 0,
	VibrationInitialization = 1 << 1,
	Debugger = 1 << 2,
}

const HOST_PAUSE_AUDIO_REASONS =
	HostPauseReason.Requested
	| HostPauseReason.VibrationInitialization;

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
	private pauseReasons = 0;
	private hostUfpsScaled: number;

	public constructor(ufpsScaled: number, currentTimeMs: number) {
		this.hostUfpsScaled = ufpsScaled;
		this.currentTimeMs = currentTimeMs;
	}

	public get paused(): boolean {
		return this.pauseReasons !== 0;
	}

	public get vibrationInitializationActive(): boolean {
		return (this.pauseReasons & HostPauseReason.VibrationInitialization) !== 0;
	}

	public setPaused(paused: boolean, audioOutput: HostAudioOutput): void {
		if (!this.updatePauseReason(HostPauseReason.Requested, paused)) {
			return;
		}
		audioOutput.mutePause(
			(this.pauseReasons & HOST_PAUSE_AUDIO_REASONS) !== 0,
		);
	}

	public setDebuggerPaused(paused: boolean, audioOutput: HostAudioOutput): void {
		if (!this.updatePauseReason(HostPauseReason.Debugger, paused)) {
			return;
		}
		audioOutput.muteDebugger(paused);
	}

	public async initializeVibration(
		initialization: VibrationInitialization,
		audioOutput: HostAudioOutput,
		logOutput: LogOutput,
	): Promise<void> {
		this.updatePauseReason(HostPauseReason.VibrationInitialization, true);
		audioOutput.mutePause(true);
		try {
			await initialization.initialize();
		} catch (error) {
			logOutput.log(
				LogLevel.Error,
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			this.updatePauseReason(HostPauseReason.VibrationInitialization, false);
			audioOutput.mutePause(
				(this.pauseReasons & HOST_PAUSE_AUDIO_REASONS) !== 0,
			);
		}
	}

	public syncMachineTiming(
		runtime: Runtime,
		input: Input,
		audioOutput: HostAudioOutput,
	): void {
		const ufpsScaled = runtime.timing.ufpsScaled;
		if (ufpsScaled === this.hostUfpsScaled) {
			return;
		}
		this.hostUfpsScaled = ufpsScaled;
		input.setFrameDurationMs(runtime.timing.frameDurationMs);
		audioOutput.syncTiming(ufpsScaled);
	}

	private updatePauseReason(
		reason: HostPauseReason,
		active: boolean,
	): boolean {
		const previous = this.pauseReasons;
		const next = active
			? previous | reason
			: previous & ~reason;
		if (next === previous) {
			return false;
		}
		this.pauseReasons = next;
		return true;
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
	session.syncMachineTiming(runtime, input, audioOutput);
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
			rebootMachine(
				session,
				screen,
				runtime,
				presenter,
				input,
				audioOutput,
				systemOutput,
				logOutput,
			);
			return true;
		case HostMenuInput.ExitGame:
			return true;
	}
}

export function beginHostFrame(
	session: HostFrameSession,
	input: Input,
	audioOutput: HostAudioOutput,
	logOutput: LogOutput,
	currentTime: number,
): number {
	input.pollInput();
	if (!session.vibrationInitializationActive) {
		const initialization = input.takePendingVibrationInitialization();
		if (initialization) {
			void session.initializeVibration(
				initialization,
				audioOutput,
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

export function prepareHostPresentation(
	session: HostFrameSession,
	runtime: Runtime,
	screen: RenderPresentationState,
	hostOverlayMenu: HostOverlayMenu,
	runReady: boolean,
	hostMenuInput: HostMenuInput,
): HostFrameAction {
	if (hostMenuInput === HostMenuInput.Active) {
		screen.clearPresentation();
		runtime.frameScheduler.clearQueuedTime();
		hostOverlayMenu.queueRenderCommands();
		screen.requestHeldPresentation();
		return HostFrameAction.PresentPending;
	}
	if (session.paused) {
		hostOverlayMenu.queueFrameOverlayCommands(session.hostFps);
		return HostFrameAction.PresentPaused;
	}

	const hostOverlayQueued = hostOverlayMenu.queueFrameOverlayCommands(session.hostFps);
	screen.clearPresentation();
	if (!runReady) {
		runtime.frameScheduler.clearQueuedTime();
	}
	if (hostOverlayQueued) {
		screen.requestHeldPresentation();
	}
	if (runReady) {
		return HostFrameAction.Execute;
	}
	return HostFrameAction.PresentPending;
}

export function syncAfterRuntimeUpdate(
	session: HostFrameSession,
	runtime: Runtime,
	input: Input,
	audioOutput: HostAudioOutput,
	screen: RenderPresentationState,
	previousTickSequence: number,
): void {
	session.syncMachineTiming(runtime, input, audioOutput);
	audioOutput.muteSystem(
		(runtime.machine.memory.readIoU32(IO_SYS_STATUS) & SYS_STATUS_SUPERVISOR_ACTIVE) !== 0,
	);
	screen.syncAfterRuntimeUpdate(runtime, previousTickSequence);
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
	runtime.frameScheduler.run(hostDeltaMs);
	const gxGpu = runtime.machine.gxGpu;
	while (gxGpu.backendServicePending()) {
		if (gxGpu.backendCommandDrainPending()) {
			presenter.backend.executeGxGpuCommandDrain(gxGpu);
		} else {
			presenter.backend.executeGxGpuReadback(gxGpu);
		}
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
		if (gxGpu.backendCommandDrainPending()) {
			presenter.backend.executeGxGpuCommandDrain(gxGpu);
		} else {
			presenter.backend.executeGxGpuReadback(gxGpu);
		}
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
		audioOutput,
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
	let action = prepareHostPresentation(
		session,
		runtime,
		screen,
		hostOverlayMenu,
		true,
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
	return HostFrameRunResult.Continue;
}
