import { HostMenuInput, type HostOverlayMenu } from './host_overlay_menu';
import type { MachineHost } from './machine_runtime';
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

function rebootMachine(screen: RenderPresentationState, host: MachineHost): void {
	host.runtime.rebootSystem();
	screen.reset(host.presenter, host.runtime);
	host.flushSystemOutput();
	host.bootstrapStartupAudio();
}

export function executeMachineHostMenuAction(
	input: HostMenuInput,
	screen: RenderPresentationState,
	host: MachineHost,
): boolean {
	switch (input) {
		case HostMenuInput.Inactive:
		case HostMenuInput.Active:
			return false;
		case HostMenuInput.RebootCart:
			rebootMachine(screen, host);
			return true;
		case HostMenuInput.ExitGame:
			host.platform.requestShutdown();
			return true;
	}
}

export function beginMachineHostFrame(
	host: MachineHost,
	currentTime: number,
): number {
	const runtime = host.runtime;
	const hidInitialization = host.input.pollInput();
	if (hidInitialization) {
		void host.initializeGamepadHid(hidInitialization);
	}
	const hostDeltaMs = Math.min(
		currentTime - runtime.frameLoop.currentTimeMs,
		MAX_HOST_FRAME_DELTA_MS,
	);
	runtime.frameLoop.currentTimeMs = currentTime;
	host.hostFps = 1000 / hostDeltaMs;
	return hostDeltaMs;
}

export function prepareMachineHostPresentation(
	host: MachineHost,
	screen: RenderPresentationState,
	hostOverlayMenu: HostOverlayMenu,
	runReady: boolean,
	hostMenuInput: HostMenuInput,
): MachineHostFrameAction {
	const runtime = host.runtime;
	if (hostMenuInput === HostMenuInput.Active) {
		screen.clearPresentation();
		runtime.frameScheduler.clearQueuedTime();
		hostOverlayMenu.queueRenderCommands();
		screen.requestHeldPresentation();
		host.platform.microtasks.flush();
		return MachineHostFrameAction.PresentPending;
	}
	if (host.paused) {
		hostOverlayMenu.queueFrameOverlayCommands(host.hostFps);
		host.platform.microtasks.flush();
		return MachineHostFrameAction.PresentPaused;
	}

	const hostOverlayQueued = hostOverlayMenu.queueFrameOverlayCommands(host.hostFps);
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
	host.platform.microtasks.flush();
	return MachineHostFrameAction.PresentPending;
}

export function beginMachineHostUpdate(host: MachineHost): number {
	return host.runtime.frameScheduler.lastTickSequence;
}

export function completeMachineHostUpdate(
	host: MachineHost,
	screen: RenderPresentationState,
	previousTickSequence: number,
): void {
	host.syncRuntimeAudioTiming();
	screen.syncAfterRuntimeUpdate(host.runtime, previousTickSequence);
	host.platform.microtasks.flush();
}

export function executeMachineHostUpdate(
	host: MachineHost,
	screen: RenderPresentationState,
	hostDeltaMs: number,
): void {
	const runtime = host.runtime;
	const previousTickSequence = beginMachineHostUpdate(host);
	runtime.frameScheduler.run(hostDeltaMs);
	while (runtime.machine.gxGpu.backendReadbackPending()) {
		host.presenter.backend.executeGxGpuReadback(runtime.machine.gxGpu);
		runtime.frameScheduler.run(0);
	}
	completeMachineHostUpdate(host, screen, previousTickSequence);
}

export function presentMachineHostPresentation(
	host: MachineHost,
	action: MachineHostPresentation,
	screen: RenderPresentationState,
	hostDeltaMs: number,
): void {
	host.soundMaster.finishFrame();
	switch (action) {
		case MachineHostFrameAction.PresentPending:
			screen.presentPending(host.presenter, host.runtime, hostDeltaMs);
			return;
		case MachineHostFrameAction.PresentPaused:
			screen.presentPausedFrame(host.presenter, host.runtime, hostDeltaMs);
			return;
	}
}

export function runMachineHostFrame(
	host: MachineHost,
	screen: RenderPresentationState,
	hostOverlayMenu: HostOverlayMenu,
	currentTime: number,
	runReady: boolean,
): void {
	if (!host.running) {
		return;
	}
	const hostDeltaMs = beginMachineHostFrame(host, currentTime);
	const hostMenuInput = hostOverlayMenu.tickInput();
	if (executeMachineHostMenuAction(hostMenuInput, screen, host)) {
		return;
	}
	let action = prepareMachineHostPresentation(
		host,
		screen,
		hostOverlayMenu,
		runReady,
		hostMenuInput,
	);
	if (action === MachineHostFrameAction.Execute) {
		executeMachineHostUpdate(host, screen, hostDeltaMs);
		action = MachineHostFrameAction.PresentPending;
	}
	presentMachineHostPresentation(host, action, screen, hostDeltaMs);
	host.flushSystemOutput();
}
