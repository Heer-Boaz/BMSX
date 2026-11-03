import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import type { HostAudioOutput } from './audio_output';
import type { RenderPresentationState } from './presentation_state';
import type { HostFrameSession } from './frame_session';

export function syncAfterRuntimeUpdate(
	session: HostFrameSession,
	runtime: Runtime,
	audioOutput: HostAudioOutput,
	screen: RenderPresentationState,
	previousTickSequence: number,
): void {
	session.syncMachineOutput(runtime, audioOutput);
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
	runtime.frameScheduler.synchronizeBackendService();
}

export function executeHostUpdate(
	session: HostFrameSession,
	runtime: Runtime,
	presenter: VideoPresenter,
	audioOutput: HostAudioOutput,
	screen: RenderPresentationState,
	hostDeltaMs: number,
	devicesOnly = false,
): void {
	if (devicesOnly) {
		session.execution.consumeElapsedTime(0);
		executeHostLogicalTick(session, runtime, presenter, audioOutput, screen, true);
		return;
	}
	if (session.execution.frameStepPending) {
		session.execution.consumeElapsedTime(0);
		if (executeHostLogicalTick(session, runtime, presenter, audioOutput, screen)) {
			session.execution.finishFrameStep();
		}
		return;
	}
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
	audioOutput: HostAudioOutput,
	screen: RenderPresentationState,
	devicesOnly = false,
): boolean {
	const previousTickSequence = runtime.frameScheduler.lastTickSequence;
	let completed = devicesOnly
		? runtime.frameScheduler.runDevicesToNextLogicalTick(runtime.timing.cycleBudgetPerFrame)
		: runtime.frameScheduler.runToNextLogicalTick();
	const gxGpu = runtime.machine.gxGpu;
	while (gxGpu.backendServicePending()) {
		serviceNextGxBackendRequest(runtime, presenter);
		if (!completed) {
			completed = devicesOnly ? runtime.frameScheduler.runDevicesToNextLogicalTick(0) : runtime.frameScheduler.runToNextLogicalTick();
		}
	}
	syncAfterRuntimeUpdate(
		session,
		runtime,
		audioOutput,
		screen,
		previousTickSequence,
	);
	return completed;
}

