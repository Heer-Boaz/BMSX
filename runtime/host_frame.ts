import { machineManager } from '../machine/ts/core/machine_manager';
import type { Runtime } from '../machine/ts/machine/runtime/runtime';
import { HostMenuInput, type HostOverlayMenu } from './host_overlay_menu';
import type { RenderPresentationState } from './presentation_state';

const MAX_HOST_FRAME_DELTA_MS = 250;

export const enum MachineHostPresentation {
	Pending,
	Paused,
}

function rebootMachine(runtime: Runtime): void {
	runtime.rebootSystem();
	machineManager.flushSystemOutput(runtime);
	machineManager.bootstrapStartupAudio();
}

function executeHostMenuAction(input: HostMenuInput, runtime: Runtime): boolean {
	switch (input) {
		case HostMenuInput.Inactive:
		case HostMenuInput.Active:
			return false;
		case HostMenuInput.RebootCart:
			rebootMachine(runtime);
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
	hostDeltaMs: number,
	runReady: boolean,
	hostMenuInput: HostMenuInput,
): MachineHostPresentation {
	const manager = machineManager;
	if (hostMenuInput === HostMenuInput.Active) {
		screen.clearPresentation();
		runtime.frameScheduler.clearQueuedTime();
		hostOverlayMenu.queueRenderCommands();
		screen.requestHeldPresentation();
		manager.platform.microtasks.flush();
		return MachineHostPresentation.Pending;
	}
	if (manager.paused) {
		hostOverlayMenu.queueFrameOverlayCommands();
		manager.platform.microtasks.flush();
		return MachineHostPresentation.Paused;
	}

	const hostOverlayQueued = hostOverlayMenu.queueFrameOverlayCommands();
	screen.clearPresentation();
	if (!runReady) {
		runtime.frameScheduler.clearQueuedTime();
	} else {
		manager.deltatime = runtime.timing.frameDurationMs;
		const previousTickSequence = runtime.frameScheduler.lastTickSequence;
		runtime.frameScheduler.run(hostDeltaMs);
		while (runtime.machine.gxGpu.backendReadbackPending()) {
			manager.view.backend.executeGxGpuReadback(runtime.machine.gxGpu);
			runtime.frameScheduler.run(0);
		}
		manager.syncRuntimeAudioTiming();
		screen.syncAfterRuntimeUpdate(runtime, previousTickSequence);
	}
	if (hostOverlayQueued) {
		screen.requestHeldPresentation();
	}
	manager.platform.microtasks.flush();
	return MachineHostPresentation.Pending;
}

export function presentMachineHostPresentation(
	presentation: MachineHostPresentation,
	screen: RenderPresentationState,
	runtime: Runtime,
	hostDeltaMs: number,
): void {
	switch (presentation) {
		case MachineHostPresentation.Pending:
			screen.presentPending(runtime, hostDeltaMs);
			return;
		case MachineHostPresentation.Paused:
			screen.presentPausedFrame(runtime, hostDeltaMs);
			return;
	}
}

export function runMachineHostFrame(
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
	if (executeHostMenuAction(hostMenuInput, runtime)) {
		return;
	}
	const presentation = prepareMachineHostPresentation(
		screen,
		hostOverlayMenu,
		runtime,
		hostDeltaMs,
		runReady,
		hostMenuInput,
	);
	presentMachineHostPresentation(presentation, screen, runtime, hostDeltaMs);
	manager.flushSystemOutput(runtime);
}
