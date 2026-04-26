import type { EngineCore } from './engine';
import { flushHostRuntimeAssetEdits } from './host_asset_sync';
import * as workbenchMode from '../ide/workbench/mode';
import { applyRuntimeGameViewTableToState, syncRuntimeGameViewStateToTable } from '../machine/runtime/game/table';
import { applyGameViewStateToHost, syncGameViewViewportSizeFromHost } from '../machine/runtime/game/view_state';
import type { Runtime } from '../machine/runtime/runtime';

const MAX_HOST_FRAME_DELTA_MS = 250;

export function runEngineHostFrame(engine: EngineCore, runtime: Runtime, currentTime: number, runReady: boolean): void {
	if (!engine.running) {
		return;
	}
	const screen = runtime.screen;
	let hostDeltaMs = 0;
	try {
		engine.input.pollInput();
		screen.beginHostFrame(currentTime);
		workbenchMode.tickIdeInput(runtime);
		workbenchMode.tickTerminalInput(runtime);
		syncGameViewViewportSizeFromHost(runtime.gameViewState, engine.view);
		syncRuntimeGameViewStateToTable(runtime);
		hostDeltaMs = Math.min(currentTime - runtime.frameLoop.currentTimeMs, MAX_HOST_FRAME_DELTA_MS);
		runtime.frameLoop.currentTimeMs = currentTime;

		if (engine.paused) {
			screen.presentPausedFrame(runtime, hostDeltaMs);
		} else {
			screen.clearPresentation();
			if (runtime.executionOverlayActive) {
				screen.runOverlay(runtime);
			} else if (!runReady) {
				runtime.frameScheduler.clearQueuedTime();
			} else {
				const previousTickSequence = runtime.frameScheduler.lastTickSequence;
				engine.deltatime = runtime.timing.frameDurationMs;
				runtime.frameScheduler.run(runtime, hostDeltaMs);
				applyRuntimeGameViewTableToState(runtime);
				applyGameViewStateToHost(runtime.gameViewState, engine.view);
				screen.syncAfterRuntimeUpdate(runtime, previousTickSequence);
				flushHostRuntimeAssetEdits(runtime.machine.memory, engine.texmanager);
			}
			screen.presentPending(runtime, hostDeltaMs);
		}
	} catch (error) {
		workbenchMode.surfaceHostFrameError(runtime, error, hostDeltaMs);
	}
	screen.flushDebugReport(currentTime, runtime);
}
