import { consoleCore } from './console';
import { hostOverlayMenu } from './host_overlay_menu';
import * as workbenchMode from '../ide/workbench/mode';
import type { Runtime } from '../machine/runtime/runtime';

const MAX_HOST_FRAME_DELTA_MS = 250;

export function runConsoleHostFrame(runtime: Runtime, currentTime: number, runReady: boolean): void {
	const console = consoleCore;
	if (!console.running) {
		return;
	}
	const screen = runtime.screen;
	let hostDeltaMs = 0;
	try {
		console.input.pollInput();
		screen.beginHostFrame(currentTime);
		workbenchMode.tickIdeInput(runtime);
		workbenchMode.tickTerminalInput(runtime);
		hostDeltaMs = Math.min(currentTime - runtime.frameLoop.currentTimeMs, MAX_HOST_FRAME_DELTA_MS);
		runtime.frameLoop.currentTimeMs = currentTime;
		console.host_fps = 1000 / hostDeltaMs;
		const hostMenuActive = hostOverlayMenu.tickInput();

		if (hostMenuActive) {
			screen.clearPresentation();
			runtime.frameScheduler.clearQueuedTime();
			hostOverlayMenu.queueRenderCommands();
			screen.requestHeldPresentation();
			screen.presentPending(hostDeltaMs);
		} else if (console.paused) {
			hostOverlayMenu.queueFrameOverlayCommands();
			screen.presentPausedFrame(hostDeltaMs);
		} else {
			const hostOverlayQueued = hostOverlayMenu.queueFrameOverlayCommands();
			screen.clearPresentation();
			if (runtime.executionOverlayActive) {
				screen.runOverlay();
			} else if (!runReady) {
				runtime.frameScheduler.clearQueuedTime();
			} else {
				const previousTickSequence = runtime.frameScheduler.lastTickSequence;
				console.deltatime = runtime.timing.frameDurationMs;
				runtime.frameScheduler.run(hostDeltaMs);
				screen.syncAfterRuntimeUpdate(previousTickSequence);
			}
			if (hostOverlayQueued) {
				screen.requestHeldPresentation();
			}
			screen.presentPending(hostDeltaMs);
		}
	} catch (error) {
		workbenchMode.surfaceHostFrameError(runtime, error, hostDeltaMs);
	}
	screen.flushDebugReport(currentTime, runtime);
}
