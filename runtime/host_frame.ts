import { machineManager } from '../machine/ts/core/machine_manager';
import type { HostOverlayMenu } from './host_overlay_menu';
import * as workbenchMode from '../ide/workbench/mode';
import { syncRuntimeSourceActivity } from '../ide/runtime/sources';
import type { Runtime } from '../machine/ts/machine/runtime/runtime';
import type { RenderPresentationState } from './presentation_state';
import type { RuntimeIdeState } from '../ide/runtime/state';

const MAX_HOST_FRAME_DELTA_MS = 250;

export function runMachineHostFrame(
	ide: RuntimeIdeState,
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
	let hostDeltaMs = 0;
	try {
		manager.input.pollInput();
		workbenchMode.tickIdeInput(ide);
		hostDeltaMs = Math.min(currentTime - runtime.frameLoop.currentTimeMs, MAX_HOST_FRAME_DELTA_MS);
		runtime.frameLoop.currentTimeMs = currentTime;
		manager.host_fps = 1000 / hostDeltaMs;
		const hostMenuActive = hostOverlayMenu.tickInput();

		if (hostMenuActive) {
			screen.clearPresentation();
			runtime.frameScheduler.clearQueuedTime();
			hostOverlayMenu.queueRenderCommands();
			screen.requestHeldPresentation();
			manager.platform.microtasks.flush();
			screen.presentPending(runtime, hostDeltaMs);
		} else if (manager.paused) {
			hostOverlayMenu.queueFrameOverlayCommands();
			manager.platform.microtasks.flush();
			screen.presentPausedFrame(runtime, hostDeltaMs);
		} else {
			const hostOverlayQueued = hostOverlayMenu.queueFrameOverlayCommands();
			screen.clearPresentation();
			if (ide.overlayRenderer.active) {
				screen.runOverlay(runtime);
			} else if (!runReady) {
				runtime.frameScheduler.clearQueuedTime();
			} else {
				manager.deltatime = runtime.timing.frameDurationMs;
				const previousTickSequence = runtime.frameScheduler.lastTickSequence;
				runtime.frameScheduler.run(hostDeltaMs);
				while (runtime.machine.gxGpu.backendReadbackPending()) {
					manager.view.backend.executeGxGpuReadback(runtime.machine.gxGpu);
					runtime.frameScheduler.run(0);
				}
				syncRuntimeSourceActivity(ide.sources, runtime.machine.cpu.activeCartridgeSlot());
				manager.syncRuntimeAudioTiming();
				screen.syncAfterRuntimeUpdate(runtime, previousTickSequence);
			}
			if (hostOverlayQueued) {
				screen.requestHeldPresentation();
			}
			manager.platform.microtasks.flush();
			screen.presentPending(runtime, hostDeltaMs);
		}
	} catch (error) {
		workbenchMode.surfaceHostFrameError(ide, runtime, error);
		screen.presentErrorOverlay(runtime, hostDeltaMs);
	}
	manager.flushSystemOutput(runtime);
}
