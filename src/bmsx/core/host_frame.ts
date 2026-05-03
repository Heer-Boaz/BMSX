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
		if (hostOverlayMenu.tickInput()) {
			runtime.frameScheduler.clearQueuedTime();
			screen.clearPresentation();
			hostOverlayMenu.queueRenderCommands();
			console.view.drawHostMenuFrame(hostDeltaMs);
			return;
		}

		if (console.paused) {
			screen.presentPausedFrame(hostDeltaMs);
		} else {
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
			screen.presentPending(hostDeltaMs);
		}
	} catch (error) {
		workbenchMode.surfaceHostFrameError(runtime, error, hostDeltaMs);
	}
	screen.flushDebugReport(currentTime, runtime);
}
