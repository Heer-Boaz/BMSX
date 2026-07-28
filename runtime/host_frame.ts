import { machineManager } from '../machine/ts/core/machine_manager';
import type { Runtime } from '../machine/ts/machine/runtime/runtime';
import type { VideoPresenter } from '../machine/ts/render/video_presenter';
import { HostMenuInput, type HostOverlayMenu } from './host_overlay_menu';
import type { RenderPresentationState } from './presentation_state';

const MAX_HOST_FRAME_DELTA_MS = 250;

export const enum MachineHostFrameAction {
	Execute,
	PresentPending,
	PresentPaused,
}

export type MachineHostPresentation =
	| MachineHostFrameAction.PresentPending
	| MachineHostFrameAction.PresentPaused;

function rebootMachine(screen: RenderPresentationState, runtime: Runtime): void {
	runtime.rebootSystem();
	screen.reset();
	machineManager.flushSystemOutput(runtime);
	machineManager.bootstrapStartupAudio();
}

export function executeMachineHostMenuAction(
	input: HostMenuInput,
	screen: RenderPresentationState,
	runtime: Runtime,
): boolean {
	switch (input) {
		case HostMenuInput.Inactive:
		case HostMenuInput.Active:
			return false;
		case HostMenuInput.RebootCart:
			rebootMachine(screen, runtime);
			return true;
		case HostMenuInput.ExitGame:
			machineManager.platform.requestShutdown();
			return true;
	}
}

export function beginMachineHostFrame(
	runtime: Runtime,
	currentTime: number,
): number {
	const manager = machineManager;
	manager.input.pollInput();
	const hostDeltaMs = Math.min(
		currentTime - runtime.frameLoop.currentTimeMs,
		MAX_HOST_FRAME_DELTA_MS,
	);
	runtime.frameLoop.currentTimeMs = currentTime;
	manager.host_fps = 1000 / hostDeltaMs;
	return hostDeltaMs;
}

export function prepareMachineHostPresentation(
	screen: RenderPresentationState,
	hostOverlayMenu: HostOverlayMenu,
	runtime: Runtime,
	runReady: boolean,
	hostMenuInput: HostMenuInput,
): MachineHostFrameAction {
	const manager = machineManager;
	if (hostMenuInput === HostMenuInput.Active) {
		screen.clearPresentation();
		runtime.frameScheduler.clearQueuedTime();
		hostOverlayMenu.queueRenderCommands();
		screen.requestHeldPresentation();
		manager.platform.microtasks.flush();
		return MachineHostFrameAction.PresentPending;
	}
	if (manager.paused) {
		hostOverlayMenu.queueFrameOverlayCommands();
		manager.platform.microtasks.flush();
		return MachineHostFrameAction.PresentPaused;
	}

	const hostOverlayQueued = hostOverlayMenu.queueFrameOverlayCommands();
	screen.clearPresentation();
	if (!runReady) {
		runtime.frameScheduler.clearQueuedTime();
	}
	if (hostOverlayQueued) {
		screen.requestHeldPresentation();
	}
	if (runReady) {
		return MachineHostFrameAction.Execute;
	}
	manager.platform.microtasks.flush();
	return MachineHostFrameAction.PresentPending;
}

export function beginMachineHostUpdate(runtime: Runtime): number {
	machineManager.deltatime = runtime.timing.frameDurationMs;
	return runtime.frameScheduler.lastTickSequence;
}

export function completeMachineHostUpdate(
	screen: RenderPresentationState,
	runtime: Runtime,
	previousTickSequence: number,
): void {
	machineManager.syncRuntimeAudioTiming();
	screen.syncAfterRuntimeUpdate(runtime, previousTickSequence);
	machineManager.platform.microtasks.flush();
}

export function executeMachineHostUpdate(
	presenter: VideoPresenter,
	screen: RenderPresentationState,
	runtime: Runtime,
	hostDeltaMs: number,
): void {
	const previousTickSequence = beginMachineHostUpdate(runtime);
	runtime.frameScheduler.run(hostDeltaMs);
	while (runtime.machine.gxGpu.backendReadbackPending()) {
		presenter.backend.executeGxGpuReadback(runtime.machine.gxGpu);
		runtime.frameScheduler.run(0);
	}
	completeMachineHostUpdate(screen, runtime, previousTickSequence);
}

export function presentMachineHostPresentation(
	presenter: VideoPresenter,
	action: MachineHostPresentation,
	screen: RenderPresentationState,
	runtime: Runtime,
	hostDeltaMs: number,
): void {
	switch (action) {
		case MachineHostFrameAction.PresentPending:
			screen.presentPending(presenter, runtime, hostDeltaMs);
			return;
		case MachineHostFrameAction.PresentPaused:
			screen.presentPausedFrame(presenter, runtime, hostDeltaMs);
			return;
	}
}

export function runMachineHostFrame(
	presenter: VideoPresenter,
	screen: RenderPresentationState,
	hostOverlayMenu: HostOverlayMenu,
	runtime: Runtime,
	currentTime: number,
	runReady: boolean,
): void {
	const manager = machineManager;
	if (!manager.running) {
		return;
	}
	const hostDeltaMs = beginMachineHostFrame(runtime, currentTime);
	const hostMenuInput = hostOverlayMenu.tickInput();
	if (executeMachineHostMenuAction(hostMenuInput, screen, runtime)) {
		return;
	}
	let action = prepareMachineHostPresentation(
		screen,
		hostOverlayMenu,
		runtime,
		runReady,
		hostMenuInput,
	);
	if (action === MachineHostFrameAction.Execute) {
		executeMachineHostUpdate(presenter, screen, runtime, hostDeltaMs);
		action = MachineHostFrameAction.PresentPending;
	}
	presentMachineHostPresentation(presenter, action, screen, runtime, hostDeltaMs);
	manager.flushSystemOutput(runtime);
}
