import { machineManager } from './machine_manager';
import { hostOverlayMenu } from './host_overlay_menu';
import * as workbenchMode from '../ide/workbench/mode';
import { flushRuntimeLuaOutputToTerminal } from '../ide/runtime/state';
import type { Runtime } from '../machine/runtime/runtime';
import { runRuntimeFrameStepInto, type RuntimeFrameStepResult } from '../machine/runtime/frame/step';

const MAX_HOST_FRAME_DELTA_MS = 250;
const hostFrameStepResult: RuntimeFrameStepResult = {
	previousTickSequence: 0,
	tickSequence: 0,
	tickAdvanced: false,
};

export function runMachineHostFrame(runtime: Runtime, currentTime: number, runReady: boolean): void {
	const manager = machineManager;
	if (!manager.running) {
		return;
	}
	const screen = manager.screen;
	let hostDeltaMs = 0;
	try {
		manager.input.pollInput();
		screen.beginHostFrame(currentTime);
		workbenchMode.tickIdeInput();
		workbenchMode.tickTerminalInput(runtime);
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
			if (runtime.executionOverlayActive) {
				screen.runOverlay(runtime);
			} else if (!runReady) {
				runtime.frameScheduler.clearQueuedTime();
			} else {
				manager.deltatime = runtime.timing.frameDurationMs;
				runRuntimeFrameStepInto(hostFrameStepResult, runtime, hostDeltaMs);
				manager.syncRuntimeAudioTiming();
				screen.syncAfterRuntimeUpdate(runtime, hostFrameStepResult.previousTickSequence);
			}
			if (hostOverlayQueued) {
				screen.requestHeldPresentation();
			}
			manager.platform.microtasks.flush();
			screen.presentPending(runtime, hostDeltaMs);
		}
	} catch (error) {
		workbenchMode.surfaceHostFrameError(runtime, error, hostDeltaMs, screen);
	}
	flushRuntimeLuaOutputToTerminal(runtime, manager.ideState);
	screen.flushDebugReport(currentTime, runtime);
}
